import { createHash, randomUUID } from 'node:crypto';

import type {
  searchDatasetPageSchema,
  searchDatasetSchema,
  searchReadinessSchema,
  searchRunSchema,
} from '@citeladder/contracts/search-intelligence';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { createApp } from '../src/app.ts';
import { policy } from '../src/config.ts';
import { WorkspaceScope } from '../src/db/workspace-scope.ts';
import { contentHandoff } from '../src/search-intelligence/reads.ts';
import { TEST_SESSION_COOKIE, sessionToken, testConfig, testDatabase } from './support.ts';
import { VisibilityFixtures, type Tenant } from './visibility-fixtures.ts';

type Readiness = z.output<typeof searchReadinessSchema>;
type Run = z.output<typeof searchRunSchema>;
type Dataset = z.output<typeof searchDatasetSchema>;
type Page = z.output<typeof searchDatasetPageSchema>;
type ErrorBody = { error: { code: string } };

const si = policy.search_intelligence;
const REVISION = randomUUID();
const db = testDatabase();
const fixtures = new VisibilityFixtures(db);
const config = testConfig();
const app = createApp(config, db);
const now = () => new Date();
const tenants: Tenant[] = [];
let t: Tenant;

type Request = {
  method?: string;
  body?: unknown;
  user?: string;
  project?: string;
  headers?: Record<string, string>;
};

async function call<T>(path: string, options: Request = {}) {
  const token = await sessionToken({ sub: options.user ?? t.userId, ver: 0 });
  const headers: Record<string, string> = {
    cookie: `${TEST_SESSION_COOKIE}=${token}`,
    ...options.headers,
  };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  const response = await app.request(
    `/api/v1/projects/${options.project ?? t.projectId}/search-intelligence${path}`,
    {
      method: options.method ?? 'GET',
      headers,
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    },
  );
  return { status: response.status, body: (await response.json()) as T };
}

async function connection(tenant: Tenant, options: { active?: boolean; tested?: boolean } = {}) {
  const id = randomUUID();
  await db
    .insertInto('provider_connections')
    .values({
      id,
      workspace_id: tenant.workspaceId,
      label: 'DataForSEO',
      transport_provider: si.transport_provider,
      api_key_encrypted: 'ciphertext',
      base_url: '',
      credential_revision: REVISION,
      active: options.active ?? true,
      last_test_status: options.tested === false ? 'failed' : si.connection_test_ok,
      created_at: now(),
      updated_at: now(),
    })
    .execute();
  return id;
}

/** A run as the review creator writes it. */
async function review(
  tenant: Tenant,
  connectionId: string,
  options: {
    status?: string;
    callPlan?: object[];
    expiresAt?: Date;
    pricingVersion?: string;
    revision?: string;
    createdAt?: Date;
    confirmedAt?: Date;
  } = {},
) {
  const id = randomUUID();
  await db
    .insertInto('search_intelligence_runs')
    .values({
      id,
      workspace_id: tenant.workspaceId,
      project_id: tenant.projectId,
      actor_user_id: tenant.userId,
      connection_id: connectionId,
      connection_revision: options.revision ?? REVISION,
      account_identity: 'account',
      credential_source: 'byok',
      estimated_credits: null,
      charged_credits: null,
      platform_call_id: null,
      status: options.status ?? 'reviewed',
      action: 'analysis',
      idempotency_key: id,
      frozen_scope: JSON.stringify({}),
      call_plan: JSON.stringify(options.callPlan ?? [{ page: 0 }]),
      reused_datasets: JSON.stringify([]),
      pricing_version: options.pricingVersion ?? si.price_version,
      estimated_cost_usd: '0.14412',
      planned_calls: 1,
      completed_calls: 0,
      planned_rows: 1,
      received_rows: 0,
      uncertain_calls: 0,
      error_code: '',
      error_detail: '',
      expires_at: options.expiresAt ?? new Date(Date.now() + 600_000),
      confirmed_at: options.confirmedAt ?? null,
      created_at: options.createdAt ?? now(),
      updated_at: now(),
    })
    .execute();
  return id;
}

