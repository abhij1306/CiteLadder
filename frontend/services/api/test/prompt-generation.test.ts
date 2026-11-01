import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { enforceWorkspaceRequest, agentCallLimit } from '../src/abuse/usage.ts';
import { policy } from '../src/config.ts';
import { createApp } from '../src/app.ts';
import { record } from '../src/db/json.ts';
import { createModelGateway, gatewaySettings } from '../src/models/gateway.ts';
import { createJevClient, jevSettings } from '../src/models/jev.ts';
import { offeringMaps } from '../src/prompts/generation-context.ts';
import { generationInput } from '../src/prompts/generation-input.ts';
import { generatePrompts } from '../src/prompts/generation.ts';
import { echoDependencies, promptSet, topic, type DraftRequest } from './prompt-fixtures.ts';
import { TEST_SESSION_COOKIE, sessionToken, testConfig, testDatabase } from './support.ts';
import { VisibilityFixtures, type Tenant } from './visibility-fixtures.ts';

const db = testDatabase(),
  fixtures = new VisibilityFixtures(db);
let tenant: Tenant, setId: string;
beforeEach(async () => {
  tenant = await fixtures.tenant();
  await fixtures.brand(tenant.projectId, 'Acme');
  setId = await promptSet(db, tenant.projectId);
  await topic(db, tenant.projectId, 'Running shoes');
});
afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});
afterEach(() => vi.unstubAllEnvs());

function dependencies(judgeProbability?: number) {
  const io = {
    fetch: vi.fn<typeof fetch>(async () =>
      Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                prompts: [
                  {
                    slot_id: 'q1',
                    text: 'Which running shoes cushion sore knees?',
                    buyer_stage: 'consideration',
                    prompt_intent: 'recommend',
                  },
                  {
                    slot_id: 'q2',
                    text: 'Which running shoes grip wet trails?',
                    buyer_stage: 'decision',
                    prompt_intent: 'buy',
                  },
                ],
              }),
            },
          },
        ],
      }),
    ),
    sleep: async () => {},
  };
  const gateway = createModelGateway(
    {
      ...gatewaySettings({}),
      apiKey: 'test-only',
      model: 'claude-haiku-5-5',
      baseUrl: 'https://model.test',
    },
    io,
  );
  const judgeFetch = vi.fn<typeof fetch>(async () =>
    Response.json({
      model: 'test-judge',
      answers: Object.fromEntries(
        Object.keys({
          ...policy.models.quality.noul_questions,
          ...policy.models.quality.core_noul_questions,
        }).map((key) => [key, { noul: judgeProbability }]),
      ),
    }),
  );
  const judge =
    judgeProbability === undefined
      ? null
      : createJevClient(
          { ...jevSettings({}), apiKey: 'test-only' },
          { fetch: judgeFetch, sleep: async () => {} },
        );
  return { gateway: () => gateway, judge: () => judge, io, judgeFetch };
}
const selectedTopic = async () =>
  (
    await db
      .selectFrom('topics')
      .select('id')
      .where('project_id', '=', tenant.projectId)
      .executeTakeFirstOrThrow()
  ).id;
const oneSlotBatches = () => {
  vi.stubEnv('GENERATION_MODEL_BATCH_SIZE', '1');
  vi.stubEnv('GENERATION_DRAFT_CONCURRENCY', '1');
};
/** A tenant whose project has a brand profile but no topics, and its prompt set. */
async function topiclessProject(business: Record<string, unknown>, offerings: string[] = []) {
  const other = await fixtures.tenant();
  await fixtures.brand(other.projectId, 'Strider');
  const brand = await db
    .selectFrom('brands')
    .select('id')
    .where('project_id', '=', other.projectId)
    .executeTakeFirstOrThrow();
  const otherSet = await promptSet(db, other.projectId);
  const now = new Date();
  await db
    .insertInto('brand_profiles')
    .values({
      id: randomUUID(),
      workspace_id: other.workspaceId,
      project_id: other.projectId,
      brand_id: brand.id,
      business_context: JSON.stringify(business),
      description: '',
      positioning: '',
      target_audience: '',
      products_services: JSON.stringify(offerings),
      sources: JSON.stringify({
        products_services: { origin: 'ai_suggested', review_state: 'unreviewed' },
      }),
      source_artifact_ids: '{}',
      created_at: now,
      updated_at: now,
    })
    .execute();
  return { other, otherSet };
}
const mapEntry = (value: string) => ({
  value,
  origin: 'manual',
  review_state: 'confirmed',
  reviewed_by: null,
  reviewed_at: null,
  source: {},
});
const input = () => generationInput.parse({ count: 2 });
const generate = (deps: Parameters<typeof generatePrompts>[4] = dependencies()) =>
  generatePrompts(db, tenant.workspaceId, setId, input(), deps);

