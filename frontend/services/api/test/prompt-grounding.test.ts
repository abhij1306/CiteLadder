import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';

import { policy } from '../src/config.ts';
import { generationInput, generationSetting } from '../src/prompts/generation-input.ts';
import { generatePrompts } from '../src/prompts/generation.ts';
import { loadObservedQueries } from '../src/prompts/observed-queries.ts';
import { readSeedQueries } from '../src/prompts/seed-queries.ts';
import { echoDependencies, promptSet, topic, type DraftRequest } from './prompt-fixtures.ts';
import { searchIntelligenceRun } from './search-intelligence-fixtures.ts';
import { testDatabase } from './support.ts';
import { VisibilityFixtures, type Tenant } from './visibility-fixtures.ts';

const db = testDatabase(),
  fixtures = new VisibilityFixtures(db);
const tenants: Tenant[] = [];
const day = 86_400_000;
const isoDay = (offsetDays: number) => new Date(Date.now() - offsetDays * day);

afterAll(async () => {
  const workspaces = tenants.map((tenant) => tenant.workspaceId);
  for (const table of [
    'prompt_candidates',
    'prompt_generation_runs',
    'branded_query_overrides',
    'search_intelligence_rows',
    'search_intelligence_datasets',
    'search_intelligence_runs',
    'provider_connections',
  ] as const)
    await db.deleteFrom(table).where('workspace_id', 'in', workspaces).execute();
  await fixtures.cleanup();
  await db.destroy();
});

async function project() {
  const tenant = await fixtures.tenant();
  tenants.push(tenant);
  await fixtures.brand(tenant.projectId, 'Acme');
  await fixtures.competitor(tenant.projectId, { name: 'Rival' });
  const topicId = await topic(db, tenant.projectId, 'Running shoes');
  const setId = await promptSet(db, tenant.projectId);
  return { ...tenant, topicId, setId };
}
type Project = Awaited<ReturnType<typeof project>>;

/** One query snapshot with its per-day rows, as Search Console import leaves it. */
async function searchConsole(
  p: Project,
  windowEnd: Date,
  rows: { query: string; impressions: number; daysAgo: number }[],
) {
  const snapshotId = randomUUID(),
    at = new Date();
  await db
    .insertInto('query_evidence_snapshots')
    .values({
      id: snapshotId,
      workspace_id: p.workspaceId,
      project_id: p.projectId,
      window_start: new Date(windowEnd.getTime() - 180 * day),
      window_end: windowEnd,
      source_hash: snapshotId,
      supersedes_snapshot_id: null,
      state: 'complete',
      source_metric_row_ids: '[]',
      source_artifact_ids: '[]',
      coverage: '{}',
      limitations: '[]',
      analyzer_version: 'test',
      resolver_version: 'test',
      created_at: at,
    })
    .execute();
  const ids: string[] = [];
  for (const row of rows) {
    const id = randomUUID();
    ids.push(id);
    await db
      .insertInto('query_evidence_rows')
      .values({
        id,
        snapshot_id: snapshotId,
        workspace_id: p.workspaceId,
        project_id: p.projectId,
        date: isoDay(row.daysAgo),
        normalized_query: row.query,
        observed_page_url: 'https://www.example.com/shoes',
        site_url_id: null,
        resolved_page_url: 'https://www.example.com/shoes',
        resolution_outcome: 'resolved',
        resolution_candidates: '[]',
        property_ref: 'sc-domain:example.com',
        impressions: row.impressions,
        clicks: 1,
        ctr: null,
        position: null,
        source_metric_row_id: randomUUID(),
        source_artifact_id: randomUUID(),
        importer_version: 'test',
        resolver_version: 'test',
        created_at: at,
      })
      .execute();
  }
  return ids;
}

