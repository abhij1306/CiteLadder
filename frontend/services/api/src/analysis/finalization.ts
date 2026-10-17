import { randomUUID } from 'node:crypto';
import { sql, type Selectable } from 'kysely';
import type { Database } from '../db/database.ts';
import type { Audits, AuditTasks } from '../generated/db-schema.ts';
import { policy } from '../config.ts';
import { record, numberRecord } from '../db/json.ts';
import { promptTextHash } from '../prompts/normalization.ts';
import { auditEvent, transitionAudit } from '../audits/state.ts';
import { scoringConfig } from './scoring.ts';
import { analyzeExecution } from './execution.ts';
import { aggregateRun, promptTrend, type Aggregate, type AggregateExecution } from './aggregate.ts';
import { frozenComparisonKey } from './comparison.ts';
import { persistObservedCompetitors } from './observed-competitors.ts';
import { round } from './round.ts';
import { getLogger } from '../logging.ts';
import { compareText } from '../text-order.ts';
import { enqueueTrafficInsights } from '../crawl-logs/insights-enqueue.ts';

type ScopedTask = Selectable<AuditTasks> & { cohort: string };
function coverage(tasks: ScopedTask[], completed: number) {
  const succeeded = tasks.filter((t) => t.status === 'succeeded').length;
  return {
    requested: tasks.length,
    completed,
    failed: tasks.filter((t) => t.status === 'failed').length,
    not_run: tasks.filter((t) => !['succeeded', 'failed'].includes(t.status)).length,
    unavailable: Math.max(0, succeeded - completed),
    rate: tasks.length ? completed / tasks.length : null,
  };
}
function cohortMetrics(
  rows: AggregateExecution[],
  tasks: ScopedTask[],
  config: ReturnType<typeof scoringConfig>,
  cohorts: readonly string[],
  name: string,
  engines: string[],
) {
  const eligible = rows.filter((r) => cohorts.includes(r.cohort)),
    eligibleTasks = tasks.filter((t) => cohorts.includes(t.cohort));
  const aggregate = aggregateRun(eligible, config);
  return {
    ...aggregate,
    cohort: name,
    coverage: coverage(eligibleTasks, aggregate.total_completed),
    per_engine: Object.fromEntries(
      engines.map((engine) => {
        const value = aggregateRun(
          eligible.filter((r) => r.logical_engine === engine),
          config,
        );
        return [
          engine,
          {
            ...value,
            coverage: coverage(
              eligibleTasks.filter((t) => t.logical_engine === engine),
              value.total_completed,
            ),
          },
        ];
      }),
    ),
  };
}

function tallyStatusCounts(statusCounts: { status: string; count: string }[]) {
  let completed = 0,
    failed = 0,
    open = 0;
  for (const { status, count } of statusCounts) {
    if (status === 'succeeded') completed += Number(count);
    else if (policy.task_queue.terminal.includes(status)) failed += Number(count);
    else open += Number(count);
  }
  return { completed, failed, open };
}
function artifactsByTask<T extends { task_id: string }>(artifacts: T[]) {
  const byTask = new Map<string, T>();
  for (const artifact of artifacts) {
    if (byTask.has(artifact.task_id)) throw new Error('Multiple immutable artifacts for one task');
    byTask.set(artifact.task_id, artifact);
  }
  return byTask;
}

