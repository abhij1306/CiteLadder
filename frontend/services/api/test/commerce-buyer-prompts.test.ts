import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buyerGenerateInput,
  buyerManualInput,
  generateBuyerPrompts,
  manualBuyerPrompt,
} from '../src/commerce/buyer-prompts.ts';
import { budget, spendBudget } from '../src/abuse/usage.ts';
import { importCatalog } from './commerce-support.ts';
import { createModelGateway, gatewaySettings } from '../src/models/gateway.ts';
import { reviewCandidates } from '../src/prompts/candidates.ts';
import { candidate, generationRun } from './prompt-fixtures.ts';
import { testDatabase } from './support.ts';
import { VisibilityFixtures } from './visibility-fixtures.ts';

const db = testDatabase(),
  fixtures = new VisibilityFixtures(db);
let scope: { workspaceId: string; projectId: string }, target: { kind: 'product'; id: string };
beforeEach(async () => {
  scope = await fixtures.tenant();
  await importCatalog(
    db,
    scope,
    'link,title,description,brand\nhttps://shop.test/shoes,Trail master,Running shoes for wet trails,Acme\n',
  );
  const product = await db
    .selectFrom('commerce_products')
    .select('id')
    .where('project_id', '=', scope.projectId)
    .executeTakeFirstOrThrow();
  target = { kind: 'product', id: product.id };
});
afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});

it('saves manual prompts disabled', async () => {
  await expect(
    manualBuyerPrompt(
      db,
      scope,
      buyerManualInput.parse({ target, text: 'Which shoes grip rain?' }),
    ),
  ).resolves.toMatchObject({ enabled: false, approved_at: null, target });
});

it('generates target-bound prompts and fails atomically on unusable or foreign targets', async () => {
  const io = {
    fetch: vi.fn<typeof fetch>(async () =>
      Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                prompts: [
                  { text: 'best running shoes for wet trails' },
                  { text: 'lightweight shoes with cushioning for long runs' },
                ],
              }),
            },
          },
        ],
      }),
    ),
    sleep: async () => {},
  };
  const gateway = () =>
    createModelGateway(
      {
        ...gatewaySettings({}),
        apiKey: 'test-only',
        model: 'claude-haiku-5-5',
        baseUrl: 'https://model.test',
      },
      io,
    );
  const rows = await generateBuyerPrompts(
    db,
    scope,
    buyerGenerateInput.parse({ targets: [target], count: 2, hero: true }),
    { gatewayFactory: gateway },
  );
  expect(rows).toHaveLength(2);
  expect(rows.every((row) => !row.enabled)).toBe(true);
  const other = await fixtures.tenant();
  await expect(
    generateBuyerPrompts(
      db,
      other,
      buyerGenerateInput.parse({ targets: [target], count: 2, hero: true }),
      { gatewayFactory: gateway },
    ),
  ).rejects.toMatchObject({ status: 404 });
  expect(io.fetch).toHaveBeenCalledTimes(1);
  io.fetch.mockImplementationOnce(async () =>
    Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify({ prompts: [{ text: 'What do you prefer in Trail master?' }] }),
          },
        },
      ],
    }),
  );
  await expect(
    generateBuyerPrompts(
      db,
      scope,
      buyerGenerateInput.parse({ targets: [target], count: 2, hero: true }),
      { gatewayFactory: gateway },
    ),
  ).rejects.toMatchObject({ status: 503 });
  expect(
    await db
      .selectFrom('commerce_prompt_targets')
      .select('id')
      .where('project_id', '=', scope.projectId)
      .execute(),
  ).toHaveLength(2);
  io.fetch.mockImplementationOnce(async () =>
    Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              prompts: [
                { text: 'best running shoes for wet trails' },
                { text: 'waterproof trail shoes for muddy hikes' },
                // Binds only through the plural fold: "shoe" meets "shoes".
                { text: 'best waterproof shoe for rainy commutes' },
              ],
            }),
          },
        },
      ],
    }),
  );
  const repeat = await generateBuyerPrompts(
    db,
    scope,
    buyerGenerateInput.parse({ targets: [target], count: 2, hero: true }),
    { gatewayFactory: gateway },
  );
  expect(repeat.map((row) => row.text)).toEqual([
    'waterproof trail shoes for muddy hikes',
    'best waterproof shoe for rainy commutes',
  ]);
});