/** One Search Intelligence dataset with keyword rows. */
async function keywordResearch(
  p: Project,
  options: { kind: string; language: string; status: string },
  keywords: { keyword: string; volume: number }[],
) {
  const at = new Date(),
    datasetId = randomUUID(),
    runId = await searchIntelligenceRun(db, p);
  await db
    .insertInto('search_intelligence_datasets')
    .values({
      id: datasetId,
      workspace_id: p.workspaceId,
      project_id: p.projectId,
      run_id: runId,
      dataset_kind: options.kind,
      scope_hash: datasetId,
      target_domain: 'example.com',
      target_hostname: 'www.example.com',
      target_origin: 'https://www.example.com',
      comparison_origin: '',
      location_code: 2840,
      language_code: options.language,
      status: options.status,
      coverage: 'complete',
      requested_rows: 100,
      raw_rows_received: keywords.length,
      unique_rows_saved: keywords.length,
      truncated: false,
      summary: '{}',
      provider_filters: '{}',
      parser_version: '1',
      published_at: options.status === 'published' ? at : null,
      created_at: at,
    })
    .execute();
  const ids: string[] = [];
  for (const [index, row] of keywords.entries()) {
    const id = randomUUID();
    ids.push(id);
    await db
      .insertInto('search_intelligence_rows')
      .values({
        id,
        workspace_id: p.workspaceId,
        project_id: p.projectId,
        dataset_id: datasetId,
        provider_row_key: `row:${index}`,
        row_kind: options.kind,
        keyword: row.keyword,
        domain: '',
        url: 'https://www.example.com/shoes',
        intent: 'commercial',
        search_volume: row.volume,
        auxiliary: '{}',
        created_at: at,
      })
      .execute();
  }
  return ids;
}

const load = (p: Project, workspaceId = p.workspaceId) =>
  loadObservedQueries(db, {
    workspaceId,
    projectId: p.projectId,
    languageCode: 'en',
    topics: [{ id: p.topicId, name: 'Running shoes', description: '' }],
    competitors: [{ aliases: ['Rival'], rule: undefined }],
  });

/** Persisted Search Console and keyword rows a grounded project starts from. */
async function groundedProject() {
  const p = await project();
  // An older snapshot is superseded by the latest one and never read.
  await searchConsole(p, isoDay(30), [
    { query: 'running shoes for wide feet', impressions: 1000, daysAgo: 31 },
  ]);
  const [flatFeetTop] = await searchConsole(p, isoDay(1), [
    { query: 'best running shoes for flat feet', impressions: 30, daysAgo: 2 },
    { query: 'best running shoes for flat feet', impressions: 20, daysAgo: 5 },
    { query: 'running shoes for marathon training', impressions: 9, daysAgo: 2 },
    { query: 'running shoes for winter mornings', impressions: 100, daysAgo: 120 },
    { query: 'acme running shoes review', impressions: 500, daysAgo: 2 },
    { query: 'rival running shoes sale', impressions: 400, daysAgo: 2 },
    { query: 'cheap pizza delivery tonight', impressions: 300, daysAgo: 2 },
    { query: 'shoes', impressions: 200, daysAgo: 2 },
    { query: 'which shoes', impressions: 15, daysAgo: 2 },
  ]);
  const [trail] = await keywordResearch(
    p,
    { kind: 'ranking_keywords', language: 'en', status: 'published' },
    [
      { keyword: 'Trail running shoes waterproof', volume: 900 },
      { keyword: 'best running shoes for flat feet', volume: 5000 },
    ],
  );
  await keywordResearch(p, { kind: 'missing_keywords', language: 'en', status: 'collecting' }, [
    { keyword: 'running shoes clearance outlet', volume: 9000 },
  ]);
  await keywordResearch(p, { kind: 'shared_keywords', language: 'de', status: 'published' }, [
    { keyword: 'running shoes damen laufen', volume: 9000 },
  ]);
  // A user override confirming a short question as non-branded.
  const whichOverride = randomUUID();
  await db
    .insertInto('branded_query_overrides')
    .values({
      id: whichOverride,
      workspace_id: p.workspaceId,
      project_id: p.projectId,
      normalized_query: 'which shoes',
      classification: 'non_branded',
      classifier_version: 'override-test',
      actor_user_id: p.userId,
      created_at: new Date(),
    })
    .execute();
  return { p, flatFeetTop: flatFeetTop!, trail: trail!, whichOverride };
}

