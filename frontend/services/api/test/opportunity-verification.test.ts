import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { loadWorkerSettings, policy } from '../src/config.ts';
import { verifyImplementationEvents } from '../src/opportunities/verification.ts';
import { enqueueImplementationVerification } from '../src/opportunities/enqueue.ts';
import {
  buildVerificationResult,
  type Declaration,
} from '../src/opportunities/verification-result.ts';
import type { QueueTask } from '../src/queue/task-queue.ts';
import type { Json } from '../src/generated/db-schema.ts';
import { storedOutcomes } from '../src/opportunities/verification-decisions.ts';
import { seedOpportunityScenario } from './opportunity-fixtures.ts';
import { seedVerification, type VerificationSeed } from './verification-support.ts';
import { testDatabase } from './support.ts';
import { drainWorkspace } from './analytics-drain.ts';
import { sql } from 'kysely';

const db = testDatabase();
type Seed = VerificationSeed;
const seeds: Seed[] = [];
let own: Seed;
let foreign: Seed;
let taskTemplate: QueueTask;
async function seed() {
  const created = await seedVerification(db);
  seeds.push(created);
  await db.transaction().execute(async (trx) => {
    for (const [triggerKind, triggerId] of [
      ['site_crawl', created.crawlId],
      ['audit', created.auditId],
      ['traffic_snapshot', created.trafficId],
    ]) {
      await enqueueImplementationVerification(trx, {
        workspaceId: created.workspaceId,
        projectId: created.projectId,
        triggerKind: triggerKind!,
        triggerId: triggerId!,
        maxAttempts: loadWorkerSettings({}).taskMaxAttempts,
      });
    }
  });
  return created;
}
beforeAll(async () => {
  own = await seed();
  foreign = await seed();
  taskTemplate = await db
    .selectFrom('analytics_tasks')
    .selectAll()
    .where('workspace_id', '=', own.workspaceId)
    .executeTakeFirstOrThrow();
  for (const s of [own, foreign])
    await drainWorkspace(db, s.workspaceId, { owner: `pr6-${randomUUID()}` });
});
afterAll(async () => {
  for (const seed of seeds) {
    await db.deleteFrom('workspaces').where('id', '=', seed.workspaceId).execute();
    await db.deleteFrom('users').where('id', '=', seed.userId).execute();
  }
  await db.destroy();
});
const context = { db, checkCancelled: async () => {}, maxAttempts: 3 };
const task = (seed: Seed, kind = 'site_crawl', id = seed.crawlId): QueueTask => ({
  ...taskTemplate,
  workspace_id: seed.workspaceId,
  project_id: seed.projectId,
  task_kind: 'opportunity_verification',
  payload: { trigger_kind: kind, trigger_id: id },
});
async function declaration(id: string): Promise<Declaration> {
  const row = await db
    .selectFrom('opportunity_implementation_events')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirstOrThrow();
  return {
    ...row,
    created_at: row.created_at.toISOString(),
    declared_implemented_at: row.declared_implemented_at.toISOString(),
  };
}
it('folds each check from the source that can read it, within the window, idempotently', async () => {
  const tasks = await db
    .selectFrom('analytics_tasks')
    .select(['status', 'error_detail'])
    .where('workspace_id', '=', own.workspaceId)
    .execute();
  expect(tasks).toHaveLength(3);
  expect(
    tasks.every((t) => t.status === 'succeeded'),
    JSON.stringify(tasks),
  ).toBe(true);
  const rows = await db
    .selectFrom('opportunity_verification_events')
    .select([
      'implementation_event_id as declaration',
      'observation_kind as kind',
      'result',
      'idempotency_key as key',
      'created_at',
    ])
    .where('workspace_id', '=', own.workspaceId)
    .orderBy('created_at')
    .execute();
  const named = (name: string) => rows.filter((r) => r.declaration === own.declarations[name]);
  const latest = (name: string) => named(name).at(-1);
  const checks = (name: string) => storedOutcomes(latest(name)?.result);
  for (const name of ['site', 'traffic', 'visibility', 'earned'])
    expect(latest(name)?.kind, name).toBe('verified');
  // Site-wide clicks never stand in for the page's own Search Console row.
  expect(latest('traffic_other')?.kind).toBe('observed');
  expect(checks('traffic_other').get(0)).toMatchObject({
    state: 'unavailable',
    reason: 'no_search_console_row',
  });
  expect(checks('missing_prompt').get(0)?.reason).toBe('prompt_not_in_run');
  expect(checks('legacy').get(0)?.reason).toBe('not_prompt_scoped');
  // Neither the crawl nor the window settles both checks; folded, they verify.
  expect(named('mixed').map((r) => r.kind)).toEqual(['observed', 'verified']);
  expect([...checks('mixed').values()].map((c) => c.source_kind).sort()).toEqual([
    'site_crawl',
    'traffic_snapshot',
  ]);
  expect(named('expired')).toEqual([]);
  const keys = rows.map((r) => r.key).sort();
  await Promise.all([
    verifyImplementationEvents(task(own), context),
    verifyImplementationEvents(task(own), context),
  ]);
  const replay = await db
    .selectFrom('opportunity_verification_events')
    .select('idempotency_key')
    .where('workspace_id', '=', own.workspaceId)
    .execute();
  expect(replay.map((r) => r.idempotency_key).sort()).toEqual(keys);
  const site = await db
    .selectFrom('opportunity_verification_events')
    .selectAll()
    .where('implementation_event_id', '=', own.declarations.site!)
    .executeTakeFirstOrThrow();
  expect(site.source_analysis_ids).toEqual([own.analysisId]);
  expect(site.source_rule_evaluation_ids).toEqual([own.ruleId]);
  expect(site.idempotency_key).toMatch(
    new RegExp(`123456:${policy.opportunity.opportunities.IMPLEMENTATION_VERIFIER_VERSION}$`),
  );
});