async function dataset(
  tenant: Tenant,
  runId: string,
  options: { kind?: string; status?: string; scope?: string; coverage?: string } = {},
) {
  const id = randomUUID();
  await db
    .insertInto('search_intelligence_datasets')
    .values({
      id,
      workspace_id: tenant.workspaceId,
      project_id: tenant.projectId,
      run_id: runId,
      dataset_kind: options.kind ?? 'ranking_keywords',
      scope_hash: id,
      target_domain: 'acme.example',
      target_hostname: 'acme.example',
      target_origin: 'https://acme.example',
      comparison_origin: '',
      language_code: 'en',
      status: options.status ?? 'published',
      coverage: options.coverage ?? 'complete',
      requested_rows: 10,
      raw_rows_received: 10,
      unique_rows_saved: 10,
      truncated: false,
      summary: JSON.stringify({}),
      provider_filters: JSON.stringify(options.scope ? { research_scope: options.scope } : {}),
      parser_version: '1',
      published_at: options.status === 'collecting' ? null : now(),
      created_at: now(),
    })
    .execute();
  return id;
}

async function rows(
  tenant: Tenant,
  datasetId: string,
  values: { keyword?: string; domain?: string; volume?: number | null; cpc?: number }[],
) {
  const ids: string[] = [];
  for (const [index, value] of values.entries()) {
    const id = randomUUID();
    await db
      .insertInto('search_intelligence_rows')
      .values({
        id,
        workspace_id: tenant.workspaceId,
        project_id: tenant.projectId,
        dataset_id: datasetId,
        provider_row_key: `row:${index}`,
        row_kind: 'ranking_keywords',
        keyword: value.keyword ?? `keyword ${index}`,
        domain: value.domain ?? '',
        url: '',
        intent: '',
        search_volume: value.volume ?? null,
        auxiliary: JSON.stringify(value.cpc === undefined ? {} : { cpc: value.cpc }),
        created_at: now(),
      })
      .execute();
    ids.push(id);
  }
  return ids;
}

async function tenant() {
  const created = await fixtures.tenant();
  tenants.push(created);
  return created;
}

async function tasksOf(tenant: Tenant) {
  return db
    .selectFrom('analytics_tasks')
    .select(['id', 'task_kind', 'payload', 'idempotency_key', 'status', 'completed_at'])
    .where('workspace_id', '=', tenant.workspaceId)
    .execute();
}

beforeEach(async () => {
  t = await tenant();
});

afterAll(async () => {
  const workspaces = tenants.map((row) => row.workspaceId);
  await db.deleteFrom('search_intelligence_rows').where('workspace_id', 'in', workspaces).execute();
  // Derived datasets reference their parent.
  await db
    .deleteFrom('search_intelligence_datasets')
    .where('workspace_id', 'in', workspaces)
    .where('parent_dataset_id', 'is not', null)
    .execute();
  for (const table of [
    'search_intelligence_datasets',
    'search_intelligence_runs',
    'analytics_tasks',
    'provider_connections',
  ] as const) {
    await db.deleteFrom(table).where('workspace_id', 'in', workspaces).execute();
  }
  await fixtures.cleanup();
  await db.destroy();
});

describe('Search Intelligence authorization', () => {
  it('authorizes by the project in the path, never by X-Workspace-Id', async () => {
    const runId = await review(t, await connection(t));
    const datasetId = await dataset(t, runId);
    const routes: [string, string, unknown?][] = [
      ['GET', ''],
      ['PUT', '/preferences', {}],
      ['POST', `/runs/${runId}/confirm`],
      ['POST', `/runs/${runId}/cancel`],
      ['GET', '/runs'],
      ['GET', `/runs/${runId}`],
      ['GET', `/datasets/${datasetId}/rows`],
      ['POST', '/citation-matches', { backlink_dataset_id: datasetId, audit_ids: [randomUUID()] }],
    ];
    const outsider = await tenant();
    const viewer = await fixtures.user();
    await fixtures.member(t.workspaceId, viewer, 'viewer');
    for (const [method, path, body] of routes) {
      // A member of another workspace sees no project, whatever header it sends.
      const foreign = await call<ErrorBody>(path, {
        method,
        body,
        user: outsider.userId,
        headers: { 'x-workspace-id': t.workspaceId },
      });
      expect([method, path, foreign.status, foreign.body.error.code]).toEqual([
        method,
        path,
        404,
        'not_found',
      ]);
      const asLocalUser = await app.request(
        `/api/v1/projects/${t.projectId}/search-intelligence${path}`,
        { method },
      );
      expect(asLocalUser.status).toBe(404);
      // A viewer reads but cannot run or write.
      const asViewer = await call(path, { method, body, user: viewer });
      if (method === 'GET') expect(asViewer.status).toBe(200);
      else expect([path, asViewer.status]).toEqual([path, 403]);
    }
    // A header naming a foreign workspace does not hide the caller's own project.
    const own = await call<Readiness>('', { headers: { 'x-workspace-id': outsider.workspaceId } });
    expect(own.status).toBe(200);
    const missing = await call<ErrorBody>('', { project: randomUUID() });
    expect(missing.status).toBe(404);
  });
});