describe('observed queries at the PostgreSQL boundary', () => {
  it('keeps non-branded, topic-bound searches from the latest snapshot and published datasets', async () => {
    const { p, flatFeetTop, trail, whichOverride } = await groundedProject();
    expect(await load(p)).toEqual([
      {
        id: flatFeetTop,
        source: 'gsc',
        text: 'best running shoes for flat feet',
        topic_id: p.topicId,
        weight: 50,
        classifier_version: 'branded-query-1',
        override_id: null,
      },
      {
        id: expect.any(String),
        source: 'gsc',
        text: 'which shoes',
        topic_id: p.topicId,
        weight: 15,
        // The user's override admitted it; its identity travels with the search.
        classifier_version: 'override-test',
        override_id: whichOverride,
      },
      {
        id: trail,
        source: 'search_intelligence',
        text: 'trail running shoes waterproof',
        topic_id: p.topicId,
        weight: 900,
        classifier_version: 'branded-query-1',
        override_id: null,
      },
    ]);
    // The same rows are invisible from another workspace.
    const other = await fixtures.tenant();
    tenants.push(other);
    expect((await load(p, other.workspaceId)).map((row) => row.text)).toEqual([]);
    expect(await load(p)).toHaveLength(3);
  });

  it('counts words in a search written without spaces', async () => {
    const p = await project();
    const teaId = await topic(db, p.projectId, '緑茶');
    await searchConsole(p, isoDay(1), [
      { query: '緑茶のおすすめギフト', impressions: 40, daysAgo: 2 },
      { query: '緑茶', impressions: 90, daysAgo: 2 },
    ]);
    const observed = await loadObservedQueries(db, {
      workspaceId: p.workspaceId,
      projectId: p.projectId,
      languageCode: 'ja',
      topics: [{ id: teaId, name: '緑茶', description: '' }],
      competitors: [],
    });
    expect(observed.map((row) => [row.text, row.topic_id])).toEqual([
      ['緑茶のおすすめギフト', teaId],
    ]);
  });

  it('caps each topic at the configured number of searches, heaviest first', async () => {
    const { p } = await groundedProject();
    const observed = policy.prompts.generation.observed;
    const cap = observed.max_per_topic;
    observed.max_per_topic = 2;
    try {
      expect((await load(p)).map((row) => row.text)).toEqual([
        'best running shoes for flat feet',
        'which shoes',
      ]);
    } finally {
      observed.max_per_topic = cap;
    }
  });
});

describe('seed queries for the Prompt Builder', () => {
  it('lists what each persisted source would ground on, without weights', async () => {
    const { p, flatFeetTop, trail } = await groundedProject();
    expect(await readSeedQueries(db, p.workspaceId, p.projectId)).toEqual({
      sources: [
        {
          source: 'search_console',
          queries: [
            { id: flatFeetTop, text: 'best running shoes for flat feet', topic_id: p.topicId },
            { id: expect.any(String), text: 'which shoes', topic_id: p.topicId },
          ],
        },
        {
          // The keyword Search Console already supplied is read once, from Search Console.
          source: 'search_intelligence',
          queries: [{ id: trail, text: 'trail running shoes waterproof', topic_id: p.topicId }],
        },
      ],
    });
  });

  it('lists no source a project has no data for, and hides other workspaces', async () => {
    const p = await project();
    expect(await readSeedQueries(db, p.workspaceId, p.projectId)).toEqual({ sources: [] });
    await searchConsole(p, isoDay(1), [
      { query: 'acme running shoes', impressions: 50, daysAgo: 2 },
    ]);
    // Connected, but nothing usable: the source is listed with no queries.
    expect(await readSeedQueries(db, p.workspaceId, p.projectId)).toEqual({
      sources: [{ source: 'search_console', queries: [] }],
    });
    const other = await fixtures.tenant();
    tenants.push(other);
    await expect(readSeedQueries(db, other.workspaceId, p.projectId)).rejects.toMatchObject({
      status: 404,
    });
  });
});