it('queues no verification for a project with nothing declared in the window', async () => {
  const bare = await seedOpportunityScenario(db);
  try {
    const queued = await enqueueImplementationVerification(db, {
      workspaceId: bare.workspace_id,
      projectId: bare.project_id,
      triggerKind: 'site_crawl',
      triggerId: bare.crawl_id,
      maxAttempts: 3,
    });
    expect(queued).toBeNull();
  } finally {
    await db.deleteFrom('workspaces').where('id', '=', bare.workspace_id).execute();
    await db.deleteFrom('users').where('id', '=', bare.user_id).execute();
  }
});

it('rejects foreign trigger IDs and refuses foreign snapshot provenance', async () => {
  await expect(
    verifyImplementationEvents(task(own, 'site_crawl', foreign.crawlId), context),
  ).rejects.toThrow('not terminal');
  await expect(
    verifyImplementationEvents({ ...task(own), project_id: foreign.projectId }, context),
  ).rejects.toThrow('outside its workspace');
  const d = await declaration(own.declarations.site!);
  const result = await buildVerificationResult(
    db,
    { ...d, opportunity_snapshot_id: foreign.snapshotId },
    null,
  );
  expect(result.state).toBe('unavailable');
  expect(result.legs).toEqual({});
  const scoped = await buildVerificationResult(db, d, foreign.auditId);
  expect(scoped.legs.visibility?.state).toBe('unavailable');
  const foreignBefore = await db
    .selectFrom('opportunity_verification_events')
    .select('id')
    .where('workspace_id', '=', foreign.workspaceId)
    .execute();
  await verifyImplementationEvents(task(own), context);
  expect(
    await db
      .selectFrom('opportunity_verification_events')
      .select('id')
      .where('workspace_id', '=', foreign.workspaceId)
      .execute(),
  ).toEqual(foreignBefore);
});
it('requires current finalized site evidence and scopes referenced rule rows', async () => {
  const original = await db
    .selectFrom('site_page_analyses')
    .selectAll()
    .where('id', '=', own.analysisId)
    .executeTakeFirstOrThrow();
  const before = await db
    .selectFrom('opportunity_verification_events')
    .select('id')
    .where('workspace_id', '=', own.workspaceId)
    .execute();
  try {
    const { evidenceFor } = await import('../src/opportunities/verification-evidence.ts');
    await db
      .updateTable('site_page_analyses')
      .set({ finalized_at: null })
      .where('id', '=', own.analysisId)
      .execute();
    const d = await declaration(own.declarations.site!);
    const evidence = () =>
      evidenceFor(db, d, {
        kind: 'site_crawl',
        id: own.crawlId,
        observed_at: own.moment,
      });
    const site = async () => (await evidence()).outcomes.get(0);
    expect(await site()).toMatchObject({ state: 'unavailable', reason: 'page_not_analyzed' });
    await db
      .updateTable('site_page_analyses')
      .set({ finalized_at: original.finalized_at, is_current: false })
      .where('id', '=', own.analysisId)
      .execute();
    expect(await site()).toMatchObject({ state: 'unavailable', reason: 'page_not_analyzed' });
    await db
      .updateTable('site_page_analyses')
      .set({ is_current: original.is_current })
      .where('id', '=', own.analysisId)
      .execute();
    await verifyImplementationEvents(task(own), context);
    expect(
      await db
        .selectFrom('opportunity_verification_events')
        .select('id')
        .where('workspace_id', '=', own.workspaceId)
        .execute(),
    ).toEqual(before);
    await db
      .updateTable('site_page_analyses')
      .set({ finalized_at: original.finalized_at, source_evaluation_ids: [foreign.ruleId] })
      .where('id', '=', own.analysisId)
      .execute();
    const scoped = await evidence();
    expect(scoped.outcomes.get(0)).toMatchObject({
      state: 'unavailable',
      reason: 'rule_not_evaluated',
    });
    expect([...scoped.rule_evaluation_ids]).toEqual([]);
  } finally {
    await db
      .updateTable('site_page_analyses')
      .set({
        finalized_at: original.finalized_at,
        is_current: original.is_current,
        source_evaluation_ids: original.source_evaluation_ids,
      })
      .where('id', '=', own.analysisId)
      .execute();
  }
});

