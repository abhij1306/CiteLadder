import { sql } from 'kysely';
import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import type { ProjectionEvaluation, ProjectionTask } from './score-summary.ts';
import type { Crawl } from './site-task.ts';
import { taskOutcome } from './task-outcome.ts';
import { compareText } from '../text-order.ts';

const CRITICAL = policy.site_health.reads.eligibility_critical_checkpoints;
type EligibilityTask =
  | { status: string; error_code: string; status_code?: number | null }
  | undefined;

export function eligibilityState(outcomes: Record<string, string>, task: EligibilityTask) {
  const failure =
    task?.status === 'failed'
      ? taskOutcome({ errorCode: task.error_code, statusCode: task.status_code })
      : null;
  if (failure === 'excluded') return { state: 'excluded', status: 'excluded' } as const;
  // A removed page cannot be indexed; the broken-link check reports whoever links to it.
  if (failure === 'gone') return { state: 'excluded', status: 'error' } as const;
  if (outcomes['search.indexability'] === 'not_applicable')
    return { state: 'excluded', status: 'audited' } as const;
  const critical = CRITICAL.map((key) => outcomes[key] ?? 'unknown');
  if (critical.includes('missing')) return { state: 'blocked', status: 'blocked' } as const;
  if (critical.every((value) => value === 'satisfied'))
    return { state: 'eligible', status: 'audited' } as const;
  return { state: 'unknown', status: task?.status === 'failed' ? 'error' : 'pending' } as const;
}

type Evaluation = ProjectionEvaluation;
type Task = ProjectionTask;

function representation(task: Task | undefined) {
  if (task?.result_artifact_id)
    return { outcome: 'satisfied', reason: 'supported_public_representation' };
  if (task?.status === 'failed' && task.error_code === 'robots_denied')
    return { outcome: 'missing', reason: 'robots_denied' };
  return { outcome: 'unknown', reason: 'acquisition_not_determinate' };
}

const checkpoint = (key: string, evaluation: Evaluation | undefined) => ({
  checkpoint_id: key,
  outcome: evaluation?.outcome ?? 'unknown',
  reason: evaluation?.reason_code ?? 'analysis_missing',
  source_analysis_id: evaluation?.analysis_id ?? null,
  source_evaluation_id: evaluation?.id ?? null,
});

function gate(totals: Record<'eligible' | 'blocked' | 'unknown' | 'excluded', number>) {
  const order = ['blocked', 'unknown', 'eligible', 'excluded'] as const;
  return order.find((state) => totals[state] > 0) ?? 'unknown';
}

async function latestAttempts(db: Database, crawl: Crawl, taskIds: string[]) {
  if (!taskIds.length) return new Map<string, { id: string; status_code: number | null }>();
  const attempts = await db
    .selectFrom('site_fetch_attempts')
    .select(['id', 'task_id', 'status_code'])
    .distinctOn('task_id')
    .where('workspace_id', '=', crawl.workspace_id)
    .where('task_id', '=', sql<string>`any(${taskIds}::uuid[])`)
    .orderBy('task_id')
    .orderBy('attempt_number', 'desc')
    .orderBy('request_ordinal', 'desc')
    .orderBy('id', 'desc')
    .execute();
  return new Map(attempts.map((row) => [row.task_id, row]));
}

function lastOf(rows: Evaluation[], rule: string) {
  let found: Evaluation | undefined;
  for (const row of rows)
    if (row.rule_id === rule && (!found || compareText(found.id, row.id) < 0)) found = row;
  return found;
}

export type EligibilityBatch = {
  selectedIds: string[];
  tasks: Map<string, Task>;
  evaluations: Map<string, Evaluation[]>;
};

export class EligibilityFold {
  private readonly totals = { eligible: 0, blocked: 0, unknown: 0, excluded: 0 };
  private readonly statuses = { audited: 0, blocked: 0, excluded: 0, error: 0, pending: 0 };
  private readonly reasons: Record<string, unknown>[] = [];
  private readonly taskIds: string[] = [];
  private readonly attemptIds: string[] = [];
  private readonly crawler: Evaluation | undefined;
  constructor(crawler: Evaluation | undefined) {
    this.crawler = crawler;
  }
  async add(db: Database, crawl: Crawl, batch: EligibilityBatch) {
    const taskIds = [...batch.tasks.values()].map((row) => row.id);
    const attempts = await latestAttempts(db, crawl, taskIds);
    this.taskIds.push(...taskIds);
    this.attemptIds.push(...[...attempts.values()].map((row) => row.id));
    const crawler = this.crawler;
    for (const id of batch.selectedIds) {
      const task = batch.tasks.get(id);
      const own = batch.evaluations.get(id) ?? [];
      const acquisition = representation(task);
      const indexing = lastOf(own, 'technical.indexable');
      const snippet = lastOf(own, 'search.snippet_access');
      const attempt = task && attempts.get(task.id);
      const { state, status } = eligibilityState(
        {
          'acquisition.public_representation': acquisition.outcome,
          'search.indexability': indexing?.outcome ?? 'unknown',
          'search.crawler_access': crawler?.outcome ?? 'unknown',
          'search.snippet_access': snippet?.outcome ?? 'unknown',
        },
        task && { ...task, status_code: attempt?.status_code },
      );
      this.totals[state]++;
      this.statuses[status]++;
      if (state === 'eligible') continue;
      this.reasons.push({
        site_url_id: id,
        state,
        checkpoints: [
          {
            checkpoint_id: 'acquisition.public_representation',
            ...acquisition,
            source_task_id: task?.id ?? null,
            source_attempt_id: attempt?.id ?? null,
            source_artifact_id: task?.result_artifact_id ?? null,
          },
          checkpoint('search.crawler_access', crawler),
          checkpoint('search.snippet_access', snippet),
          checkpoint('search.indexability', indexing),
        ],
      });
    }
  }
  result() {
    return {
      search_eligibility: gate(this.totals),
      eligibility_totals: this.totals,
      eligibility_reasons: this.reasons,
      status_counts: this.statuses,
      source_task_ids: this.taskIds.toSorted(compareText),
      source_attempt_ids: this.attemptIds.toSorted(compareText),
    };
  }
}