/** Echo dependencies that record each draft request the model received. */
function recordingGateway() {
  const requests: DraftRequest[] = [];
  return {
    dependencies: echoDependencies({ onRequest: (request) => requests.push(request) }),
    requests,
  };
}

/** A candidate's or run's observed-search ref, with the classification that admitted it. */
const ref = (
  source: string,
  id: unknown,
  classifier_version = 'branded-query-1',
  override_id: unknown = null,
) => ({ kind: 'observed_query', source, id, classifier_version, override_id });

describe('grounded generation', () => {
  it('steers drafts with example searches and records refs, provenance and the tag flag', async () => {
    const { p, flatFeetTop, trail, whichOverride } = await groundedProject();
    const { dependencies, requests } = recordingGateway();
    const response = await generatePrompts(
      db,
      p.workspaceId,
      p.setId,
      generationInput.parse({ count: 2 }),
      dependencies,
    );
    const planned = 2 * generationSetting('overgenerate_factor');
    expect(requests[0]!.system).toContain('buyer_search_examples');
    expect(requests[0]!.slots[0]).toMatchObject({
      // Closest to the "Running shoes" cell first; the loader's ranking breaks ties.
      buyer_search_examples: [
        'best running shoes for flat feet',
        'trail running shoes waterproof',
        'which shoes',
      ],
    });
    expect(requests[0]!.slots[0]).not.toHaveProperty('grounding');
    expect(response.candidates.map((candidate) => candidate.grounded)).toEqual([true, true]);
    const candidate = await db
      .selectFrom('prompt_candidates')
      .select('evidence_refs')
      .where('workspace_id', '=', p.workspaceId)
      .where('prompt_set_id', '=', p.setId)
      .executeTakeFirstOrThrow();
    expect(candidate.evidence_refs).toEqual([
      expect.objectContaining({ kind: 'business_map_cell', offering: 'Running shoes' }),
      ref('gsc', flatFeetTop),
      ref('search_intelligence', trail),
      ref('gsc', expect.any(String), 'override-test', whichOverride),
    ]);
    const run = await db
      .selectFrom('prompt_generation_runs')
      .select('provenance')
      .where('workspace_id', '=', p.workspaceId)
      .executeTakeFirstOrThrow();
    expect(run.provenance).toMatchObject({
      generator_version: 'prompt-gen-v1',
      grounding: {
        gsc: 2,
        search_intelligence: 1,
        slots_grounded: planned,
        searches_read: 3,
        searches: [
          ref('gsc', flatFeetTop),
          ref('search_intelligence', trail),
          ref('gsc', expect.any(String), 'override-test', whichOverride),
        ],
      },
    });
  });

  it('sends the same request as before when the project has no search data', async () => {
    const p = await project();
    const { dependencies, requests } = recordingGateway();
    const response = await generatePrompts(
      db,
      p.workspaceId,
      p.setId,
      generationInput.parse({ count: 2 }),
      dependencies,
    );
    expect(requests[0]!.system).not.toContain('buyer_search_examples');
    expect(requests[0]!.slots.map((slot) => Object.keys(slot).sort())).toEqual(
      requests[0]!.slots.map(() => [
        'allowed_prompt_intents',
        'buyer_need',
        'cohort',
        'evidence_ref',
        'slot_id',
        'target_buyer_stage',
        'target_prompt_intents',
        'topic_description',
        'topic_id',
        'topic_name',
      ]),
    );
    expect(response.candidates.map((candidate) => candidate.grounded)).toEqual([false, false]);
    const run = await db
      .selectFrom('prompt_generation_runs')
      .select('provenance')
      .where('workspace_id', '=', p.workspaceId)
      .executeTakeFirstOrThrow();
    expect(run.provenance).toMatchObject({
      grounding: {
        gsc: 0,
        search_intelligence: 0,
        slots_grounded: 0,
        searches_read: 0,
        searches: [],
      },
    });
  });
});