it('compares scoped referral windows and frozen branded-demand sources without treating missing evidence as zero', async () => {
  const d = await declaration(own.declarations.site!);
  const scope = { workspace_id: own.workspaceId, project_id: own.projectId };
  const hour = 3_600_000;
  // Before the declaration (a day before the seed's moment) and after it.
  const baselineTime = new Date(Date.parse(own.moment) - 48 * hour);
  const postTime = new Date(Date.parse(own.moment) + 12 * hour);
  const window = {
    window_start: baselineTime,
    window_end: postTime,
    analyzer_version: '1',
    formula_version: '1',
  };
  const before = randomUUID();
  const after = randomUUID();
  const read = () => buildVerificationResult(db, d, null);
  await db
    .insertInto('ai_referrals_snapshots')
    .values({
      ...scope,
      ...window,
      id: after,
      created_at: postTime,
      granularity: 'day',
      preset_window_days: null,
      metrics: sql`${JSON.stringify({ totals: { ai_referrals: 0 } })}::jsonb`,
      source_classification_ids: null,
    })
    .execute();
  expect((await read()).legs.ai_referral_traffic?.state).toBe('unavailable');
  await db
    .insertInto('ai_referrals_snapshots')
    .values({
      ...scope,
      ...window,
      id: before,
      created_at: baselineTime,
      granularity: 'week',
      preset_window_days: null,
      metrics: sql`${JSON.stringify({ totals: { ai_referrals: 10 } })}::jsonb`,
      source_classification_ids: null,
    })
    .execute();
  expect((await read()).legs.ai_referral_traffic?.state).toBe('non_comparable');
  await db
    .updateTable('ai_referrals_snapshots')
    .set({
      granularity: 'day',
      window_start: new Date(baselineTime.getTime() - 72 * hour),
      window_end: new Date(postTime.getTime() - 72 * hour),
    })
    .where('id', '=', before)
    .execute();
  expect((await read()).legs.ai_referral_traffic).toMatchObject({
    state: 'observed_zero',
    baseline_source_ids: [before],
    post_source_ids: [after],
    delta: -10,
  });
  const baselineDemand = randomUUID();
  const postDemand = randomUUID();
  const snapshot = {
    ...scope,
    ...window,
    comparison: null,
    coverage: sql<Json>`'{}'::jsonb`,
    prior_snapshot_id: null,
    source_artifact_ids: sql<Json>`'[]'::jsonb`,
    source_metric_row_ids: sql<Json>`'[]'::jsonb`,
    summary: sql<Json>`'{}'::jsonb`,
  };
  await db
    .insertInto('demand_snapshots')
    .values({
      ...snapshot,
      id: baselineDemand,
      created_at: baselineTime,
      source_hash: baselineDemand,
    })
    .execute();
  await db
    .updateTable('opportunity_snapshots')
    .set({ demand_snapshot_id: baselineDemand })
    .where('id', '=', own.snapshotId)
    .execute();
  expect((await read()).legs.branded_search_demand?.state).toBe('not_run');
  await db
    .insertInto('demand_snapshots')
    .values({ ...snapshot, id: postDemand, created_at: postTime, source_hash: postDemand })
    .execute();
  const signal = randomUUID();
  await db
    .insertInto('demand_signals')
    .values({
      ...scope,
      id: signal,
      snapshot_id: baselineDemand,
      signal_type: policy.demand.DEMAND_SIGNAL_BRANDED_QUERY,
      analyzer_version: '1',
      formula_version: '1',
      rule_version: '1',
      state: 'available',
      identity_hash: signal,
      created_at: baselineTime,
      metrics: sql`'{"impressions":42}'::jsonb`,
      coverage: sql`'{}'::jsonb`,
      evidence: sql`'{}'::jsonb`,
      limitations: sql`'[]'::jsonb`,
      page_url: '',
      topic_cluster: '',
      priority_inputs: sql`'{}'::jsonb`,
      priority_score: null,
    })
    .execute();
  expect((await read()).legs.branded_search_demand).toMatchObject({
    state: 'observed_zero',
    baseline_source_ids: [baselineDemand, signal],
    post_source_ids: [postDemand],
    delta: -42,
  });
  const foreignSnapshot = randomUUID();
  await db
    .insertInto('demand_snapshots')
    .values({
      ...snapshot,
      workspace_id: foreign.workspaceId,
      project_id: foreign.projectId,
      id: foreignSnapshot,
      created_at: baselineTime,
      source_hash: foreignSnapshot,
    })
    .execute();
  await db
    .updateTable('opportunity_snapshots')
    .set({ demand_snapshot_id: foreignSnapshot })
    .where('id', '=', own.snapshotId)
    .execute();
  expect((await read()).legs.branded_search_demand?.state).toBe('unavailable');
});
it('keeps baseline gaps unknown until a later snapshot and suppresses changed audit cohorts', async () => {
  const d = await declaration(own.declarations.site!);
  const result = await buildVerificationResult(db, d, own.auditId);
  expect(result.gap_changes).toEqual({
    no_longer_observed: [],
    persistent: [],
    new: [],
    state: 'not_run',
  });
  expect(result.legs.visibility?.state).toBe('available');
  const audit = await db
    .selectFrom('audits')
    .selectAll()
    .where('id', '=', own.auditId)
    .executeTakeFirstOrThrow();
  const different = randomUUID();
  await db
    .insertInto('audits')
    .values({ ...audit, id: different })
    .execute();
  expect((await buildVerificationResult(db, d, different)).legs.visibility?.state).toBe(
    'non_comparable',
  );
  // A foreign baseline audit must remain unavailable even when its ID exists.
  await db
    .updateTable('opportunity_snapshots')
    .set({ audit_id: foreign.auditId })
    .where('id', '=', own.snapshotId)
    .execute();
  try {
    expect((await buildVerificationResult(db, d, own.auditId)).legs.visibility?.state).toBe(
      'unavailable',
    );
  } finally {
    await db
      .updateTable('opportunity_snapshots')
      .set({ audit_id: own.auditId })
      .where('id', '=', own.snapshotId)
      .execute();
  }
});