type Row = { text: string; context?: string; stage?: string; branded?: boolean };
/** One scripted answer per model call; `null` or no answer left is a provider failure. */
function gatewayAnswering(answers: (Row[] | null)[]) {
  const io = {
    fetch: vi.fn<typeof fetch>(async () => {
      const next = answers.shift();
      if (!next) return new Response('{}', { status: 400 });
      return Response.json({
        choices: [{ message: { content: JSON.stringify({ prompts: next }) } }],
      });
    }),
    sleep: async () => {},
  };
  const gateway = () =>
    createModelGateway(
      {
        ...gatewaySettings({}),
        apiKey: 'test-only',
        model: 'claude-haiku-5-5',
        baseUrl: 'https://model.test',
      },
      io,
    );
  return { io, gateway };
}

it('replays a keyed generation retry from its stored prompts without another model call', async () => {
  const { io, gateway } = gatewayAnswering([
    [
      { text: 'best running shoes for wet trails' },
      { text: 'lightweight shoes with cushioning for long runs' },
    ],
  ]);
  const input = buyerGenerateInput.parse({ targets: [target], count: 2, hero: true });
  const keyed = { gatewayFactory: gateway, idempotencyKey: 'retry-key' };
  const first = await generateBuyerPrompts(db, scope, input, keyed);
  const again = await generateBuyerPrompts(db, scope, input, keyed);

  expect(first.map((row) => row.text)).toEqual([
    'best running shoes for wet trails',
    'lightweight shoes with cushioning for long runs',
  ]);
  expect(again.map((row) => row.id).sort()).toEqual(first.map((row) => row.id).sort());
  expect(io.fetch).toHaveBeenCalledTimes(1);
  await expect(
    generateBuyerPrompts(
      db,
      scope,
      buyerGenerateInput.parse({ targets: [target], count: 3, hero: true }),
      keyed,
    ),
  ).rejects.toMatchObject({ status: 409 });
  expect(io.fetch).toHaveBeenCalledTimes(1);
});

it('persists one generation when two requests with the same key run at once', async () => {
  const { gateway } = gatewayAnswering([
    [
      { text: 'best running shoes for wet trails' },
      { text: 'lightweight shoes with cushioning for long runs' },
    ],
    [
      { text: 'waterproof trail shoes for muddy hikes' },
      { text: 'grippy running shoes for rocky trails' },
    ],
  ]);
  const options = { gatewayFactory: gateway, idempotencyKey: 'concurrent-key' };
  const input = buyerGenerateInput.parse({ targets: [target], count: 2, hero: true });

  const [one, two] = await Promise.all([
    generateBuyerPrompts(db, scope, input, options),
    generateBuyerPrompts(db, scope, input, options),
  ]);

  const stored = await db
    .selectFrom('commerce_prompt_targets')
    .select('prompt_id')
    .where('project_id', '=', scope.projectId)
    .execute();
  const ids = (rows: readonly { id: string }[]) => rows.map((row) => row.id).sort();
  expect(stored).toHaveLength(2);
  expect(ids(two)).toEqual(ids(one));
  expect(ids(one)).toEqual(stored.map((row) => row.prompt_id).sort());
});

it("keeps each target's usable prompts and binds category prompts through the category's own name", async () => {
  await importCatalog(
    db,
    scope,
    'link,title,category,brand\nhttps://shop.test/shell,Storm shell,Rain jackets,Acme\n',
  );
  const category = await db
    .selectFrom('commerce_categories')
    .select('id')
    .where('project_id', '=', scope.projectId)
    .where('normalized_name', '=', 'rain jackets')
    .executeTakeFirstOrThrow();
  const answers = [
    // Binds only through the category name: no product or term says "jacket".
    [
      {
        text: 'cheap rain jacket that packs small for cycling',
        context: 'Commuting cyclist',
        stage: 'consideration',
      },
    ],
    // Every prompt for the product is unusable.
    [{ text: 'What do you prefer in Trail master?' }],
  ];
  const io = {
    fetch: vi.fn<typeof fetch>(async () =>
      Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                prompts: answers.shift() ?? [],
              }),
            },
          },
        ],
      }),
    ),
    sleep: async () => {},
  };
  const gateway = () =>
    createModelGateway(
      {
        ...gatewaySettings({}),
        apiKey: 'test-only',
        model: 'claude-haiku-5-5',
        baseUrl: 'https://model.test',
      },
      io,
    );
  const rows = await generateBuyerPrompts(
    db,
    scope,
    buyerGenerateInput.parse({
      targets: [{ kind: 'category', id: category.id }, target],
      count: 2,
      hero: true,
    }),
    { gatewayFactory: gateway },
  );
  expect(rows.map((row) => [row.target.kind, row.text])).toEqual([
    ['category', 'cheap rain jacket that packs small for cycling'],
  ]);
});

