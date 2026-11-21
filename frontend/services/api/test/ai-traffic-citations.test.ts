import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.ts';
import { aiTrafficOverview } from '../src/ai-traffic/overview.ts';
import { persistSourceAggregates } from '../src/visibility/source-aggregates.ts';
import { finalizedRuns } from './finalized-runs.ts';
import { TEST_SESSION_COOKIE, sessionToken, testConfig, testDatabase } from './support.ts';
import { VisibilityFixtures, type Tenant } from './visibility-fixtures.ts';

const config = testConfig(),
  db = testDatabase(config),
  app = createApp(config, db),
  fixtures = new VisibilityFixtures(db),
  { tenant, finalizedRun, cleanup } = finalizedRuns(db, fixtures);
type AuditTenant = Awaited<ReturnType<typeof tenant>>;
afterEach(cleanup);
afterAll(async () => {
  await db.destroy();
});

async function overview(t: Tenant, projectId: string, query = 'range=30d') {
  const response = await app.request(`/api/v1/projects/${projectId}/ai-traffic/overview?${query}`, {
    headers: {
      cookie: `${TEST_SESSION_COOKIE}=${await sessionToken({ sub: t.userId, ver: 0 })}`,
    },
  });
  return {
    status: response.status,
    citations: response.ok
      ? ((await response.json()) as { citations: Record<string, unknown> }).citations
      : null,
  };
}

type Leg = { state: string; value: number | null; reason: string | null };
type PageRow = { url_hash: string; canonical_url: string; citations: Leg };
type UrlDetail = { page: PageRow | null; citations: { citation_id: string; audit_id: string }[] };

async function trafficRead<T>(t: Tenant, projectId: string, path: string) {
  const response = await app.request(`/api/v1/projects/${projectId}/ai-traffic/${path}`, {
    headers: {
      cookie: `${TEST_SESSION_COOKIE}=${await sessionToken({ sub: t.userId, ver: 0 })}`,
    },
  });
  return { status: response.status, body: response.ok ? ((await response.json()) as T) : null };
}

async function ownedRows(t: AuditTenant, auditId: string, url: string) {
  return db
    .selectFrom('citations')
    .select(['id', 'url_hash'])
    .where('workspace_id', '=', t.workspaceId)
    .where('audit_id', '=', auditId)
    .where('url', '=', url)
    .where('is_owned', '=', true)
    .orderBy('id')
    .execute();
}

