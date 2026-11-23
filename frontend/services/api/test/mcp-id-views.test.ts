import { randomUUID } from 'node:crypto';
import { afterAll, expect, it } from 'vitest';
import { z } from 'zod';
import type { Json } from '../src/agent/contracts.ts';
import { changeKinds } from '../src/changes/kinds.ts';
import { dispatchTool } from '../src/mcp/tools.ts';
import type { Evidence } from '../src/mcp/types.ts';
import { auditTenant } from './audit-fixtures.ts';
import { kindCases, type KindScope, type TabledKind } from './change-kind-cases.ts';
import { commerceFixture, importCatalog } from './commerce-support.ts';
import { promptSet } from './prompt-fixtures.ts';
import { searchIntelligenceRun } from './search-intelligence-fixtures.ts';
import { SiteFixtures } from './site-health-fixtures.ts';
import { testConfig, testDatabase } from './support.ts';

const config = testConfig();
const db = testDatabase(config);
const fixtures = new SiteFixtures(db);
const table = kindCases(db, fixtures);
const origin = 'https://app.example.test';

afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});

const member = (scope: KindScope) => ({
  kind: 'member' as const,
  userId: scope.userId,
  workspaceId: scope.workspaceId,
  projectId: scope.projectId,
});
const read = (scope: KindScope, tool: string, args: Record<string, unknown>, project?: string) =>
  dispatchTool(
    db,
    member(scope),
    tool,
    { project_id: project ?? scope.projectId, ...args },
    origin,
  );
const rowsOf = (evidence: Evidence, key: string) =>
  z.array(z.record(z.string(), z.unknown())).parse(evidence[key]);
const idsOf = (evidence: Evidence, key: string, field: string) =>
  rowsOf(evidence, key).map((row) => z.string().parse(row[field]));

function stage(kind: TabledKind, scope: KindScope, payload: Record<string, Json>) {
  return changeKinds[kind].stage(
    { db, config, workspaceId: scope.workspaceId, projectId: scope.projectId },
    {
      kind: 'member',
      workspaceId: scope.workspaceId,
      userId: scope.userId,
      role: 'owner',
      scopes: 'all',
    },
    { id: randomUUID(), projectId: scope.projectId },
    payload,
  );
}

type IdView = {
  tool: string;
  args: Record<string, unknown>;
  ids: (evidence: Evidence) => string[];
  arranged: (payload: Record<string, Json>) => Json;
  payload: (evidence: Evidence, id: string, arranged: Record<string, Json>) => Record<string, Json>;
  prepare?: (scope: KindScope) => Promise<void>;
};

const issues: IdView = {
  tool: 'read_site_health',
  args: { view: 'issues' },
  ids: (evidence) => idsOf(evidence, 'items', 'group_id'),
  arranged: (payload) => payload.group_id!,
  payload: (evidence, id) => ({ crawl_id: z.string().parse(evidence.crawl_id), group_id: id }),
};
const runs: IdView = {
  tool: 'read_visibility_overview',
  args: { view: 'runs' },
  ids: (evidence) => idsOf(evidence, 'items', 'audit_id'),
  arranged: (payload) => payload.audit_id!,
  payload: (_evidence, id) => ({ audit_id: id }),
};
const schedules: IdView = {
  tool: 'read_visibility_overview',
  args: { view: 'schedules' },
  ids: (evidence) => idsOf(evidence, 'items', 'id'),
  arranged: (payload) => payload.schedule_id!,
  payload: (_evidence, id, arranged) => ({ ...arranged, schedule_id: id }),
};
const sets: IdView = {
  tool: 'read_prompt_portfolio',
  args: { view: 'sets' },
  ids: (evidence) => idsOf(evidence, 'items', 'id'),
  arranged: (payload) => payload.prompt_set_id!,
  payload: (_evidence, id, arranged) => ({ ...arranged, prompt_set_id: id }),
};
const ID_VIEWS: Partial<Record<TabledKind, IdView>> = {
  mark_issue_group_fixed: issues,
  rerun_issue_group: issues,
  cancel_audit: runs,
  rerun_audit_failures: runs,
  update_audit_schedule: schedules,
  delete_audit_schedule: schedules,
  rename_prompt_set: sets,
  delete_prompt_set: sets,
  review_prompt_candidates: {
    tool: 'read_prompt_portfolio',
    args: { view: 'candidates' },
    ids: (evidence) => idsOf(evidence, 'items', 'id'),
    arranged: (payload) => z.array(z.string()).parse(payload.accept_ids)[0]!,
    payload: (_evidence, id, arranged) => ({ ...arranged, accept_ids: [id] }),
  },
  cancel_link_analysis: {
    tool: 'read_site_links',
    args: { view: 'analyses' },
    ids: (evidence) => idsOf(evidence, 'history', 'id'),
    arranged: (payload) => payload.analysis_id!,
    payload: (_evidence, id) => ({ analysis_id: id }),
  },
};