describe('prompt generation at the PostgreSQL boundary', () => {
  it('stages candidates and preserves provenance', async () => {
    const since = new Date();
    const deps = dependencies();
    const result = await generate(deps);
    expect(result.candidates).toHaveLength(2);
    // Every model call is recorded, never charged.
    const charged = await db
      .selectFrom('platform_calls')
      .select(['feature', 'charge', 'credits'])
      .where('workspace_id', '=', tenant.workspaceId)
      .where('created_at', '>=', since)
      .execute();
    expect(charged).toEqual(
      Array.from({ length: deps.io.fetch.mock.calls.length }, () => ({
        feature: 'prompt_generation',
        charge: 'not_charged',
        credits: 0,
      })),
    );
    expect(
      await db.selectFrom('prompts').select('id').where('prompt_set_id', '=', setId).execute(),
    ).toEqual([]);
    const run = await db
      .selectFrom('prompt_generation_runs')
      .select('provenance')
      .where('id', '=', result.candidates[0]!.run_id)
      .executeTakeFirstOrThrow();
    expect(run.provenance).toMatchObject({
      generator_version: policy.prompts.generation.version,
      quality_gate: 'off',
      distribution: { selected: { total: 2, located: 0 } },
    });
  });
  it('keeps strong JEV failures only as text-free outcomes, recording the judge uncharged', async () => {
    const since = new Date();
    const result = await generate(dependencies(0.01));
    const judged = await db
      .selectFrom('platform_calls')
      .select(['charge', 'credits'])
      .where('workspace_id', '=', tenant.workspaceId)
      .where('feature', '=', 'prompt_quality_judge')
      .where('created_at', '>=', since)
      .execute();
    // One judge call per draft.
    expect(judged).toEqual([
      { charge: 'not_charged', credits: 0 },
      { charge: 'not_charged', credits: 0 },
    ]);
    expect(result.candidates).toEqual([]);
    expect(result.quality_rejected).toBe(2);
    const rows = await db
      .selectFrom('prompt_candidates')
      .select(['text', 'normalized_text_hash', 'disposition'])
      .where('prompt_set_id', '=', setId)
      .execute();
    expect(rows).toEqual(
      Array.from({ length: 2 }, () => ({
        text: '',
        normalized_text_hash: '',
        disposition: 'gate_rejected',
      })),
    );
  });
  it('reserves the shared agent budget before provider I/O and refuses excess on an empty window', async () => {
    const limit = agentCallLimit(1);
    await expect(
      enforceWorkspaceRequest(db, tenant.workspaceId, { ...limit, amount: limit.limit + 1 }),
    ).rejects.toMatchObject({ status: 429 });
    await enforceWorkspaceRequest(db, tenant.workspaceId, { ...limit, amount: limit.limit });
    const deps = dependencies();
    await expect(generate(deps)).rejects.toMatchObject({ status: 429 });
    expect(deps.io.fetch).not.toHaveBeenCalled();
  });
  it('windows platform judge calls per workspace across runs', async () => {
    const deps = dependencies(0.9);
    await generate(deps);
    const judged = deps.judgeFetch.mock.calls.length;
    expect(judged).toBeGreaterThan(0);
    // The day's window is now exactly spent, so the next run's judging is
    // refused; clearing the staged drafts lets the same drafts be admitted again.
    vi.stubEnv('ABUSE_PROMPT_JUDGE_CALLS_PER_WORKSPACE_DAILY', String(judged));
    await db
      .deleteFrom('prompt_candidates')
      .where('workspace_id', '=', tenant.workspaceId)
      .where('prompt_set_id', '=', setId)
      .execute();
    await expect(generate(deps)).rejects.toMatchObject({ status: 429 });
    expect(deps.judgeFetch).toHaveBeenCalledTimes(judged);
    const runs = await db
      .selectFrom('prompt_generation_runs')
      .select('id')
      .where('workspace_id', '=', tenant.workspaceId)
      .execute();
    expect(runs).toHaveLength(1);
  });
  it('refuses foreign sets before configuring or calling a model', async () => {
    const other = await fixtures.tenant(),
      deps = dependencies();
    await expect(
      generatePrompts(db, other.workspaceId, setId, input(), deps),
    ).rejects.toMatchObject({ status: 404 });
    expect(deps.io.fetch).not.toHaveBeenCalled();
    const config = testConfig();
    const token = await sessionToken({ sub: other.userId, ver: 0 });
    const response = await createApp(config, db).request(`/api/v1/prompt-sets/${setId}/generate`, {
      method: 'POST',
      headers: {
        cookie: `${TEST_SESSION_COOKIE}=${token}`,
        'x-workspace-id': tenant.workspaceId,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ count: 2 }),
    });
    expect(response.status).toBe(404);
  });
  it('stages earlier batches when a later batch fails, and fails only with nothing admitted', async () => {
    oneSlotBatches();
    const result = await generatePrompts(
      db,
      tenant.workspaceId,
      setId,
      generationInput.parse({ count: 3 }),
      echoDependencies({ fail: [3, 4, 5, 6, 7] }),
    );
    expect(result.candidates).toHaveLength(2);
    expect(result.shortfall_reason).toBe('model_error');
    const run = await db
      .selectFrom('prompt_generation_runs')
      .select('provenance')
      .where('id', '=', result.candidates[0]!.run_id)
      .executeTakeFirstOrThrow();
    expect(run.provenance).toMatchObject({
      stop_reason: 'model_error',
      model_results: expect.arrayContaining([{ batch: 2, error_code: 'client_error' }]),
    });
    await expect(generate(echoDependencies({ fail: [1, 2, 3, 4, 5] }))).rejects.toMatchObject({
      status: 502,
    });
  });
  it('stops starting batches at the deadline and stages what was admitted', async () => {
    oneSlotBatches();
    const deadline = new AbortController();
    const deps = {
      ...echoDependencies({
        onCall: (call) => {
          if (call === 1) deadline.abort();
        },
      }),
      deadline: () => deadline.signal,
    };
    const result = await generatePrompts(db, tenant.workspaceId, setId, input(), deps);
    expect(deps.io.fetch).toHaveBeenCalledTimes(1);
    expect(result.candidates).toHaveLength(1);
    expect(result.shortfall_reason).toBe('deadline');
  });
  it('replays a repeated Idempotency-Key from persisted rows without a model call', async () => {
    const first = await generatePrompts(
      db,
      tenant.workspaceId,
      setId,
      input(),
      echoDependencies(),
      'retry-key',
    );
    const deps = echoDependencies();
    const again = await generatePrompts(db, tenant.workspaceId, setId, input(), deps, 'retry-key');
    expect(deps.io.fetch).not.toHaveBeenCalled();
    expect(again.candidates.map((row) => row.id).toSorted()).toEqual(
      first.candidates.map((row) => row.id).toSorted(),
    );
    expect(again.requested_count).toBe(first.requested_count);
    await expect(
      generatePrompts(
        db,
        tenant.workspaceId,
        setId,
        generationInput.parse({ count: 3 }),
        deps,
        'retry-key',
      ),
    ).rejects.toMatchObject({ status: 409 });
    const other = await fixtures.tenant();
    await expect(
      generatePrompts(db, other.workspaceId, setId, input(), deps, 'retry-key'),
    ).rejects.toMatchObject({ status: 404 });
    expect(deps.io.fetch).not.toHaveBeenCalled();
  });
  it('plans a requested distribution: cohort quotas, the run note, and idempotency over all of it', async () => {
    const requests: DraftRequest[] = [];
    const request = generationInput.parse({
      count: 4,
      run_context: 'Spring marathon season',
      distribution: { branded_share: 0.5 },
    });
    const result = await generatePrompts(
      db,
      tenant.workspaceId,
      setId,
      request,
      echoDependencies({ onRequest: (sent) => requests.push(sent) }),
      'distribution-key',
    );
    expect(result.candidates.map((row) => row.cohort).toSorted()).toEqual([
      'brand_diagnostic',
      'brand_diagnostic',
      'core',
      'core',
    ]);
    const briefs = Object.fromEntries(
      requests.map((sent) => [String(sent.slots[0]!.cohort), sent.reference]),
    );
    expect(briefs.core).toMatchObject({ run_context: 'Spring marathon season' });
    expect(briefs.core).not.toHaveProperty('brand_name');
    expect(briefs.brand_diagnostic).toMatchObject({ brand_name: 'Acme' });
    const run = await db
      .selectFrom('prompt_generation_runs')
      .select('provenance')
      .where('id', '=', result.candidates[0]!.run_id)
      .executeTakeFirstOrThrow();
    expect(run.provenance).toMatchObject({
      run_context: 'Spring marathon season',
      requested_distribution: { branded_share: 0.5, comparison_share: 0, personas: [] },
      cohort_quotas: { core: 2, brand_diagnostic: 2, comparison: 0 },
      seed_source: null,
      seed_query_ids: [],
      topic_recovery: null,
    });
    const deps = echoDependencies();
    const again = await generatePrompts(
      db,
      tenant.workspaceId,
      setId,
      request,
      deps,
      'distribution-key',
    );
    expect(again.candidates.map((row) => row.id).toSorted()).toEqual(
      result.candidates.map((row) => row.id).toSorted(),
    );
    await expect(
      generatePrompts(
        db,
        tenant.workspaceId,
        setId,
        generationInput.parse({ ...request, distribution: { branded_share: 0.25 } }),
        deps,
        'distribution-key',
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(deps.io.fetch).not.toHaveBeenCalled();
    await expect(
      generatePrompts(
        db,
        tenant.workspaceId,
        setId,
        generationInput.parse({ count: 2, distribution: { comparison_share: 0.5 } }),
        deps,
      ),
    ).rejects.toMatchObject({ status: 422 });
    expect(deps.io.fetch).not.toHaveBeenCalled();
  });
  it('never recovers topics for a request naming topics, and checks they are owned first', async () => {
    const { other, otherSet } = await topiclessProject({ category_terms: ['running shoes'] }, [
      'Trail running shoes',
    ]);
    const deps = echoDependencies({
      topics: [{ name: 'Trail running shoes', offerings: ['Trail running shoes'] }],
    });
    // Another project's topic and an unknown id both fail before any model call or write.
    for (const id of [await selectedTopic(), randomUUID()])
      await expect(
        generatePrompts(
          db,
          other.workspaceId,
          otherSet,
          generationInput.parse({ count: 2, topic_ids: [id] }),
          deps,
        ),
      ).rejects.toMatchObject({ status: 422 });
    expect(deps.io.fetch).not.toHaveBeenCalled();
    expect(
      await db
        .selectFrom('topics')
        .select('id')
        .where('project_id', '=', other.projectId)
        .execute(),
    ).toEqual([]);
  });
  it('refuses a comparison share without competitors before recovering any topic', async () => {
    const { other, otherSet } = await topiclessProject({ category_terms: ['running shoes'] }, [
      'Trail running shoes',
    ]);
    const deps = echoDependencies({
      topics: [{ name: 'Trail running shoes', offerings: ['Trail running shoes'] }],
    });
    await expect(
      generatePrompts(
        db,
        other.workspaceId,
        otherSet,
        generationInput.parse({ count: 2, distribution: { comparison_share: 0.5 } }),
        deps,
      ),
    ).rejects.toMatchObject({ status: 422 });
    expect(deps.io.fetch).not.toHaveBeenCalled();
    expect(
      await db
        .selectFrom('topics')
        .select('id')
        .where('project_id', '=', other.projectId)
        .execute(),
    ).toEqual([]);
  });
  it('proposes buyer-facing topics from the saved offerings, before drafting', async () => {
    const offerings = ['Pro Series running shoes', 'Strider trail shoes (sizes 9-13)'];
    const { other, otherSet } = await topiclessProject({
      category_terms: ['running shoes'],
      business_map: {
        offerings: [
          {
            offering: offerings[0],
            attributes: [mapEntry('carbon plate')],
            situations: [],
            audiences: [],
            exclusions: [],
          },
          {
            offering: offerings[1],
            attributes: [],
            situations: [mapEntry('muddy trails')],
            audiences: [],
            exclusions: [],
          },
        ],
      },
    });
    const requests: DraftRequest[] = [];
    const deps = echoDependencies({
      topics: [
        { name: 'Road running shoes', offerings: [offerings[0]!] },
        { name: 'Strider trail shoes', offerings: [offerings[1]!] },
      ],
      onRequest: (sent) => requests.push(sent),
    });
    const run = () =>
      generatePrompts(db, other.workspaceId, otherSet, generationInput.parse({ count: 2 }), deps);
    // With no saved offerings there is nothing to ground topics in, and nothing reaches the model.
    await expect(run()).rejects.toMatchObject({ status: 422 });
    expect(deps.io.fetch).not.toHaveBeenCalled();
    // Onboarding saves the offerings its reader reviewed as unreviewed; they ground topics.
    await db
      .updateTable('brand_profiles')
      .set({ products_services: JSON.stringify(offerings) })
      .where('project_id', '=', other.projectId)
      .execute();
    const result = await run();
    expect(
      await db
        .selectFrom('topics')
        .select(['name', 'origin'])
        .where('project_id', '=', other.projectId)
        .orderBy('name')
        .execute(),
    ).toEqual([
      { name: 'Road running shoes', origin: 'generated' },
      { name: 'Trail shoes', origin: 'generated' },
    ]);
    expect(result.candidates).toHaveLength(2);
    const provenance = await db
      .selectFrom('prompt_generation_runs')
      .select('provenance')
      .where('id', '=', result.candidates[0]!.run_id)
      .executeTakeFirstOrThrow();
    expect(provenance.provenance).toMatchObject({
      topic_recovery: {
        source: 'model',
        created: [
          { name: 'Road running shoes', offerings: [offerings[0]] },
          { name: 'Trail shoes', offerings: [offerings[1]] },
        ],
        overflow: [],
        dropped: [],
      },
    });
    // Each category keeps the business-map facets of the offering it was
    // proposed from, under its own buyer-facing name.
    const needs = requests
      .flatMap((sent) => sent.slots)
      .map((slot) => slot.buyer_need)
      .toSorted((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    expect(needs).toEqual([
      { offering: 'Road running shoes', attribute: 'carbon plate' },
      { offering: 'Road running shoes', attribute: 'carbon plate' },
      { offering: 'Trail shoes', situation_or_constraint: 'muddy trails' },
      { offering: 'Trail shoes', situation_or_constraint: 'muddy trails' },
    ]);
  });
  it('keeps only single-facet map suggestions, never a value listing alternatives', async () => {
    const offering = 'Trail running shoes';
    const { other, otherSet } = await topiclessProject({ category_terms: ['running shoes'] }, [
      offering,
    ]);
    const deps = echoDependencies({
      topics: [{ name: offering, offerings: [offering] }],
      maps: [
        {
          offering,
          attributes: ['Waterproof upper', 'Wide or narrow fit'],
          situations: ['Muddy trails, rocky paths', 'Muddy trails'],
          audiences: ['Beginners'],
        },
      ],
    });
    await generatePrompts(
      db,
      other.workspaceId,
      otherSet,
      generationInput.parse({ count: 2 }),
      deps,
    );
    const profile = await db
      .selectFrom('brand_profiles')
      .select('business_context')
      .where('project_id', '=', other.projectId)
      .executeTakeFirstOrThrow();
    const [map] = offeringMaps(record(profile.business_context));
    expect({
      attributes: map?.attributes.map((entry) => entry.value),
      situations: map?.situations.map((entry) => entry.value),
      audiences: map?.audiences.map((entry) => entry.value),
    }).toEqual({
      attributes: ['Waterproof upper'],
      situations: ['Muddy trails'],
      audiences: ['Beginners'],
    });
  });
  it('serializes concurrent staging on the same set and drops newly pending duplicates', async () => {
    const deps = dependencies();
    const results = await Promise.all([generate(deps), generate(deps)]);
    expect(results.reduce((count, result) => count + result.candidates.length, 0)).toBe(2);
    expect(
      await db
        .selectFrom('prompt_generation_runs')
        .select('id')
        .where('prompt_set_id', '=', setId)
        .execute(),
    ).toHaveLength(2);
  });
});
