import { randomUUID } from 'node:crypto';
import { afterAll, expect, it } from 'vitest';
import { dispatchTool } from '../src/mcp/tools.ts';
import { topic } from './prompt-fixtures.ts';
import { testDatabase } from './support.ts';
import { VisibilityFixtures, type Tenant } from './visibility-fixtures.ts';

const db = testDatabase();
const fixtures = new VisibilityFixtures(db);
afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});

it('reads answers from the latest completed run of this project when no audit_id is named', async () => {
  const tenant = await fixtures.tenant();
  const read = (args: Record<string, unknown> = {}) =>
    dispatchTool(
      db,
      { kind: 'member', ...tenant },
      'read_visibility_results',
      { project_id: tenant.projectId, ...args },
      '',
    );
  expect(await read()).toMatchObject({ state: 'unavailable', reason: 'no_completed_run' });
  const older = await fixtures.audit(tenant, { completedAt: new Date('2026-10-01T00:00:00Z') });
  await fixtures.execution(tenant, { auditId: older });
  const latest = await fixtures.audit(tenant, { completedAt: new Date('2026-10-02T00:00:00Z') });
  const { taskId } = await fixtures.execution(tenant, { auditId: latest });
  await fixtures.audit(tenant, { completedAt: null, status: 'running' });
  const foreign = await fixtures.tenant();
  await fixtures.execution(foreign, {
    auditId: await fixtures.audit(foreign, { completedAt: new Date('2026-10-03T00:00:00Z') }),
  });
  const page = await read();
  expect(page).toMatchObject({ state: 'available', audit_id: latest });
  expect((page.items as { task_id: string }[]).map((item) => item.task_id)).toEqual([taskId]);
  expect(await read({ audit_id: older })).toMatchObject({ audit_id: older });
});

const reader =
  (tenant: Tenant) =>
  (name: string, args: Record<string, unknown> = {}) =>
    dispatchTool(
      db,
      { kind: 'member', ...tenant },
      name,
      { project_id: tenant.projectId, ...args },
      '',
    );

it('filters by a topic of this project only, and tells an unasked topic apart from no run', async () => {
  const tenant = await fixtures.tenant();
  const read = reader(tenant);
  const own = await topic(db, tenant.projectId, 'Pricing');
  for (const name of ['read_visibility_overview', 'read_visibility_results'])
    expect(await read(name, { topic_id: own })).toEqual({
      state: 'unavailable',
      reason: 'no_completed_run',
      artifact_refs: [],
    });
  const auditId = await fixtures.audit(tenant);
  await fixtures.metricSnapshot(tenant, auditId, { metrics: { total_completed: 1 } });
  for (const name of [
    'read_visibility_overview',
    'read_visibility_results',
    'read_visibility_sources',
    'read_query_fanouts',
  ])
    expect(await read(name, { topic_id: own })).toEqual({
      state: 'unavailable',
      reason: 'topic_not_measured',
      artifact_refs: [],
    });
  await db
    .insertInto('audit_topic_metrics')
    .values({
      id: randomUUID(),
      workspace_id: tenant.workspaceId,
      project_id: tenant.projectId,
      audit_id: auditId,
      topic_id: own,
      topic_name: 'Pricing',
      visibility_score: 0,
      metrics: JSON.stringify({ total_completed: 0 }),
      source_analysis_ids: '[]',
      analyzer_version: 'test',
      created_at: new Date(),
    })
    .execute();
  expect(await read('read_visibility_results', { topic_id: own })).toMatchObject({
    state: 'available',
    audit_id: auditId,
    items: [],
  });
  const foreign = await fixtures.tenant();
  const theirs = await topic(db, foreign.projectId, 'Pricing');
  for (const name of [
    'read_visibility_overview',
    'read_visibility_results',
    'read_visibility_sources',
    'read_query_fanouts',
  ])
    await expect(read(name, { topic_id: theirs })).rejects.toThrow(
      'topic_id is not a topic of this project',
    );
  await expect(
    read('read_visibility_trends', {
      topic_id: theirs,
      from_at: '2026-01-01T00:00:00Z',
      to_at: '2026-02-01T00:00:00Z',
    }),
  ).rejects.toThrow('topic_id is not a topic of this project');
  expect(await read('read_fact_checks', { view: 'facts' })).toEqual({
    state: 'unavailable',
    reason: 'not_enabled',
    artifact_refs: [],
  });
});

