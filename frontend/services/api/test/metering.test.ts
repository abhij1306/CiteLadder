import { afterAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { testDatabase } from './support.ts';
import { VisibilityFixtures } from './visibility-fixtures.ts';
import { createModelGateway, gatewaySettings } from '../src/models/gateway.ts';
import { createJevClient, jevSettings } from '../src/models/jev.ts';
import { UnmeteredCallError } from '../src/models/meter-scope.ts';
import { meterFor } from '../src/models/metering.ts';
import { costMicrousd, modelPrice } from '../src/models/pricing.ts';

const db = testDatabase();
const fixtures = new VisibilityFixtures(db);
afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});

/** A gateway on the priced model whose provider answers with `reply`. */
function gateway(reply: () => Response | Promise<Response>) {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => reply());
  return {
    fetch,
    gateway: createModelGateway(
      {
        ...gatewaySettings({}),
        apiKey: 'fixture-key',
        baseUrl: 'https://model.test/v1',
        model: 'claude-haiku-5-5',
        attempts: 1,
      },
      { fetch, sleep: async () => {} },
    ),
  };
}
const answer = (content: string, usage: Record<string, number>) => () =>
  Response.json({ choices: [{ message: { content } }], usage });

const calls = (workspaceId: string) =>
  db
    .selectFrom('platform_calls')
    .select([
      'feature',
      'provider',
      'charge',
      'status',
      'credits',
      'input_tokens',
      'output_tokens',
      'cost_microusd',
    ])
    .where('workspace_id', '=', workspaceId)
    .orderBy('created_at')
    .execute();

describe('platform AI usage recording', () => {
  it('prices tokens at the serving model, cache reads and writes at their own rates', () => {
    const haiku = modelPrice('claude-haiku-5-5', '')!;
    // 10k input and 2k output tokens: $0.001 + $0.001.
    expect(costMicrousd(haiku, { input_tokens: 10_000, output_tokens: 2_000 })).toBe(2_000);
    expect(costMicrousd(haiku, { input_tokens: 10, output_tokens: null })).toBeNull();
    expect(
      costMicrousd(haiku, { input_tokens: 5, cached_input_tokens: 6, output_tokens: 1 }),
    ).toBeNull();
    // $0.01 uncached + $0.008 read + $0.0125 written + $0.05 output = $0.0805.
    expect(
      costMicrousd(haiku, {
        input_tokens: 1_000_000,
        cached_input_tokens: 800_000,
        cache_write_input_tokens: 100_000,
        output_tokens: 100_000,
      }),
    ).toBe(80_500);
    // An unpriced model has no price, except the configured gateway model at the default rate.
    expect(modelPrice('unpriced-model', 'gateway-model')).toBeNull();
    expect(modelPrice('gateway-model', 'gateway-model')).toEqual(haiku);
  });

  it('refuses a model or JEV call made outside a metering scope', async () => {
    const { gateway: raw, fetch } = gateway(answer('{}', {}));
    await expect(raw.complete('s', 'u')).rejects.toBeInstanceOf(UnmeteredCallError);
    const jev = createJevClient({ ...jevSettings({}), apiKey: 'fixture-key' })!;
    await expect(jev.decide({}, {})).rejects.toBeInstanceOf(UnmeteredCallError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('records each call with its tokens and cost, charging nothing', async () => {
    const t = await fixtures.tenant();
    const { gateway: raw } = gateway(
      answer('{"ok":true}', { prompt_tokens: 10_000, completion_tokens: 2_000 }),
    );
    const meter = meterFor(db, t.workspaceId);
    await meter
      .gateway(raw, 'prompt_generation')
      .structured('s', 'u', z.object({ ok: z.boolean() }));
    await meter.call(
      'commerce_competitor_discovery',
      { provider: 'tavily', model: 'tavily' },
      async () => ({ value: null, usage: null }),
    );
    expect(await calls(t.workspaceId)).toEqual([
      {
        feature: 'prompt_generation',
        provider: 'model_gateway',
        charge: 'not_charged',
        status: 'settled',
        credits: 0,
        input_tokens: 10_000,
        output_tokens: 2_000,
        cost_microusd: '2000',
      },
      {
        feature: 'commerce_competitor_discovery',
        provider: 'tavily',
        charge: 'not_charged',
        status: 'settled',
        credits: 0,
        input_tokens: null,
        output_tokens: null,
        cost_microusd: null,
      },
    ]);
  });

  it('records a paid but unparseable answer with its tokens, and a failure with none', async () => {
    const t = await fixtures.tenant();
    const unparseable = gateway(
      answer('not json', { prompt_tokens: 10_000, completion_tokens: 2_000 }),
    );
    await expect(
      meterFor(db, t.workspaceId)
        .gateway(unparseable.gateway, 'project_research')
        .structured('s', 'u', z.object({ ok: z.boolean() })),
    ).rejects.toMatchObject({ code: 'parse' });
    const failing = gateway(() => new Response('unavailable', { status: 503 }));
    await expect(
      meterFor(db, t.workspaceId).gateway(failing.gateway, 'project_research').complete('s', 'u'),
    ).rejects.toThrow();
    expect((await calls(t.workspaceId)).map((call) => [call.status, call.input_tokens])).toEqual([
      // The provider answered; the caller could not parse the answer.
      ['settled', 10_000],
      ['failed', null],
    ]);
  });
});