describe('Search Intelligence readiness and preferences', () => {
  it('lists eligible targets, the one usable connection and published datasets', async () => {
    const connectionId = await connection(t);
    await connection(t, { active: false });
    await connection(t, { tested: false });
    await db
      .insertInto('owned_domains')
      .values([
        // The primary website's own origin, and a child subdomain.
        { id: randomUUID(), project_id: t.projectId, domain: 'acme.example', created_at: now() },
        {
          id: randomUUID(),
          project_id: t.projectId,
          domain: 'blog.acme.example',
          created_at: now(),
        },
        { id: randomUUID(), project_id: t.projectId, domain: 'www.acme.co.uk', created_at: now() },
      ])
      .execute();
    await fixtures.competitor(t.projectId, { name: 'Rival', domains: ['www.rival.co.uk'] });
    await fixtures.competitor(t.projectId, { name: 'Split', domains: ['a.test', 'b.test'] });
    await db
      .updateTable('projects')
      .set({ serp_location_code: 2036, serp_language_code: 'en' })
      .where('id', '=', t.projectId)
      .execute();
    const older = await review(t, connectionId, { createdAt: new Date(Date.now() - 120_000) });
    const latest = await review(t, connectionId, {
      status: 'running',
      confirmedAt: now(),
      createdAt: new Date(Date.now() - 60_000),
    });
    // A newer unconfirmed cost review does not replace the acquisition being followed.
    await review(t, connectionId);
    const published = await dataset(t, older, { scope: 'domain_subdomains' });
    const unscoped = await dataset(t, older);
    await dataset(t, older, { status: 'collecting' });

    const { status, body } = await call<Readiness>('');
    expect(status).toBe(200);
    expect([body.connected, body.connection_id]).toEqual([true, connectionId]);
    expect(body.owned_targets.map((target) => [target.hostname, target.origin])).toEqual([
      ['acme.example', 'https://acme.example'],
      ['www.acme.co.uk', 'https://www.acme.co.uk'],
    ]);
    expect(body.competitors).toEqual([
      expect.objectContaining({
        registrable_domain: 'rival.co.uk',
        hostname: 'www.rival.co.uk',
        source_kind: 'competitor',
      }),
    ]);
    expect(body.preferences).toMatchObject({
      location_code: 2036,
      language_code: 'en',
      research_scope: si.default_research_scope,
      depths: si.default_depths,
    });
    expect(body.latest_run?.id).toBe(latest);
    expect(new Map(body.datasets.map((row) => [row.id, row.research_scope]))).toEqual(
      new Map([
        [published, 'domain_subdomains'],
        [unscoped, 'exact_host'],
      ]),
    );

    // Two eligible connections are ambiguous: not connected.
    await connection(t);
    expect((await call<Readiness>('')).body).toMatchObject({
      connected: false,
      connection_id: null,
    });
  });

  it('saves validated preferences, which readiness returns', async () => {
    const saved = await call<Readiness['preferences']>('/preferences', {
      method: 'PUT',
      body: { research_scope: 'exact_host', location_code: 2840, depths: { backlinks: 500 } },
    });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ research_scope: 'exact_host', competitor_ids: [] });
    const read = await call<Readiness>('');
    expect(read.body.preferences).toMatchObject({
      location_code: 2840,
      depths: { backlinks: 500 },
    });

    for (const body of [
      { depths: { footprint: 5 } },
      { depths: { backlinks: 0 } },
      { location_code: 0 },
    ]) {
      const invalid = await call<ErrorBody>('/preferences', { method: 'PUT', body });
      expect([invalid.status, invalid.body.error.code]).toEqual([422, 'validation_error']);
    }
  });
});

