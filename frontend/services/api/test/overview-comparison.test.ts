import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { commandCenter } from '../src/projects/command-center.ts';
import { getVisibility } from '../src/visibility/dashboard.ts';
import { persistComparisonBaselines } from '../src/visibility/baselines.ts';
import type { Database } from '../src/db/database.ts';
import { testDatabase } from './support.ts';
import { VisibilityFixtures, type Tenant } from './visibility-fixtures.ts';

const comparedConfiguration = {
  brand_name: 'Acme Corp',
  brand_aliases: [],
  owned_domains: ['acme.example'],
  competitors: [],
  country_code: 'US',
  language_code: 'en',
  benchmark_mode: 'consumer_like',
  panel_hash: 'panel-1',
  engine_routes: { chatgpt: { transport_provider: 'test', transport_model: 'test' } },
  measurement_policy: { retrieval_enabled: true, max_output_tokens: 1000, answer_instruction: '' },
};

function mentionAggregate(count: number) {
  const metrics = {
    total_completed: 2,
    brand_mention_count: count,
    owned_citation_response_count: 0,
    brand_mention_rate: count / 2,
    owned_citation_rate: 0,
    competitor_mention_rate: {},
    competitor_citation_rate: {},
    share_of_voice: { mention_counts: { 'Acme Corp': count } },
    coverage: { requested: 2, failed: 0, not_run: 0 },
  };
  return { ...metrics, per_engine: { chatgpt: metrics } };
}

async function rawSnapshot(database: Database, t: Tenant, auditId: string, count: number) {
  await database
    .insertInto('metric_snapshots')
    .values({
      id: randomUUID(),
      workspace_id: t.workspaceId,
      project_id: t.projectId,
      audit_id: auditId,
      analyzer_version: 'test',
      scoring_rule_version: 'test',
      total_completed: 2,
      total_failed: 0,
      visibility_score: 0,
      metrics: JSON.stringify(mentionAggregate(count)),
      source_analysis_ids: '[]',
      source_artifact_ids: '[]',
      owned_citation_count: 0,
      owned_citation_ids: '[]',
      owned_citation_pages: '[]',
      created_at: new Date(),
    })
    .execute();
}