it.each(Object.keys(ID_VIEWS) as TabledKind[])(
  '%s accepts in its dry run the id its read returns, and the read refuses another workspace’s project',
  async (kind) => {
    const view = ID_VIEWS[kind]!;
    const [own, other] = await Promise.all([table[kind].arrange(), table[kind].arrange()]);
    await view.prepare?.(own.scope);
    await view.prepare?.(other.scope);
    const evidence = await read(own.scope, view.tool, view.args);
    const ids = view.ids(evidence);
    expect(ids).toContain(view.arranged(own.payload));
    expect(ids).not.toContain(view.arranged(other.payload));
    await expect(read(own.scope, view.tool, view.args, other.scope.projectId)).rejects.toThrow(
      'Project was not found in this account',
    );
    const id = ids.find((found) => found === view.arranged(own.payload))!;
    const payload = view.payload(evidence, id, own.payload);
    expect((await stage(kind, own.scope, payload)).payload).toMatchObject(payload);
  },
);

it('reports a run’s failed answers and refuses another workspace’s run', async () => {
  const [own, other] = await Promise.all([
    table.rerun_audit_failures.arrange(),
    table.rerun_audit_failures.arrange(),
  ]);
  const run = await read(own.scope, 'read_visibility_overview', {
    view: 'run',
    audit_id: own.payload.audit_id,
  });
  expect([
    run.execution_status_counts,
    rowsOf(run, 'failures').map((failure) => failure.error_code),
  ]).toEqual([{ failed: 3 }, Array(3).fill('provider_timeout')]);
  await expect(
    read(own.scope, 'read_visibility_overview', { view: 'run', audit_id: other.payload.audit_id }),
  ).rejects.toThrow('Audit');
});

it('tells no crawl or link analysis apart from an empty list', async () => {
  const empty = await auditTenant(db, fixtures);
  const seed = await fixtures.crawl();
  await promptSet(db, empty.projectId);
  const views = async (scope: KindScope) =>
    Promise.all(
      (
        [
          ['read_site_health', { view: 'issues' }],
          ['read_site_links', { view: 'analyses' }],
          ['read_visibility_overview', { view: 'runs' }],
          ['read_visibility_overview', { view: 'schedules' }],
          ['read_prompt_portfolio', { view: 'candidates' }],
        ] as const
      ).map(async ([tool, args]) => {
        const evidence = await read(scope, tool, args);
        return evidence.state === 'available'
          ? `${tool}:${args.view}:${JSON.stringify(evidence.items ?? null)}`
          : `${tool}:${args.view}:${String(evidence.reason)}`;
      }),
    );
  expect(await views(empty)).toEqual([
    'read_site_health:issues:no_site_crawl',
    'read_site_links:analyses:no_link_analysis',
    'read_visibility_overview:runs:[]',
    'read_visibility_overview:schedules:[]',
    'read_prompt_portfolio:candidates:[]',
  ]);
  expect((await views(seed))[0]).toBe('read_site_health:issues:[]');
  const candidates = await table.review_prompt_candidates.arrange();
  const cohort = async (value: string) =>
    idsOf(
      await read(candidates.scope, 'read_prompt_portfolio', { view: 'candidates', cohort: value }),
      'items',
      'id',
    );
  expect([await cohort('core'), await cohort('comparison')]).toEqual([
    candidates.payload.accept_ids,
    [],
  ]);
  const listed = await read(empty, 'read_prompt_portfolio', { view: 'sets' });
  expect(rowsOf(listed, 'items').map((set) => set.prompt_count)).toEqual([0, 1]);
});