it("pages one run's prompt scores strongest first, never another workspace's", async () => {
  const tenant = await fixtures.tenant();
  const read = reader(tenant);
  expect(await read('read_prompt_metrics')).toMatchObject({
    state: 'unavailable',
    reason: 'no_completed_run',
  });
  const scored = async (
    owner: Tenant,
    auditId: string,
    score: { promptIndex: number; promptText: string; composite: number },
  ) => {
    const { promptIndex, promptText } = score;
    await fixtures.execution(owner, { auditId, promptIndex, promptText, analysis: {} });
    await fixtures.promptScore(owner, auditId, score);
  };
  const auditId = await fixtures.audit(tenant);
  await scored(tenant, auditId, { promptIndex: 0, promptText: 'best crm', composite: 40 });
  await scored(tenant, auditId, { promptIndex: 1, promptText: 'cheap crm', composite: 80 });
  const foreign = await fixtures.tenant();
  const theirs = await fixtures.audit(foreign);
  await scored(foreign, theirs, { promptIndex: 0, promptText: 'rival', composite: 99 });
  const first = await read('read_prompt_metrics', { limit: 1 });
  expect(first).toMatchObject({
    state: 'available',
    view: 'list',
    audit_id: auditId,
    items: [{ prompt_text: 'cheap crm', composite_score: 80 }],
    pagination: { returned_count: 1, has_more: true, total_count: 2 },
    artifact_refs: [{ kind: 'audit', id: auditId }],
  });
  const cursor = (first.pagination as { next_cursor: string }).next_cursor;
  const newer = await fixtures.audit(tenant, { completedAt: new Date(Date.now() + 60_000) });
  await scored(tenant, newer, { promptIndex: 0, promptText: 'new', composite: 99 });
  expect(await read('read_prompt_metrics', { limit: 1, cursor })).toMatchObject({
    audit_id: auditId,
    items: [{ prompt_text: 'best crm', composite_score: 40 }],
    pagination: { has_more: false, next_cursor: null },
  });
  await expect(read('read_prompt_metrics', { view: 'history' })).rejects.toThrow(
    'view history needs prompt_id',
  );
});

it("counts one run's fanout queries for the latest run of this project", async () => {
  const tenant = await fixtures.tenant();
  const read = reader(tenant);
  expect(await read('read_query_fanouts')).toMatchObject({
    state: 'unavailable',
    reason: 'no_completed_run',
  });
  const auditId = await fixtures.audit(tenant);
  await fixtures.execution(tenant, {
    auditId,
    engine: 'chatgpt',
    taskEvents: [{ query: 'best crm' }, { query: 'crm pricing' }],
    analysis: { brandMentioned: true, brandMentions: ['Acme Corp'] },
  });
  const foreign = await fixtures.tenant();
  await fixtures.execution(foreign, {
    auditId: await fixtures.audit(foreign),
    taskEvents: [{ query: 'rival query' }],
    analysis: {},
  });
  const page = await read('read_query_fanouts');
  expect(page).toMatchObject({
    state: 'available',
    audit_id: auditId,
    event_count: 2,
    distinct_queries: 2,
    pagination: { returned_count: 2, has_more: false, total_count: 2 },
    artifact_refs: [{ kind: 'audit', id: auditId }],
  });
  expect((page.items as { query: string }[]).map((item) => item.query).sort()).toEqual([
    'best crm',
    'crm pricing',
  ]);
  expect(page).not.toHaveProperty('answers');
});

it("reads this project's competitor roster and pending suggestions, and refuses an untracked name", async () => {
  const tenant = await fixtures.tenant();
  const read = reader(tenant);
  await fixtures.competitor(tenant.projectId, { name: 'Globex', domains: ['globex.example'] });
  const foreign = await fixtures.tenant();
  await fixtures.competitor(foreign.projectId, { name: 'Initech' });
  expect(await read('read_competitors')).toMatchObject({
    state: 'available',
    view: 'list',
    competitors: [{ name: 'Globex', aliases: [], domains: ['globex.example'] }],
  });
  const auditId = await fixtures.audit(tenant);
  await db
    .insertInto('observed_entity_candidates')
    .values({
      id: randomUUID(),
      workspace_id: tenant.workspaceId,
      project_id: tenant.projectId,
      audit_id: auditId,
      name: 'Umbrella',
      kind: 'named_in_answers',
      domain: null,
      name_key: 'umbrella',
      engine_total: 4,
      citation_count: null,
      qualification_reason: 'Named across prompts and engines',
      prompt_count: 3,
      engine_count: 2,
      market_relevant: true,
      analyzer_version: 'observed-competitor-v1',
      source_analysis_ids: JSON.stringify([randomUUID()]),
      source_artifact_ids: JSON.stringify([]),
      status: 'pending',
      created_at: new Date(),
    })
    .execute();
  expect(await read('read_competitors', { view: 'suggestions' })).toMatchObject({
    state: 'available',
    items: [{ name: 'Umbrella', kind: 'named_in_answers', prompt_count: 3, status: 'pending' }],
    artifact_refs: [{ kind: 'audit', id: auditId }],
  });
  expect((await reader(foreign)('read_competitors', { view: 'suggestions' })).items).toEqual([]);
  await expect(read('read_competitors', { view: 'focus', name: 'Initech' })).rejects.toThrow(
    'No tracked competitor is named "Initech"',
  );
});