describe('overview comparison with the persisted baseline', () => {
  const db = testDatabase();
  const measurements = new VisibilityFixtures(db);
  afterAll(async () => {
    await measurements.cleanup();
    await db.destroy();
  });
  it('overview compares frozen measurements and keeps unknown metrics distinct from observed zero', async () => {
    const t = await measurements.tenant();
    await db
      .updateTable('projects')
      .set({ benchmark_mode: 'consumer_like' })
      .where('id', '=', t.projectId)
      .execute();
    await measurements.brand(t.projectId, 'Acme Corp');
    const configuration = comparedConfiguration;
    async function measured(
      at: string,
      count: number,
      score: number,
      config = configuration,
      status = 'completed',
    ) {
      const id = await measurements.audit(t, {
        completedAt: new Date(at),
        configuration: config,
        status,
      });
      const aggregate = {
        total_completed: 2,
        brand_mention_count: count,
        owned_citation_response_count: 0,
        brand_mention_rate: count / 2,
        owned_citation_rate: 0,
        competitor_mention_rate: {},
        competitor_citation_rate: {},
        share_of_voice: { mention_counts: { 'Acme Corp': count } },
        coverage: { requested: 2, failed: 0, not_run: 0 },
      };
      await measurements.metricSnapshot(t, id, {
        metrics: { ...aggregate, per_engine: { chatgpt: aggregate } },
        visibilityScore: score,
      });
      return id;
    }
    const baseline = await measured('2026-03-01T00:00:00Z', 0, 0);
    await measured('2026-03-02T00:00:00Z', 1, 20, {
      ...configuration,
      panel_hash: 'different-panel',
    });
    const current = await measured(
      '2026-03-03T00:00:00Z',
      2,
      40,
      configuration,
      'partially_completed',
    );
    const view = await commandCenter(db, t, null);
    expect(view).toMatchObject({
      measurement: {
        audit_id: current,
        comparable_audit_id: baseline,
        analyzer_version: 'test',
        scoring_rule_version: 'test',
      },
      state: { visibility: { value: 100, delta: 100 } },
      track: { citation_share: { value: 0, delta: 0 } },
      report_available: true,
      stale: false,
    });
    const historical = await commandCenter(db, t, baseline);
    expect(historical).toMatchObject({ stale: true, loop: { tracked: { freshness: 'unknown' } } });
    expect(
      await db
        .selectFrom('metric_snapshots')
        .select('audit_id')
        .where('id', '=', view.measurement!.metric_snapshot_id!)
        .executeTakeFirst(),
    ).toEqual({ audit_id: current });
    expect(historical.state.visibility).toEqual({
      value: 0,
      delta: null,
    });
    await expect(
      commandCenter(db, { ...t, workspaceId: randomUUID() }, null),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('overview and visibility compare a run with the one baseline finalization persisted', async () => {
    const t = await measurements.tenant();
    await db
      .updateTable('projects')
      .set({ benchmark_mode: 'consumer_like' })
      .where('id', '=', t.projectId)
      .execute();
    await measurements.brand(t.projectId, 'Acme Corp');
    const configuration = comparedConfiguration;
    const run = async (at: string, count: number) => {
      const id = await measurements.audit(t, { completedAt: new Date(at), configuration });
      await measurements.metricSnapshot(t, id, { metrics: mentionAggregate(count) });
      return id;
    };
    const raw = async (at: string, count: number) => {
      const id = await measurements.audit(t, { completedAt: new Date(at), configuration });
      await rawSnapshot(db, t, id, count);
      return id;
    };
    const visibilityOf = (auditId: string | null) =>
      getVisibility(db, t, {
        auditId,
        logicalEngine: null,
        baselineId: null,
        selectionMode: auditId ? 'run' : 'latest',
        fromAt: null,
        toAt: null,
        configurationKey: null,
        cohort: 'core',
      });
    const baseline = await run('2026-04-01T00:00:00Z', 0);
    const current = await run('2026-04-03T00:00:00Z', 2);
    const stored = await db
      .selectFrom('audit_comparison_baselines')
      .select(['status', 'baseline_audit_id'])
      .where('audit_id', '=', current)
      .where('cohort', '=', 'core')
      .where('logical_engine', 'is', null)
      .executeTakeFirstOrThrow();
    expect(stored).toEqual({ status: 'comparable', baseline_audit_id: baseline });
    await raw('2026-04-02T00:00:00Z', 1);
    const overview = await commandCenter(db, t, null);
    const dashboard = await visibilityOf(null);
    expect(overview.measurement).toMatchObject({
      audit_id: current,
      comparable_audit_id: baseline,
      comparison_status: 'comparable',
    });
    expect(dashboard.comparison).toMatchObject({
      status: 'comparable',
      baseline_audit_id: baseline,
    });
    expect(overview.state.visibility).toEqual({ value: 100, delta: 100 });
    expect(overview.track.limitations).toEqual([]);
    const pending = await raw('2026-04-04T00:00:00Z', 2);
    const pendingView = await commandCenter(db, t, null);
    expect(pendingView.measurement).toMatchObject({
      audit_id: pending,
      comparable_audit_id: null,
      comparison_status: 'baseline_pending',
    });
    expect(pendingView.track.limitations).toEqual([
      'The comparison with an earlier run is still being prepared.',
    ]);
    expect((await visibilityOf(pending)).comparison).toMatchObject({ status: 'baseline_pending' });
    const first = await commandCenter(db, t, baseline);
    expect(first.measurement).toMatchObject({
      comparable_audit_id: null,
      comparison_status: 'no_baseline',
    });
    expect(first.track.limitations).toEqual(['No earlier run to compare with yet.']);
    const outsider = await measurements.tenant();
    await expect(
      commandCenter(db, { workspaceId: outsider.workspaceId, projectId: t.projectId }, current),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('overview shows a matched-subset change from the answers both runs share, with its note', async () => {
    const t = await measurements.tenant();
    await db
      .updateTable('projects')
      .set({ benchmark_mode: 'consumer_like' })
      .where('id', '=', t.projectId)
      .execute();
    await measurements.brand(t.projectId, 'Acme Corp');
    const configuration = comparedConfiguration;
    const score = { overall: 1 };
    const run = async (at: string, mentioned: boolean[], requested: number) => {
      const id = await measurements.audit(t, { completedAt: new Date(at), configuration });
      for (const [promptIndex, brandMentioned] of mentioned.entries()) {
        await measurements.execution(t, {
          auditId: id,
          promptIndex,
          transportModel: 'test',
          analysis: { brandMentioned, score },
        });
      }
      const count = mentioned.filter(Boolean).length;
      const completed = mentioned.length;
      const metrics = {
        ...mentionAggregate(count),
        total_completed: completed,
        brand_mention_rate: count / completed,
        coverage: { requested, failed: requested - completed, not_run: 0 },
      };
      await measurements.metricSnapshot(t, id, {
        metrics: { ...metrics, per_engine: { chatgpt: metrics } },
      });
      return id;
    };
    await run('2026-05-01T00:00:00Z', [false, false], 2);
    await run('2026-05-03T00:00:00Z', [true, true, false], 4);

    const view = await commandCenter(db, t, null);

    expect(view.measurement).toMatchObject({
      comparison_status: 'matched_subset',
      comparable_audit_id: null,
      comparison_answers: { matched: 2, total: 3 },
    });
    expect(view.state.visibility).toEqual({ value: 66.67, delta: 100 });
    expect(view.track.limitations).toEqual(['2 of 3 answers comparable']);
  });

  it('two runs finalizing together still name each other, in either commit order', async () => {
    const configuration = comparedConfiguration;
    for (const laterCommitsFirst of [true, false]) {
      const t = await measurements.tenant();
      await measurements.brand(t.projectId, 'Acme Corp');
      const first = await measurements.audit(t, {
        completedAt: new Date('2026-04-01T00:00:00Z'),
        configuration,
      });
      await measurements.metricSnapshot(t, first, { metrics: mentionAggregate(0) });
      const unsettled = { completedAt: null, status: 'analyzing', configuration };
      const earlier = await measurements.audit(t, unsettled);
      const later = await measurements.audit(t, unsettled);
      const finalize = async (
        trx: Database,
        { auditId, at, count }: { auditId: string; at: string; count: number },
      ) => {
        await trx
          .updateTable('audits')
          .set({ status: 'completed', completed_at: new Date(at) })
          .where('id', '=', auditId)
          .execute();
        await rawSnapshot(trx, t, auditId, count);
        await persistComparisonBaselines(trx, { workspaceId: t.workspaceId, auditId });
      };
      const runs = [
        { auditId: earlier, at: '2026-04-02T00:00:00Z', count: 1 },
        { auditId: later, at: '2026-04-03T00:00:00Z', count: 2 },
      ];
      const [opening, closing] = laterCommitsFirst ? [runs[1]!, runs[0]!] : [runs[0]!, runs[1]!];
      let release = () => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      let written = () => {};
      const holding = new Promise<void>((resolve) => {
        written = resolve;
      });
      const one = db.transaction().execute(async (trx) => {
        await finalize(trx, opening);
        written();
        await held;
      });
      await holding;
      let waiter: number | null = null;
      const two = db.transaction().execute(async (trx) => {
        const { rows } = await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(trx);
        waiter = rows[0]!.pid;
        await finalize(trx, closing);
      });
      await vi.waitFor(
        async () => {
          const { rows } = await sql<{ waiting: number }>`
            select count(*)::int as waiting from pg_locks
            where pid = ${waiter} and locktype = 'advisory' and not granted`.execute(db);
          expect(rows[0]?.waiting).toBe(1);
        },
        { timeout: 10_000, interval: 50 },
      );
      release();
      await Promise.all([one, two]);
      const stored = await db
        .selectFrom('audit_comparison_baselines')
        .select(['audit_id', 'status', 'baseline_audit_id'])
        .where('audit_id', 'in', [earlier, later])
        .where('cohort', '=', 'core')
        .where('logical_engine', 'is', null)
        .execute();
      expect(Object.fromEntries(stored.map((row) => [row.audit_id, row]))).toEqual({
        [earlier]: { audit_id: earlier, status: 'comparable', baseline_audit_id: first },
        [later]: { audit_id: later, status: 'comparable', baseline_audit_id: earlier },
      });
    }
  }, 60_000);
});