describe('category matrix and hero products', () => {
  const cell = (text: string, context: string, stage: string): Row => ({ text, context, stage });
  async function jacketCategory() {
    await importCatalog(
      db,
      scope,
      'link,title,category,brand\nhttps://shop.test/shell,Storm shell,Rain jackets,Acme\n',
    );
    const category = await db
      .selectFrom('commerce_categories')
      .select('id')
      .where('project_id', '=', scope.projectId)
      .where('normalized_name', '=', 'rain jackets')
      .executeTakeFirstOrThrow();
    return { kind: 'category' as const, id: category.id };
  }
  const contexts = ['Commuting cyclist', 'Weekend hiker', 'Festival goer'];
  const organicCells = [
    cell('lightweight rain jacket that packs small for cycling', contexts[0]!, 'consideration'),
    cell('which cycling rain jacket has reflective panels under $150', contexts[0]!, 'decision'),
    cell('breathable rain jacket for a long day hike', contexts[1]!, 'consideration'),
    cell('best hiking rain jacket under 200 with a hood', contexts[1]!, 'decision'),
    cell('cheap packable rain jacket for a muddy festival', contexts[2]!, 'consideration'),
    cell('is a poncho or a rain jacket better for festivals', contexts[2]!, 'decision'),
  ];
  const branded = (text: string): Row => ({ text, context: '', stage: 'decision', branded: true });
  const read = () =>
    db
      .selectFrom('prompts')
      .innerJoin('commerce_prompt_targets as t', 't.prompt_id', 'prompts.id')
      .select(['text', 'cohort', 'branded', 'buyer_stage', 'persona', 'enabled'])
      .where('t.project_id', '=', scope.projectId)
      .where('t.target_kind', '=', 'category')
      .orderBy('text')
      .execute();

  it('admits the configured contexts × stages and the branded share, disabled', async () => {
    const category = await jacketCategory();
    const { gateway } = gatewayAnswering([
      [
        ...organicCells,
        // A fourth context and a duplicate cell are over the configured matrix.
        cell('rain jacket for a ferry commuter', 'Ferry commuter', 'decision'),
        cell('another rain jacket for a commuting cyclist', 'Commuting cyclist', 'decision'),
        branded('Acme Corp rain jacket vs another brand for cycling'),
        branded('Acme Corp shell against a rival rain jacket for hiking'),
      ],
    ]);
    const rows = await generateBuyerPrompts(
      db,
      scope,
      buyerGenerateInput.parse({ targets: [category] }),
      { gatewayFactory: gateway },
    );
    expect(rows).toHaveLength(7);
    expect(rows.filter((row) => row.branded).map((row) => row.text)).toEqual([
      'Acme Corp rain jacket vs another brand for cycling',
    ]);
    const organic = rows.filter((row) => !row.branded);
    expect(new Set(organic.map((row) => `${row.context}|${row.buyer_stage}`)).size).toBe(6);
    expect(new Set(organic.map((row) => row.context))).toEqual(new Set(contexts));
    expect(rows.every((row) => !row.enabled && row.approved_at === null)).toBe(true);
    expect((await read()).filter((row) => row.branded)).toMatchObject([
      { cohort: 'comparison', branded: true, enabled: false },
    ]);
  });

  it('rejects the owned brand in non-branded prompts', async () => {
    const category = await jacketCategory();
    const { gateway } = gatewayAnswering([
      [
        cell('Acme Corp rain jacket that packs small', 'Commuting cyclist', 'consideration'),
        cell('rain jacket that packs small for cycling', 'Commuting cyclist', 'decision'),
        // A branded row that never names the brand is not a branded comparison.
        branded('rain jacket comparison between two cycling brands'),
      ],
    ]);
    const rows = await generateBuyerPrompts(
      db,
      scope,
      buyerGenerateInput.parse({ targets: [category] }),
      { gatewayFactory: gateway },
    );
    expect(rows.map((row) => row.text)).toEqual(['rain jacket that packs small for cycling']);
  });

  it('generates per-product prompts only when the product is picked as a hero', async () => {
    const { io, gateway } = gatewayAnswering([]);
    await expect(
      generateBuyerPrompts(db, scope, buyerGenerateInput.parse({ targets: [target] }), {
        gatewayFactory: gateway,
      }),
    ).rejects.toMatchObject({ status: 422, code: 'commerce_prompt_hero_required' });
    expect(io.fetch).not.toHaveBeenCalled();
    const hero = gatewayAnswering([
      [
        { text: 'best running shoes for wet trails' },
        { text: 'lightweight shoes with cushioning for long runs' },
        { text: 'waterproof trail shoes for muddy hikes' },
        { text: 'trail shoes with grip for steep descents' },
      ],
    ]);
    const rows = await generateBuyerPrompts(
      db,
      scope,
      buyerGenerateInput.parse({ targets: [target], hero: true }),
      { gatewayFactory: hero.gateway },
    );
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => !row.branded && row.context === '')).toBe(true);
  });

  it('keeps earlier targets after a later model failure', async () => {
    const category = await jacketCategory();
    const { gateway } = gatewayAnswering([organicCells, null]);
    const rows = await generateBuyerPrompts(
      db,
      scope,
      buyerGenerateInput.parse({ targets: [category, target], hero: true }),
      { gatewayFactory: gateway },
    );
    expect(rows).toHaveLength(6);
    expect(rows.every((row) => row.target.kind === 'category')).toBe(true);
  });

  it('reserves the workspace model-call quota before any model call', async () => {
    const category = await jacketCategory();
    const calls = budget('agent_provider_call', {});
    await spendBudget(db, calls, scope.workspaceId, { amount: calls.limit });
    const blocked = gatewayAnswering([organicCells]);
    await expect(
      generateBuyerPrompts(db, scope, buyerGenerateInput.parse({ targets: [category] }), {
        gatewayFactory: blocked.gateway,
      }),
    ).rejects.toMatchObject({ status: 429 });
    expect(blocked.io.fetch).not.toHaveBeenCalled();
  });
});

