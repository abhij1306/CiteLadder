/** Freeze the access gate and its exact acquisition/evaluation sources. */
import { sql } from 'kysely';
import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import type { MeasurementProjection } from './score-summary.ts';
import type { Crawl } from './task-fence.ts';
import { compareText } from '../text-order.ts';

const CRITICAL = policy.site_health.reads.eligibility_critical_checkpoints;
const EXCLUSIONS = policy.site_health.reads.corpus_exclusion_error_codes;
type EligibilityTask = { status: string; error_code: string } | undefined;

/**
 * One selected page's search-eligibility state and status bucket. Only the
 * critical checkpoints gate it; a page that left the corpus by policy is
 * excluded, and an unresolved failure is an error, not a blocker.
 */
export function eligibilityState(outcomes: Record<string, string>, task: EligibilityTask) {
  const critical = CRITICAL.map((key) => outcomes[key] ?? 'unknown');
  if (critical.includes('missing')) return { state: 'blocked', status: 'blocked' } as const;
  if (critical.every((value) => value === 'satisfied'))
    return { state: 'eligible', status: 'audited' } as const;
  if (task?.status === 'failed' && EXCLUSIONS.includes(task.error_code))
    return { state: 'excluded', status: 'excluded' } as const;
  return { state: 'unknown', status: task?.status === 'failed' ? 'error' : 'pending' } as const;
}

type Evaluation = MeasurementProjection['evaluations'][number];
type Task = MeasurementProjection['tasks'][number];

/** Acquisition's own checkpoint: an artifact satisfies it, a robots denial is an observed miss. */
function representation(task: Task | undefined) {
  if (task?.result_artifact_id)
    return { outcome: 'satisfied', reason: 'supported_public_representation' };
  if (task?.status === 'failed' && task.error_code === 'robots_denied')
    return { outcome: 'missing', reason: 'robots_denied' };
  return { outcome: 'unknown', reason: 'acquisition_not_determinate' };
}

/** The gate's evaluations per page, owned through the analyses' frozen source manifests. */
function gateEvaluations(projection: MeasurementProjection) {
  const owner = new Map(
    projection.rows.flatMap((row) =>
      (row.source_evaluation_ids ?? []).map((id) => [id, row.site_url_id] as const),
    ),
  );
  const indexability = new Map<string, Evaluation>();
  const snippets = new Map<string, Evaluation>();
  let crawler: Evaluation | undefined;
  for (const row of projection.evaluations) {
    const siteUrlId = owner.get(row.id);
    if (!siteUrlId) continue;
    if (row.rule_id === 'technical.indexable') indexability.set(siteUrlId, row);
    if (row.rule_id === 'search.snippet_access') snippets.set(siteUrlId, row);
    if (row.rule_id === 'search.crawler_access') crawler = row;
  }
  return { indexability, snippets, crawler };
}

const checkpoint = (key: string, evaluation: Evaluation | undefined) => ({
  checkpoint_id: key,
  outcome: evaluation?.outcome ?? 'unknown',
  reason: evaluation?.reason_code ?? 'analysis_missing',
  source_analysis_id: evaluation?.analysis_id ?? null,
  source_evaluation_id: evaluation?.id ?? null,
});

/** The crawl gate: any blocker blocks, then any unknown, then any eligible page. */
function gate(totals: Record<'eligible' | 'blocked' | 'unknown' | 'excluded', number>) {
  const order = ['blocked', 'unknown', 'eligible', 'excluded'] as const;
  return order.find((state) => totals[state] > 0) ?? 'unknown';
}

async function latestAttempts(db: Database, crawl: Crawl, taskIds: string[]) {
  const attempts = await db
    .selectFrom('site_fetch_attempts')
    .selectAll()
    .distinctOn('task_id')
    .where('workspace_id', '=', crawl.workspace_id)
    .where('crawl_id', '=', crawl.id)
    .where('task_id', '=', sql<string>`any(${taskIds}::uuid[])`)
    .orderBy('task_id')
    .orderBy('attempt_number', 'desc')
    .orderBy('request_ordinal', 'desc')
    .orderBy('id', 'desc')
    .execute();
  return new Map(attempts.map((row) => [row.task_id, row]));
}

export async function snapshotEligibility(
  db: Database,
  crawl: Crawl,
  projection: MeasurementProjection,
) {
  const tasks = new Map(projection.tasks.map((row) => [row.site_url_id, row]));
  const taskIds = projection.tasks.map((row) => row.id).toSorted(compareText);
  const attempts = await latestAttempts(db, crawl, taskIds);
  const { indexability, snippets, crawler } = gateEvaluations(projection);
  const totals = { eligible: 0, blocked: 0, unknown: 0, excluded: 0 };
  const statuses = { audited: 0, blocked: 0, excluded: 0, error: 0, pending: 0 };
  const reasons: Record<string, unknown>[] = [];
  for (const id of projection.selectedIds) {
    const task = tasks.get(id);
    const acquisition = representation(task);
    const indexing = indexability.get(id);
    const snippet = snippets.get(id);
    const { state, status } = eligibilityState(
      {
        'acquisition.public_representation': acquisition.outcome,
        'search.indexability': indexing?.outcome ?? 'unknown',
        'search.crawler_access': crawler?.outcome ?? 'unknown',
        'search.snippet_access': snippet?.outcome ?? 'unknown',
      },
      task,
    );
    totals[state]++;
    statuses[status]++;
    if (state === 'eligible') continue;
    reasons.push({
      site_url_id: id,
      state,
      checkpoints: [
        {
          checkpoint_id: 'acquisition.public_representation',
          ...acquisition,
          source_task_id: task?.id ?? null,
          source_attempt_id: (task && attempts.get(task.id)?.id) ?? null,
          source_artifact_id: task?.result_artifact_id ?? null,
        },
        checkpoint('search.crawler_access', crawler),
        checkpoint('search.snippet_access', snippet),
        checkpoint('search.indexability', indexing),
      ],
    });
  }
  return {
    search_eligibility: gate(totals),
    eligibility_totals: totals,
    eligibility_reasons: reasons,
    status_counts: statuses,
    source_task_ids: taskIds,
    source_attempt_ids: [...attempts.values()].map((row) => row.id).toSorted(compareText),
  };
}
