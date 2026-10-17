/**
 * The measurement selection every persisted visibility reader is scoped by.
 *
 * Ports `RunSelection`, `authorize_run_set`, `validate_engine_and_range` and
 * the evidence base scope (`_evidence_statement`) from
 * `app/domain/analysis`. A selected run outside the project is not found,
 * never an empty answer; an answer whose task did not succeed is not
 * evidence of anything, so it is excluded from the base scope itself.
 */
import { sql } from 'kysely';

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { timestamptz } from '../db/timestamps.ts';
import { epochMicros, toUtc, type ParsedDatetime } from '../http/datetimes.ts';
import { chunked, groupBy } from '../lists.ts';

const visibility = policy.visibility;

/** A selection that cannot be served: the route answers 404. */
export class AnalysisNotFoundError extends Error {}

/** A selection that is malformed: the route answers 422 with this message. */
export class TrendQueryError extends Error {}

export type RunSelection = {
  workspaceId: string;
  projectId: string;
  /** The measurement market; `null` is the project default. Named runs imply their own. */
  marketId: string | null;
  auditId: string | null;
  auditIds: string[] | null;
  logicalEngine: string | null;
  cohort: string;
  fromAt: ParsedDatetime | null;
  toAt: ParsedDatetime | null;
};

export function isLogicalEngine(engine: string): boolean {
  return visibility.logical_engines.includes(engine);
}

export function unknownEngine(engine: string): TrendQueryError {
  return new TrendQueryError(`Unknown logical engine: ${engine}`);
}

function requireAware(label: string, value: ParsedDatetime | null): void {
  if (value !== null && value.offsetSeconds === null) {
    throw new TrendQueryError(`'${label}' must be a timezone-aware timestamp`);
  }
}

/** A known engine and an aware, ordered window, or a 422. */
export function validateEngineAndRange(
  selection: Pick<RunSelection, 'logicalEngine' | 'fromAt' | 'toAt'>,
): void {
  if (selection.logicalEngine !== null && !isLogicalEngine(selection.logicalEngine)) {
    throw unknownEngine(selection.logicalEngine);
  }
  requireAware('from', selection.fromAt);
  requireAware('to', selection.toAt);
  if (
    selection.fromAt !== null &&
    selection.toAt !== null &&
    epochMicros(selection.fromAt) > epochMicros(selection.toAt)
  ) {
    throw new TrendQueryError("'from' must not be after 'to'");
  }
}

export function validateCohort(cohort: string): void {
  if (!visibility.requestable_cohorts.includes(cohort)) {
    throw new TrendQueryError(`Unknown prompt cohort: ${cohort}`);
  }
}

/**
 * The cohorts a selection reads: core is every organic cohort, and "all" is
 * the unbranded and branded prompts together.
 */
export function selectedCohorts(cohort: string): readonly string[] {
  if (cohort === visibility.all_cohort) return visibility.all_cohorts;
  return cohort === visibility.core_cohort ? visibility.organic_cohorts : [cohort];
}

/** Without named runs a selection reads its market; named runs bring their own. */
export const readsMarket = (selection: Pick<RunSelection, 'auditId' | 'auditIds'>) =>
  selection.auditId === null && !selection.auditIds?.length;

/**
 * Every run in `auditIds` belongs to the project, is dashboard-ready and
 * measured one market, or throw: markets never pool.
 */
export async function authorizeRunSet(
  db: Database,
  scope: { workspaceId: string; projectId: string },
  auditIds: readonly string[] | null,
): Promise<void> {
  const ids = new Set(auditIds ?? []);
  if (ids.size === 0) return;
  if (ids.size > visibility.selection_max_runs) {
    throw new TrendQueryError('Too many runs in this selection');
  }
  const owned = await db
    .selectFrom('audits')
    .select(['id', 'market_id'])
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('id', 'in', [...ids])
    .where('status', 'in', visibility.dashboard_audit_statuses)
    .where('audit_scope', '=', visibility.brand_audit_scope)
    .execute();
  if (owned.length !== ids.size) throw new AnalysisNotFoundError('Selected run set not found');
  if (new Set(owned.map((run) => run.market_id)).size > 1)
    throw new TrendQueryError('Selected runs measured different markets');
}