it('reads the crawl schedule of its own project only', async () => {
  const [own, other] = await Promise.all([fixtures.crawl(), fixtures.crawl()]);
  const before = await read(own, 'read_site_health', { view: 'schedule' });
  await stage('set_crawl_schedule', own, { enabled: true, cadence: 'monthly' });
  await changeKinds.set_crawl_schedule.confirm(
    db,
    config,
    {
      kind: 'member',
      workspaceId: own.workspaceId,
      userId: own.userId,
      role: 'owner',
      scopes: 'all',
    },
    { id: randomUUID(), projectId: own.projectId },
    { enabled: true, cadence: 'monthly' },
  );
  const after = await read(own, 'read_site_health', { view: 'schedule' });
  expect([before.schedule, after.schedule]).toMatchObject([
    { enabled: false, cadence: 'weekly' },
    { enabled: true, cadence: 'monthly' },
  ]);
  await expect(
    read(own, 'read_site_health', { view: 'schedule' }, other.projectId),
  ).rejects.toThrow('Project was not found in this account');
});

it('lists the catalog, competitor candidates and buyer prompts with ids, unavailable without a catalog', async () => {
  const [own, other, bare] = await Promise.all([
    fixtures.crawl(),
    fixtures.crawl(),
    fixtures.crawl(),
  ]);
  const catalogued = async (scope: KindScope) => {
    await importCatalog(db, scope, 'title,brand\nAcme Widget,Acme');
    const product = await db
      .selectFrom('commerce_products')
      .select('id')
      .where('project_id', '=', scope.projectId)
      .executeTakeFirstOrThrow();
    const made = await commerceFixture<{ promptId: string; candidateId: string }>(
      'prompt',
      scope.workspaceId,
      scope.projectId,
      product.id,
    );
    return { productId: product.id, ...made };
  };
  const [mine, theirs] = await Promise.all([catalogued(own), catalogued(other)]);
  const shelf = (scope: KindScope, view: string) => read(scope, 'read_ai_shelf', { view });
  const ids = async (view: string) => idsOf(await shelf(own, view), 'items', 'id');
  expect([
    await ids('catalog'),
    await ids('competitor_candidates'),
    await ids('buyer_prompts'),
    await ids('discoveries'),
  ]).toEqual([[mine.productId], [mine.candidateId], [mine.promptId], []]);
  expect(await ids('catalog')).not.toContain(theirs.productId);
  const unavailable = await Promise.all(
    ['catalog', 'competitor_candidates', 'buyer_prompts', 'discoveries'].map(async (view) =>
      String((await shelf(bare, view)).reason),
    ),
  );
  expect(unavailable).toEqual(Array(4).fill('no_product_catalog'));
  await expect(read(own, 'read_ai_shelf', { view: 'catalog' }, other.projectId)).rejects.toThrow(
    'Project was not found in this account',
  );
});

it('lists keyword research runs awaiting confirmation beside confirmed ones', async () => {
  const [own, other] = await Promise.all([fixtures.crawl(), fixtures.crawl()]);
  const confirmed = await searchIntelligenceRun(db, own);
  const pending = await searchIntelligenceRun(db, own);
  await db
    .updateTable('search_intelligence_runs')
    .set({ status: 'reviewed', confirmed_at: null, created_at: new Date(Date.now() + 1000) })
    .where('id', '=', pending)
    .execute();
  const theirs = await searchIntelligenceRun(db, other);
  const listed = await read(own, 'read_search_intelligence', { view: 'runs' });
  expect(
    rowsOf(listed, 'items').map((run) => [run.id, run.status, run.awaiting_confirmation]),
  ).toEqual([
    [pending, 'reviewed', true],
    [confirmed, 'succeeded', false],
  ]);
  expect(idsOf(listed, 'items', 'id')).not.toContain(theirs);
  const empty = await read(await fixtures.crawl(), 'read_search_intelligence', { view: 'runs' });
  expect(empty.items).toEqual([]);
  await expect(
    read(own, 'read_search_intelligence', { view: 'runs' }, other.projectId),
  ).rejects.toThrow('Project was not found in this account');
});