describe('Search Intelligence run confirmation and cancellation', () => {
  it('queues a reviewed run once with its acquisition task', async () => {
    const connectionId = await connection(t);
    const runId = await review(t, connectionId);
    const confirmed = await call<Run>(`/runs/${runId}/confirm`, { method: 'POST' });
    expect(confirmed.status).toBe(202);
    expect(confirmed.body.status).toBe('queued');
    expect(confirmed.body.confirmed_at).not.toBeNull();
    const repeated = await call<Run>(`/runs/${runId}/confirm`, { method: 'POST' });
    expect(repeated.body).toEqual(confirmed.body);
    const tasks = await tasksOf(t);
    expect(tasks).toEqual([
      expect.objectContaining({
        task_kind: si.task_kind,
        payload: { run_id: runId },
        idempotency_key: `analytics:${si.task_kind}:${runId}`,
        status: 'queued',
      }),
    ]);
    const run = await db
      .selectFrom('search_intelligence_runs')
      .select('analytics_task_id')
      .where('id', '=', runId)
      .executeTakeFirstOrThrow();
    expect(run.analytics_task_id).toBe(tasks[0]!.id);

    // A second acquisition waits for this one to finish.
    const blocked = await call<ErrorBody>(`/runs/${await review(t, connectionId)}/confirm`, {
      method: 'POST',
    });
    expect([blocked.status, blocked.body.error.code]).toEqual([409, 'acquisition_in_progress']);
  });

  it('confirms one of two concurrent reviews', async () => {
    const connectionId = await connection(t);
    const first = await review(t, connectionId);
    const second = await review(t, connectionId);
    const outcomes = await Promise.all(
      [first, second].map((id) => call<Run>(`/runs/${id}/confirm`, { method: 'POST' })),
    );
    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual([202, 409]);
    expect(await tasksOf(t)).toHaveLength(1);
  });

  it('refuses a review that expired, was repriced, lost its credential or was cancelled', async () => {
    const connectionId = await connection(t);
    const inactive = await connection(t, { active: false });
    const cases: [Parameters<typeof review>[2], string, string?][] = [
      [{ expiresAt: new Date(Date.now() - 1000) }, 'review_expired'],
      [{ pricingVersion: 'retired-pricing' }, 'pricing_changed'],
      [{ revision: randomUUID() }, 'connection_changed'],
      [{}, 'connection_changed', inactive],
      [{ status: 'cancelled' }, 'review_not_confirmable'],
    ];
    for (const [options, code, via] of cases) {
      const runId = await review(t, via ?? connectionId, options);
      const refused = await call<ErrorBody>(`/runs/${runId}/confirm`, { method: 'POST' });
      expect([refused.status, refused.body.error.code]).toEqual([409, code]);
    }
    // A connection of another workspace is not this review's connection.
    const outsider = await tenant();
    const foreignConnection = await review(t, await connection(outsider));
    const foreign = await call<ErrorBody>(`/runs/${foreignConnection}/confirm`, { method: 'POST' });
    expect(foreign.body.error.code).toBe('connection_changed');

    // Every dataset reused: nothing to acquire, so nothing is enqueued.
    const reused = await review(t, connectionId, { callPlan: [] });
    const done = await call<Run>(`/runs/${reused}/confirm`, { method: 'POST' });
    expect([done.status, done.body.status]).toEqual([202, 'succeeded']);
    expect(done.body.completed_at).not.toBeNull();
    expect(await tasksOf(t)).toEqual([]);
  });

  it('cancels an unfinished run with its task and leaves a finished run alone', async () => {
    const connectionId = await connection(t);
    const runId = await review(t, connectionId);
    await call(`/runs/${runId}/confirm`, { method: 'POST' });
    const cancelled = await call<Run>(`/runs/${runId}/cancel`, { method: 'POST' });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe('cancelled');
    expect(cancelled.body.cancelled_at).not.toBeNull();
    const [task] = await tasksOf(t);
    expect(task?.status).toBe('cancelled');
    expect(task?.completed_at).not.toBeNull();

    // An uncertain run may have spent money; cancelling keeps that state.
    for (const status of ['succeeded', 'uncertain']) {
      const finished = await review(t, connectionId, { status });
      const unchanged = await call<Run>(`/runs/${finished}/cancel`, { method: 'POST' });
      expect([unchanged.body.status, unchanged.body.cancelled_at]).toEqual([status, null]);
    }
    const missing = await call<ErrorBody>(`/runs/${randomUUID()}/cancel`, { method: 'POST' });
    expect(missing.status).toBe(404);
  });

  it('lists confirmed runs newest first, pages them and hides other projects’ runs', async () => {
    const connectionId = await connection(t);
    const first = await review(t, connectionId, {
      createdAt: new Date(Date.now() - 60_000),
      confirmedAt: now(),
    });
    const second = await review(t, connectionId, { confirmedAt: now() });
    await review(t, connectionId); // an unconfirmed draft
    const page = await call<Run[]>('/runs?limit=1&offset=1');
    expect(page.body.map((row) => row.id)).toEqual([first]);
    const detail = await call<Run>(`/runs/${second}`);
    expect(Number(detail.body.estimated_cost_usd)).toBe(0.14412);

    const outsider = await tenant();
    const own = await call<ErrorBody>(`/runs/${second}`, {
      project: outsider.projectId,
      user: outsider.userId,
    });
    expect([own.status, own.body.error.code]).toEqual([404, 'not_found']);
  });
});