/**
 * Validate the request, normalize its window to UTC and authorize its runs:
 * `_authorized_selection` at the default evidence limit, which always passes
 * the limit bound.
 */
export async function authorizedSelection(
  db: Database,
  selection: RunSelection,
): Promise<RunSelection> {
  validateEngineAndRange(selection);
  validateCohort(selection.cohort);
  const normalized = {
    ...selection,
    fromAt: selection.fromAt && toUtc(selection.fromAt),
    toAt: selection.toAt && toUtc(selection.toAt),
  };
  if (normalized.auditId !== null) {
    const owning = await db
      .selectFrom('audits')
      .select('id')
      .where('id', '=', normalized.auditId)
      .where('workspace_id', '=', normalized.workspaceId)
      .where('project_id', '=', normalized.projectId)
      .executeTakeFirst();
    if (owning === undefined) throw new AnalysisNotFoundError('Audit not found');
  }
  await authorizeRunSet(db, normalized, normalized.auditIds);
  return normalized;
}

/**
 * The evidence base scope: successful answers of the project's dashboard-ready
 * runs, filtered by the selection. Every reader narrows or groups this one
 * statement, so they agree on what "the selection" contains.
 */
export function evidenceScope(db: Database, selection: RunSelection) {
  const cohorts = selectedCohorts(selection.cohort);
  let query = db
    .selectFrom('response_analyses as ra')
    .innerJoin('audit_tasks as task', 'task.id', 'ra.task_id')
    .innerJoin('audits as audit', 'audit.id', 'ra.audit_id')
    .innerJoin('audit_prompt_snapshots as snapshot', 'snapshot.id', 'task.prompt_snapshot_id')
    .where('ra.workspace_id', '=', selection.workspaceId)
    .where('audit.workspace_id', '=', selection.workspaceId)
    .where('audit.project_id', '=', selection.projectId)
    .where('audit.status', 'in', visibility.dashboard_audit_statuses)
    .where('task.status', '=', visibility.succeeded_task_status)
    .where('ra.cohort', 'in', cohorts);
  if (selection.auditId !== null) query = query.where('ra.audit_id', '=', selection.auditId);
  if (selection.auditIds?.length) query = query.where('ra.audit_id', 'in', selection.auditIds);
  if (readsMarket(selection))
    query = query.where('audit.market_id', 'is not distinct from', selection.marketId);
  if (selection.logicalEngine !== null) {
    query = query.where('ra.logical_engine', '=', selection.logicalEngine);
  }
  if (selection.fromAt !== null) {
    query = query.where('audit.completed_at', '>=', timestamptz(selection.fromAt));
  }
  if (selection.toAt !== null) {
    query = query.where('audit.completed_at', '<=', timestamptz(selection.toAt));
  }
  return query;
}

/** `coalesce(audit.completed_at, audit.created_at)`: when the run was observed. */
export const observedAt = sql`coalesce(audit.completed_at, audit.created_at)`;

/** Each analysis's citations in answer order, for readers that report cited domains. */
export async function citationsByAnalysis(
  db: Database,
  workspaceId: string,
  analysisIds: readonly string[],
): Promise<Map<string, { domain: string; url: string }[]>> {
  const found = await chunked([...analysisIds], (chunk) =>
    db
      .selectFrom('citations')
      .select(['analysis_id', 'domain', 'url'])
      .where('workspace_id', '=', workspaceId)
      .where('analysis_id', 'in', chunk)
      .orderBy('ordinal')
      .execute(),
  );
  return groupBy(found, (citation) => citation.analysis_id);
}