describe('one prompt insert path shared by candidate review and Commerce', () => {
  /** The Commerce set (created by a first buyer prompt) with one staged candidate per text. */
  async function commerceSetWithCandidates(texts: string[]) {
    await manualBuyerPrompt(
      db,
      scope,
      buyerManualInput.parse({ target, text: 'Which shoes suit muddy trails?' }),
    );
    const set = await db
      .selectFrom('prompt_sets')
      .select('id')
      .where('project_id', '=', scope.projectId)
      .where('name', '=', 'Commerce Buyer Prompts')
      .executeTakeFirstOrThrow();
    const runId = await generationRun(db, { ...scope, setId: set.id }, {});
    const ids = [];
    for (const text of texts)
      ids.push(await candidate(db, { workspaceId: scope.workspaceId, setId: set.id, runId }, text));
    return { setId: set.id, candidateIds: ids };
  }
  const texts = async (setId: string) =>
    (
      await db
        .selectFrom('prompts')
        .select('text')
        .where('prompt_set_id', '=', setId)
        .orderBy('text')
        .execute()
    ).map((row) => row.text);

  it('lets exactly one of a concurrent accept and Commerce insert of the same text in', async () => {
    const text = 'Which shoes grip wet rock?';
    const { setId, candidateIds } = await commerceSetWithCandidates([text]);
    const [review, commerce] = await Promise.allSettled([
      reviewCandidates(db, scope, setId, { accept_ids: candidateIds, reject_ids: [] }),
      manualBuyerPrompt(db, scope, buyerManualInput.parse({ target, text })),
    ]);
    const outcome = [
      review.status === 'fulfilled'
        ? `accepted ${review.value.accepted.length}, dropped ${review.value.dropped_duplicates}`
        : 'review failed',
      commerce.status === 'fulfilled' ? 'commerce inserted' : `commerce ${commerce.reason.status}`,
    ];
    expect([
      ['accepted 1, dropped 0', 'commerce 409'],
      ['accepted 0, dropped 1', 'commerce inserted'],
    ]).toContainEqual(outcome);
    expect(await texts(setId)).toEqual([
      'Which shoes grip wet rock?',
      'Which shoes suit muddy trails?',
    ]);
  });

  it('files a Commerce prompt as active and unbranded in its workspace', async () => {
    const { setId } = await commerceSetWithCandidates([]);
    const row = await db
      .selectFrom('prompts')
      .select(['cohort', 'branded', 'status', 'origin', 'workspace_id'])
      .where('prompt_set_id', '=', setId)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({
      cohort: 'commerce',
      branded: false,
      status: 'active',
      origin: 'manual',
      workspace_id: scope.workspaceId,
    });
  });
});