describe('Search Intelligence dataset rows and handoff', () => {
  let datasetId: string;
  let ids: string[];

  beforeEach(async () => {
    const runId = await review(t, await connection(t));
    datasetId = await dataset(t, runId);
    ids = await rows(t, datasetId, [
      { keyword: 'alpha shoes', volume: 5, cpc: 1.5 },
      { keyword: 'beta 100%', volume: null },
      { keyword: 'gamma shoes', volume: 5, cpc: 0.25 },
      { keyword: 'delta', volume: 1 },
    ]);
  });

  async function all(query: string) {
    const seen: Page['rows'] = [];
    let cursor: string | null = null;
    do {
      const suffix: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
      const page = await call<Page>(`/datasets/${datasetId}/rows?limit=1&${query}${suffix}`);
      expect(page.status).toBe(200);
      seen.push(...page.body.rows);
      cursor = page.body.next_cursor;
    } while (cursor !== null);
    return seen;
  }

  it('pages every row once in sort order with nulls last', async () => {
    const volumes = async (direction: string) =>
      (await all(`sort=search_volume&direction=${direction}`)).map((row) => row.search_volume);
    expect(await volumes('asc')).toEqual([1, 5, 5, null]);
    expect(await volumes('desc')).toEqual([5, 5, 1, null]);
    const byCpc = await all('sort=cpc&direction=desc');
    expect(byCpc.map((row) => row.cpc)).toEqual([1.5, 0.25, undefined, undefined]);
    expect(new Set(byCpc.map((row) => row.id))).toEqual(new Set(ids));
  });

  it('filters literally and binds the cursor to the dataset and its filters', async () => {
    const shoes = await call<Page>(`/datasets/${datasetId}/rows?search=SHOES&limit=1`);
    expect(shoes.body.dataset.filtered_saved_count).toBe(2);
    const percent = await call<Page>(
      `/datasets/${datasetId}/rows?search=${encodeURIComponent('100%')}`,
    );
    expect(percent.body.rows.map((row) => row.keyword)).toEqual(['beta 100%']);
    const wildcard = await call<Page>(`/datasets/${datasetId}/rows?search=_`);
    expect(wildcard.body.rows).toEqual([]);
    const volume = await call<Page>(`/datasets/${datasetId}/rows?min_volume=5`);
    expect(volume.body.dataset.filtered_saved_count).toBe(2);

    const cursor = encodeURIComponent(shoes.body.next_cursor!);
    const other = await dataset(t, shoes.body.dataset.run_id);
    for (const path of [
      `/datasets/${datasetId}/rows?search=delta&limit=1&cursor=${cursor}`,
      `/datasets/${other}/rows?search=shoes&limit=1&cursor=${cursor}`,
      `/datasets/${datasetId}/rows?cursor=a`,
      `/datasets/${datasetId}/rows?cursor=${Buffer.from([0xff]).toString('base64url')}`,
    ]) {
      const refused = await call<ErrorBody>(path);
      expect([refused.status, refused.body.error.code]).toEqual([422, 'invalid_cursor']);
    }
    const unsupported = await call<ErrorBody>(`/datasets/${datasetId}/rows?sort=unsupported`);
    expect([unsupported.status, unsupported.body.error.code]).toEqual([422, 'invalid_sort']);
    const collecting = await dataset(t, shoes.body.dataset.run_id, { status: 'collecting' });
    expect((await call(`/datasets/${collecting}/rows`)).status).toBe(404);
  });

  it('hands off exactly the selected rows of a published dataset', async () => {
    const scope = { workspace: new WorkspaceScope(t.workspaceId), projectId: t.projectId };
    const handoff = await contentHandoff(db, scope, datasetId, [ids[1]!, ids[0]!.toUpperCase()]);
    expect(handoff.row_ids).toEqual([ids[1], ids[0]]);
    expect(handoff.evidence.map((row) => [row.id, row.dataset.id])).toEqual([
      [ids[1], datasetId],
      [ids[0], datasetId],
    ]);
    await expect(
      contentHandoff(db, scope, datasetId, [ids[0]!, randomUUID()]),
    ).rejects.toMatchObject({ status: 422 });
  });
});