/** Root lock serializes progress and finalization; the caller supplies the Commerce projection owner. */
export function finalizeAudit(
  db: Database,
  workspaceId: string,
  auditId: string,
  commerce: (db: Database, audit: Selectable<Audits>) => Promise<void>,
  at = new Date(),
  derive: typeof analyzeExecution = analyzeExecution,
) {
  return db.transaction().execute(async (trx) => {
    const audit = await trx
      .selectFrom('audits')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .where('id', '=', auditId)
      .forUpdate()
      .executeTakeFirst();
    if (!audit || policy.audits.constants.audit_terminal_statuses.includes(audit.status))
      return null;
    // Every settled task calls this; count by status so progress costs one aggregate, not a row load.
    const statusCounts = await trx
      .selectFrom('audit_tasks')
      .select((eb) => ['status', eb.fn.countAll<string>().as('count')])
      .where('workspace_id', '=', workspaceId)
      .where('audit_id', '=', audit.id)
      .groupBy('status')
      .execute();
    const { completed, failed, open } = tallyStatusCounts(statusCounts);
    if (audit.completed_count !== completed || audit.failed_count !== failed)
      await trx
        .updateTable('audits')
        .set({ completed_count: completed, failed_count: failed, updated_at: at })
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', audit.id)
        .execute();
    if (open) return null;
    const tasks = await trx
      .selectFrom('audit_tasks as t')
      .innerJoin('audit_prompt_snapshots as p', (join) =>
        join.onRef('p.id', '=', 't.prompt_snapshot_id').onRef('p.audit_id', '=', 't.audit_id'),
      )
      .selectAll('t')
      .select('p.cohort')
      .where('t.workspace_id', '=', workspaceId)
      .where('t.audit_id', '=', audit.id)
      .orderBy('t.randomized_position')
      .execute();
    if (audit.status === 'queued') await transitionAudit(trx, workspaceId, auditId, 'running', at);
    if (!completed) {
      await transitionAudit(
        trx,
        workspaceId,
        auditId,
        'failed',
        at,
        'audit failed: no successful executions',
      );
      await trx
        .updateTable('audits')
        .set({ completed_at: at, error_message: 'no successful executions' })
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', auditId)
        .execute();
      return null;
    }
    if (['queued', 'running'].includes(audit.status))
      await transitionAudit(
        trx,
        workspaceId,
        auditId,
        'analyzing',
        at,
        'execution complete; ready for analysis',
      );
    else if (audit.status !== 'analyzing') return null;
    for (const task of tasks.filter((t) => t.status === 'succeeded')) {
      if (!task.result_artifact_id) throw new Error('Successful task has no immutable artifact');
      await derive(trx, task, audit, task.result_artifact_id);
    }
    const analyses = await trx
      .selectFrom('response_analyses')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .where('audit_id', '=', auditId)
      .orderBy('prompt_index')
      .orderBy('logical_engine')
      .orderBy('repetition')
      .execute();
    const artifacts = await trx
      .selectFrom('raw_response_artifacts as r')
      .innerJoin('audits as a', 'a.id', 'r.audit_id')
      .selectAll('r')
      .where('a.workspace_id', '=', workspaceId)
      .where('r.audit_id', '=', auditId)
      .execute();
    const byTask = artifactsByTask(artifacts);
    const snapshots = await trx
      .selectFrom('audit_prompt_snapshots')
      .selectAll()
      .where('audit_id', '=', auditId)
      .orderBy('prompt_index')
      .execute();
    const promptByIndex = new Map(snapshots.map((p) => [p.prompt_index, p]));
    const citations = await trx
      .selectFrom('citations')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .where('audit_id', '=', auditId)
      .orderBy('ordinal')
      .execute();
    const rows: AggregateExecution[] = analyses.map((a) => {
      const prompt = promptByIndex.get(a.prompt_index),
        artifact = byTask.get(a.task_id);
      if (!prompt || artifact?.id !== a.artifact_id)
        throw new Error('Analysis source provenance mismatch');
      return {
        prompt_index: a.prompt_index,
        prompt_text_snapshot: prompt.text,
        prompt_theme_snapshot: prompt.theme,
        cohort: prompt.cohort,
        logical_engine: a.logical_engine,
        score: record(a.score),
        usage: record(artifact.usage),
        citations: citations
          .filter((c) => c.analysis_id === a.id)
          .map((c) => ({
            url: c.url,
            domain: c.domain,
            is_owned: c.is_owned,
            is_unintended: c.is_unintended,
            matched_competitor: c.matched_competitor,
          })),
      };
    });
    const config = scoringConfig(audit.configuration),
      engines = [...new Set(tasks.map((t) => t.logical_engine))].sort(compareText);
    const organic = cohortMetrics(
      rows,
      tasks,
      config,
      policy.visibility.organic_cohorts,
      'market_visibility',
      engines,
    );
    const comparison = cohortMetrics(rows, tasks, config, ['comparison'], 'comparison', engines);
    const diagnostic: Aggregate & { cohort: string; coverage: ReturnType<typeof coverage> } = {
      ...aggregateRun(
        rows.filter((r) => r.cohort === 'brand_diagnostic'),
        config,
      ),
      cohort: 'brand_diagnostic',
      coverage: coverage(
        tasks.filter((t) => t.cohort === 'brand_diagnostic'),
        rows.filter((r) => r.cohort === 'brand_diagnostic').length,
      ),
    };
    // Unbranded and branded prompts together: its own block, never a blend of
    // the other two, so its rates are counted over the answers they share.
    const all = cohortMetrics(
      rows,
      tasks,
      config,
      policy.visibility.all_cohorts,
      policy.visibility.all_cohort,
      engines,
    );
    const metrics = { ...organic, comparison, brand_diagnostic: diagnostic, all };
    const visibility = organic.per_prompt.length
      ? round(
          organic.per_prompt.reduce((sum, p) => sum + p.composite_score, 0) /
            organic.per_prompt.length,
          2,
        )
      : 0;
    const versions = policy.audits.analysis;
    const metric = await trx
      .insertInto('metric_snapshots')
      .values({
        id: randomUUID(),
        workspace_id: workspaceId,
        project_id: audit.project_id,
        audit_id: auditId,
        analyzer_version: versions.analyzer_version,
        scoring_rule_version: versions.scoring_rule_version,
        total_completed: analyses.length,
        total_failed: Math.max(0, audit.requested_count - analyses.length),
        visibility_score: visibility,
        metrics: JSON.stringify(metrics),
        source_analysis_ids: JSON.stringify(analyses.map((a) => a.id)),
        source_artifact_ids: JSON.stringify(analyses.map((a) => a.artifact_id)),
        created_at: at,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await persistPromptMetrics(
      trx,
      audit,
      [...organic.per_prompt, ...comparison.per_prompt, ...diagnostic.per_prompt],
      snapshots,
      analyses,
      engines.length,
      at,
    );
    await persistObservedCompetitors(trx, audit, analyses, config, at);
    await sql`savepoint commerce_shelf_finalization`.execute(trx);
    try {
      await commerce(trx, audit);
    } catch {
      await sql`rollback to savepoint commerce_shelf_finalization`.execute(trx);
      getLogger('workers.audit').info('commerce_shelf_finalization_failed', { audit_id: audit.id });
    }
    await sql`release savepoint commerce_shelf_finalization`.execute(trx);
    await trx
      .updateTable('audits')
      .set({
        summary: JSON.stringify(metrics),
        analyzer_version: versions.analyzer_version,
        completed_count: analyses.length,
        failed_count: metric.total_failed,
        completed_at: audit.completed_at ?? at,
        updated_at: at,
      })
      .where('workspace_id', '=', workspaceId)
      .where('id', '=', auditId)
      .execute();
    await transitionAudit(trx, workspaceId, auditId, 'reporting', at, 'aggregating metrics');
    const status = metric.total_failed ? 'partially_completed' : 'completed';
    await transitionAudit(trx, workspaceId, auditId, status, at, `audit ${status}`);
    await enqueueTrafficInsights(trx, { workspaceId, projectId: audit.project_id }, at);
    await auditEvent(
      trx,
      auditId,
      policy.audits.constants.event_audit_completed,
      `audit ${status}`,
      {
        status,
        completed: analyses.length,
        failed: metric.total_failed,
        visibility_score: visibility,
      },
      at,
    );
    return metric;
  });
}

async function persistPromptMetrics(
  db: Database,
  audit: Selectable<Audits>,
  rows: Aggregate['per_prompt'],
  snapshots: Selectable<import('../generated/db-schema.ts').AuditPromptSnapshots>[],
  analyses: Selectable<import('../generated/db-schema.ts').ResponseAnalyses>[],
  engineCount: number,
  at: Date,
) {
  const rules = policy.audits.analysis,
    context = frozenComparisonKey(audit.configuration, null, false);
  const prepared = rows.map((row) => ({
    row,
    prompt: snapshots.find((p) => p.prompt_index === row.prompt_index)!,
  }));
  const histories = prepared.length
    ? await db
        .selectFrom('prompt_metric_snapshots as p')
        .innerJoin('audits as a', 'a.id', 'p.audit_id')
        .selectAll('p')
        .select('a.configuration as configuration')
        .where('p.workspace_id', '=', audit.workspace_id)
        .where('a.workspace_id', '=', audit.workspace_id)
        .where('p.project_id', '=', audit.project_id)
        .where('p.audit_id', '!=', audit.id)
        .where('p.analyzer_version', '=', rules.analyzer_version)
        .where('p.scoring_rule_version', '=', rules.scoring_rule_version)
        .where('a.benchmark_mode', '=', audit.benchmark_mode)
        .where('a.audit_scope', '=', audit.audit_scope)
        .where('a.completed_at', 'is not', null)
        .where((eb) =>
          eb.or(
            prepared.map(({ prompt }) =>
              eb.and([
                eb('p.prompt_identity', '=', promptTextHash(prompt.text)),
                eb('p.cohort', '=', prompt.cohort),
              ]),
            ),
          ),
        )
        .orderBy('a.completed_at', 'desc')
        .orderBy('a.id', 'desc')
        .limit(rules.prompt_decline_history_candidate_limit * prepared.length)
        .execute()
    : [];
  const metrics = prepared.map(({ row, prompt }) => {
    const identity = promptTextHash(prompt.text);
    const previous = histories
      .filter(
        (p) =>
          p.prompt_identity === identity &&
          p.cohort === prompt.cohort &&
          context !== null &&
          frozenComparisonKey(p.configuration, null, false) === context &&
          Object.keys(row.per_engine_scores).filter((e) =>
            Object.hasOwn(numberRecord(p.per_engine_scores), e),
          ).length >= rules.prompt_decline_min_engines,
      )
      .slice(0, rules.prompt_decline_window_movements);
    const trend = promptTrend(row, previous, audit.repetitions, engineCount),
      sources = analyses.filter((a) => a.prompt_index === prompt.prompt_index);
    return {
      id: randomUUID(),
      workspace_id: audit.workspace_id,
      project_id: audit.project_id,
      audit_id: audit.id,
      prompt_id: prompt.prompt_id,
      prompt_identity: identity,
      prompt_index: prompt.prompt_index,
      prompt_text: prompt.text,
      cohort: prompt.cohort,
      analyzer_version: rules.analyzer_version,
      scoring_rule_version: rules.scoring_rule_version,
      ...trend,
      rolling_four: JSON.stringify(trend.rolling_four),
      per_engine_scores: JSON.stringify(trend.per_engine_scores),
      components: JSON.stringify(row.score_components),
      source_analysis_ids: JSON.stringify(sources.map((a) => a.id)),
      source_artifact_ids: JSON.stringify(sources.map((a) => a.artifact_id)),
      created_at: at,
    };
  });
  if (metrics.length) await db.insertInto('prompt_metric_snapshots').values(metrics).execute();
}