describe('AI Traffic Pages citations', () => {
  it('serves each page’s owned citations from the run’s persisted per-page fact', async () => {
    const t = await tenant();
    const auditId = await finalizedRun(t, [
      'https://acme.example/guide',
      'https://acme.example/pricing',
      'https://competitor.test/review',
    ]);
    const guide = await ownedRows(t, auditId, 'https://acme.example/guide');
    const pricing = await ownedRows(t, auditId, 'https://acme.example/pricing');
    const guideHash = guide[0]!.url_hash!;
    const { owned_citation_pages: pages } = await db
      .selectFrom('metric_snapshots')
      .select('owned_citation_pages')
      .where('workspace_id', '=', t.workspaceId)
      .where('audit_id', '=', auditId)
      .executeTakeFirstOrThrow();
    expect(
      (pages as { url_hash: string; citation_ids: string[] }[]).map((p) => [
        p.url_hash,
        [...p.citation_ids].sort(),
      ]),
    ).toEqual(
      [
        [guideHash, guide.map((r) => r.id)],
        [pricing[0]!.url_hash!, pricing.map((r) => r.id)],
      ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    );

    const template = await db
      .selectFrom('citations')
      .selectAll()
      .where('id', '=', guide[0]!.id)
      .executeTakeFirstOrThrow();
    await db
      .insertInto('citations')
      .values({ ...template, id: randomUUID(), ordinal: template.ordinal + 100 })
      .execute();

    const list = await trafficRead<{ items: PageRow[] }>(t, t.projectId, 'pages?range=30d');
    expect(list.status).toBe(200);
    const row = list.body!.items.find((r) => r.url_hash === guideHash);
    expect(row?.citations).toEqual({
      state: 'value',
      value: guide.length,
      coverage: null,
      reason: null,
    });
    const detail = await trafficRead<UrlDetail>(t, t.projectId, `pages/${guideHash}?range=30d`);
    expect(detail.body!.page?.citations.value).toBe(guide.length);
    expect(detail.body!.citations.map((c) => [c.citation_id, c.audit_id])).toEqual(
      guide.map((r) => [r.id, auditId]),
    );
  });

  it('reads each scope’s newest run in the window, so an older run’s citations drop out', async () => {
    const t = await tenant();
    const older = await finalizedRun(t, ['https://acme.example/guide']);
    const guide = await ownedRows(t, older, 'https://acme.example/guide');
    const path = `pages/${guide[0]!.url_hash}?range=30d`;
    const probe = await finalizedRun(t, ['https://acme.example/guide']);
    await db.updateTable('audits').set({ audit_scope: 'probe' }).where('id', '=', probe).execute();
    expect(
      (await trafficRead<UrlDetail>(t, t.projectId, path)).body!.citations.map((c) => [
        c.citation_id,
        c.audit_id,
      ]),
    ).toEqual(guide.map((r) => [r.id, older]));
    await finalizedRun(t, ['https://competitor.test/review']);
    const detail = await trafficRead<UrlDetail>(t, t.projectId, path);
    expect(detail.body).toMatchObject({ page: null, citations: [] });
    expect(
      (await trafficRead<{ items: PageRow[] }>(t, t.projectId, 'pages?range=30d')).body!.items,
    ).toEqual([]);
  });

  it('never serves another workspace’s per-page fact', async () => {
    const t = await tenant(),
      other = await tenant();
    const auditId = await finalizedRun(other, ['https://acme.example/guide']);
    const guide = await ownedRows(other, auditId, 'https://acme.example/guide');
    expect((await trafficRead(t, other.projectId, 'pages?range=30d')).status).toBe(404);
    expect(
      (await trafficRead(t, other.projectId, `pages/${guide[0]!.url_hash}?range=30d`)).status,
    ).toBe(404);
    const own = await trafficRead<UrlDetail>(
      other,
      other.projectId,
      `pages/${guide[0]!.url_hash}?range=30d`,
    );
    expect(own.body!.citations.map((c) => c.citation_id)).toEqual(guide.map((r) => r.id));
  });
});

describe('AI Traffic tracked citations', () => {
  it('persists the run’s owned citations with their IDs at finalization and serves that fact', async () => {
    const t = await tenant();
    const auditId = await finalizedRun(t, [
      'https://acme.example/guide',
      'https://competitor.test/review',
    ]);
    const { status } = await db
      .selectFrom('audits')
      .select('status')
      .where('id', '=', auditId)
      .executeTakeFirstOrThrow();
    expect(status).toBe('completed');
    const fact = await db
      .selectFrom('metric_snapshots')
      .select(['owned_citation_count', 'owned_citation_ids', 'analyzer_version'])
      .where('workspace_id', '=', t.workspaceId)
      .where('audit_id', '=', auditId)
      .executeTakeFirstOrThrow();
    const owned = await db
      .selectFrom('citations')
      .select('id')
      .where('workspace_id', '=', t.workspaceId)
      .where('audit_id', '=', auditId)
      .where('url', '=', 'https://acme.example/guide')
      .execute();
    expect(fact.owned_citation_count).toBe(3);
    expect([...(fact.owned_citation_ids as string[])].sort()).toEqual(
      owned.map((row) => row.id).sort(),
    );

    const template = await db
      .selectFrom('citations')
      .selectAll()
      .where('id', '=', owned[0]!.id)
      .executeTakeFirstOrThrow();
    await db
      .insertInto('citations')
      .values({ ...template, id: randomUUID(), ordinal: template.ordinal + 100 })
      .execute();
    expect(await overview(t, t.projectId)).toEqual({
      status: 200,
      citations: {
        unit: 'tracked_citations',
        state: 'measured',
        count: 3,
        label: "Observed in CiteLadder's tracked answers",
        sources: [{ audit_id: auditId, analyzer_version: fact.analyzer_version }],
      },
    });
  });

  it('keeps a measured zero apart from a window without a run and a run not yet computed', async () => {
    const t = await tenant();
    expect((await overview(t, t.projectId)).citations).toMatchObject({
      state: 'not_available',
      reason: 'no_completed_run',
      count: null,
    });
    const auditId = await finalizedRun(t, ['https://competitor.test/review']);
    expect((await overview(t, t.projectId)).citations).toMatchObject({
      state: 'measured',
      count: 0,
      sources: [{ audit_id: auditId }],
    });
    expect(
      (await overview(t, t.projectId, 'start_date=2026-01-01&end_date=2026-01-07')).citations,
    ).toMatchObject({ state: 'not_available', reason: 'no_completed_run', count: null });
    await db.deleteFrom('metric_snapshots').where('audit_id', '=', auditId).execute();
    expect((await overview(t, t.projectId)).citations).toEqual({
      unit: 'tracked_citations',
      state: 'not_available',
      reason: 'not_computed',
      count: null,
      label: "Observed in CiteLadder's tracked answers",
    });
  });

  it('never serves another workspace’s run', async () => {
    const t = await tenant(),
      other = await tenant();
    await finalizedRun(other, ['https://acme.example/guide']);
    expect((await overview(t, other.projectId)).status).toBe(404);
    expect(
      (
        await aiTrafficOverview(
          db,
          { workspaceId: t.workspaceId, projectId: other.projectId },
          { range: '30d' },
        )
      ).citations,
    ).toMatchObject({ state: 'not_available', reason: 'no_completed_run' });
    expect((await overview(other, other.projectId)).citations).toMatchObject({
      state: 'measured',
      count: 3,
    });
  });
});

type SourcesBody = {
  responses: number;
  prompts: number;
  total_citations: number;
  items: { key: string; responses: number; prompts: number; urls: number; annotations: number }[];
};

async function sourcesRead(t: Tenant, projectId: string, query: string) {
  const response = await app.request(`/api/v1/projects/${projectId}/visibility/sources?${query}`, {
    headers: {
      cookie: `${TEST_SESSION_COOKIE}=${await sessionToken({ sub: t.userId, ver: 0 })}`,
    },
  });
  const json: unknown = await response.json();
  return {
    status: response.status,
    body: response.ok ? (json as SourcesBody) : null,
    code: response.ok ? null : (json as { error: { code: string } }).error.code,
  };
}

const counted = (body: SourcesBody | null) =>
  body?.items.map((row) => [row.key, row.responses, row.prompts, row.urls, row.annotations]);

describe('Visibility Sources facts', () => {
  it('persists each run’s exact answers and citations, and reads only those', async () => {
    const t = await tenant();
    const auditId = await finalizedRun(t, [
      'https://review.example/a',
      'https://review.example/b',
      'https://blog.test/x',
    ]);
    const analyses = await db
      .selectFrom('response_analyses')
      .select('id')
      .where('workspace_id', '=', t.workspaceId)
      .where('audit_id', '=', auditId)
      .orderBy('id')
      .execute();
    const citations = await db
      .selectFrom('citations')
      .select(['id', 'url'])
      .where('workspace_id', '=', t.workspaceId)
      .where('audit_id', '=', auditId)
      .orderBy('id')
      .execute();
    expect([analyses.length, citations.length]).toEqual([3, 9]);
    const rows = await db
      .selectFrom('audit_source_aggregates')
      .select(['dimension', 'key', 'citation_ids', 'analysis_ids'])
      .where('workspace_id', '=', t.workspaceId)
      .where('audit_id', '=', auditId)
      .execute();
    for (const dimension of ['domain', 'url']) {
      expect(
        rows
          .filter((row) => row.dimension === dimension)
          .flatMap((row) => row.citation_ids)
          .sort(),
      ).toEqual(citations.map((c) => c.id));
    }
    const answered = await db
      .selectFrom('audit_answer_aggregates')
      .select(['logical_engine', 'cohort', 'analysis_ids', 'prompt_keys'])
      .where('workspace_id', '=', t.workspaceId)
      .where('audit_id', '=', auditId)
      .execute();
    expect(answered).toEqual([
      {
        logical_engine: 'chatgpt',
        cohort: 'core',
        analysis_ids: analyses.map((a) => a.id),
        prompt_keys: [t.promptId],
      },
    ]);

    const template = await db
      .selectFrom('citations')
      .selectAll()
      .where('id', '=', citations[0]!.id)
      .executeTakeFirstOrThrow();
    await db
      .insertInto('citations')
      .values({
        ...template,
        id: randomUUID(),
        url: 'https://late.example/z',
        domain: 'late.example',
        ordinal: template.ordinal + 100,
      })
      .execute();
    const read = await sourcesRead(t, t.projectId, `audit_id=${auditId}`);
    expect(read.status).toBe(200);
    expect([read.body?.responses, read.body?.prompts, read.body?.total_citations]).toEqual([
      3, 1, 9,
    ]);
    expect(counted(read.body)).toEqual([
      ['blog.test', 3, 1, 1, 3],
      ['review.example', 3, 1, 2, 6],
    ]);
  });

  it('counts a prompt and a URL cited in two selected runs once', async () => {
    const t = await tenant();
    const first = await finalizedRun(t, ['https://review.example/a']);
    const second = await finalizedRun(t, ['https://review.example/a', 'https://blog.test/x']);
    const { body } = await sourcesRead(t, t.projectId, `audit_ids=${first}&audit_ids=${second}`);
    expect([body?.responses, body?.prompts, body?.total_citations]).toEqual([6, 1, 9]);
    expect(counted(body)).toEqual([
      ['review.example', 6, 1, 1, 6],
      ['blog.test', 3, 1, 1, 3],
    ]);
    const pages = await sourcesRead(
      t,
      t.projectId,
      `audit_ids=${first}&audit_ids=${second}&dimension=url`,
    );
    expect(counted(pages.body)).toEqual([
      ['https://review.example/a', 6, 1, 1, 6],
      ['https://blog.test/x', 3, 1, 1, 3],
    ]);
  });

  it('reads a run without its persisted facts as pending, never as zero', async () => {
    const t = await tenant();
    const auditId = await finalizedRun(t, ['https://review.example/a']);
    expect(counted((await sourcesRead(t, t.projectId, `audit_id=${auditId}`)).body)).toEqual([
      ['review.example', 3, 1, 1, 3],
    ]);
    await db.deleteFrom('audit_answer_aggregates').where('audit_id', '=', auditId).execute();
    const read = await sourcesRead(t, t.projectId, `audit_id=${auditId}`);
    expect([read.status, read.code]).toEqual([404, 'visibility_metrics_pending']);
  });

  it('never writes or serves another workspace’s run', async () => {
    const t = await tenant(),
      other = await tenant();
    const auditId = await finalizedRun(other, ['https://review.example/a']);
    await persistSourceAggregates(db, { workspaceId: t.workspaceId, auditId, at: new Date() });
    const foreign = await db
      .selectFrom('audit_source_aggregates')
      .select('id')
      .where('workspace_id', '=', t.workspaceId)
      .execute();
    expect(foreign).toEqual([]);
    expect((await sourcesRead(t, other.projectId, `audit_id=${auditId}`)).status).toBe(404);
    expect((await sourcesRead(t, t.projectId, `audit_id=${auditId}`)).status).toBe(404);
    expect(
      counted((await sourcesRead(other, other.projectId, `audit_id=${auditId}`)).body),
    ).toEqual([['review.example', 3, 1, 1, 3]]);
  });
});