describe('Search Intelligence citation matches', () => {
  it.each(['partial', 'unknown'])(
    'keeps %s referring-domain coverage on its matches',
    async (coverage) => {
      const runId = await review(t, await connection(t));
      const parent = await dataset(t, runId, { kind: 'referring_domains', coverage });
      const auditId = await fixtures.audit(t);
      await fixtures.execution(t, {
        auditId,
        analysis: { citations: [{ url: 'https://unrelated.example/' }] },
      });
      const derived = await call<Dataset>('/citation-matches', {
        method: 'POST',
        body: { backlink_dataset_id: parent, audit_ids: [auditId] },
      });
      // No match against an incomplete or unknown list is not evidence of no match.
      expect([derived.body.unique_rows_saved, derived.body.coverage]).toEqual([0, coverage]);
    },
  );

  it('derives one dataset per exact selection, even under concurrent requests', async () => {
    const runId = await review(t, await connection(t));
    const parent = await dataset(t, runId, {
      kind: 'referring_domains',
      scope: 'domain_subdomains',
    });
    await rows(t, parent, [{ domain: 'WWW.Linker.example' }, { domain: 'other.example' }]);
    const auditId = await fixtures.audit(t);
    await fixtures.execution(t, {
      auditId,
      analysis: {
        citations: [
          { url: 'https://linker.example/post' },
          { url: 'https://unrelated.example/', domain: 'unrelated.example' },
        ],
      },
    });
    const request = { backlink_dataset_id: parent, audit_ids: [auditId] };
    const [first, second] = await Promise.all(
      [0, 1].map(() => call<Dataset>('/citation-matches', { method: 'POST', body: request })),
    );
    expect([first!.status, second!.status]).toEqual([201, 201]);
    expect(second!.body.id).toBe(first!.body.id);
    expect(first!.body).toMatchObject({
      dataset_kind: 'citation_matches',
      research_scope: 'domain_subdomains',
      unique_rows_saved: 1,
      summary: { selected_audits: 1, citations_reviewed: 2, matches: 1 },
    });
    const matched = await call<Page>(`/datasets/${first!.body.id}/rows`);
    expect(matched.body.rows.map((row) => [row.domain, row.url])).toEqual([
      ['linker.example', 'https://linker.example/post'],
    ]);
    // Each match keeps its citation's processing version as provenance.
    const source = await db
      .selectFrom('citations')
      .select(['id', 'analyzer_version'])
      .where('audit_id', '=', auditId)
      .where('url', '=', 'https://linker.example/post')
      .executeTakeFirstOrThrow();
    expect(matched.body.rows[0]).toMatchObject({
      citation_id: source.id,
      analyzer_version: source.analyzer_version,
    });

    // Derivations stored before this owner are found by the same identity.
    const derived = await db
      .selectFrom('search_intelligence_datasets')
      .select(['scope_hash', 'provider_filters'])
      .where('id', '=', first!.body.id)
      .executeTakeFirstOrThrow();
    const citationIds = (derived.provider_filters as { citation_ids: string[] }).citation_ids;
    const identity = `{"audit_ids":["${auditId}"],"citation_ids":${JSON.stringify(citationIds)},"parent_dataset_id":"${parent}"}`;
    expect(derived.scope_hash).toBe(createHash('sha256').update(identity).digest('hex'));

    const outsider = await tenant();
    const foreignAudit = await call<ErrorBody>('/citation-matches', {
      method: 'POST',
      body: { backlink_dataset_id: parent, audit_ids: [await fixtures.audit(outsider)] },
    });
    expect([foreignAudit.status, foreignAudit.body.error.code]).toEqual([422, 'audit_not_found']);
    const wrongKind = await call<ErrorBody>('/citation-matches', {
      method: 'POST',
      body: { backlink_dataset_id: await dataset(t, runId), audit_ids: [auditId] },
    });
    expect([wrongKind.status, wrongKind.body.error.code]).toEqual([404, 'not_found']);
  });
});
