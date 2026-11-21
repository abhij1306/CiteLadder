import { promptCohortSchema } from '@citeladder/contracts/project';
import { sql } from 'kysely';

import { policy } from '../config.ts';
import { surfaceKindOf } from '../config/providers.ts';
import type { Database } from '../db/database.ts';
import { timestamptz } from '../db/timestamps.ts';
import { epochMicros, toUtc, type ParsedDatetime } from '../http/datetimes.ts';
import { chunked, groupBy } from '../lists.ts';

const visibility = policy.visibility;

export type AnalysisMissing = 'not_found' | 'not_measured' | 'metrics_pending';

export class AnalysisNotFoundError extends Error {
  readonly reason: AnalysisMissing;

  constructor(message: string, reason: AnalysisMissing = 'not_found') {
    super(message);
    this.reason = reason;
  }
}

export class TrendQueryError extends Error {}

export type RunSelection = {
  workspaceId: string;
  projectId: string;
  marketId: string | null;
  auditId: string | null;
  auditIds: string[] | null;
  logicalEngine: string | null;
  cohort: string;
  fromAt: ParsedDatetime | null;
  toAt: ParsedDatetime | null;
  topicId?: string | null;
};

export function isLogicalEngine(engine: string): boolean {
  return surfaceKindOf(engine) !== null;
}

export function unknownEngine(engine: string): TrendQueryError {
  return new TrendQueryError(`Unknown logical engine: ${engine}`);
}

function requireAware(label: string, value: ParsedDatetime | null): void {
  if (value !== null && value.offsetSeconds === null) {
    throw new TrendQueryError(`'${label}' must be a timezone-aware timestamp`);
  }
}

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

export function validatePromptCohort(cohort: string): void {
  if (!promptCohortSchema.safeParse(cohort).success) validateCohort(cohort);
}

export function selectedCohorts(cohort: string): readonly string[] {
  if (cohort === visibility.all_cohort) return visibility.all_cohorts;
  return cohort === visibility.core_cohort ? visibility.organic_cohorts : [cohort];
}

export function perceptionCohorts(cohort: string): readonly string[] {
  const mapped: Readonly<Record<string, readonly string[]>> = visibility.perception_cohorts;
  return Object.hasOwn(mapped, cohort) ? mapped[cohort]! : selectedCohorts(cohort);
}

const readsMarket = (selection: Pick<RunSelection, 'auditId' | 'auditIds'>) =>
  selection.auditId === null && !selection.auditIds?.length;

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

export function evidenceScope(
  db: Database,
  selection: RunSelection,
  cohorts: readonly string[] = selectedCohorts(selection.cohort),
) {
  let query = selectedRuns(db, selection)
    .innerJoin('response_analyses as ra', 'ra.audit_id', 'audit.id')
    .innerJoin('audit_tasks as task', 'task.id', 'ra.task_id')
    .innerJoin('audit_prompt_snapshots as snapshot', 'snapshot.id', 'task.prompt_snapshot_id')
    .where('ra.workspace_id', '=', selection.workspaceId)
    .where('task.status', '=', visibility.succeeded_task_status)
    .where('ra.cohort', 'in', cohorts);
  if (selection.logicalEngine !== null) {
    query = query.where('ra.logical_engine', '=', selection.logicalEngine);
  }
  if (selection.topicId) query = query.where('snapshot.topic_id', '=', selection.topicId);
  return query;
}

export async function latestBrandRunId(
  db: Database,
  scope: { workspaceId: string; projectId: string; marketId: string | null },
): Promise<string | null> {
  const latest = await db
    .selectFrom('audits')
    .select('id')
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('audit_scope', '=', visibility.brand_audit_scope)
    .where('market_id', 'is not distinct from', scope.marketId)
    .where('status', 'in', visibility.dashboard_audit_statuses)
    .orderBy(sql`completed_at desc nulls last`)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(1)
    .executeTakeFirst();
  return latest?.id ?? null;
}

export function selectedRuns(db: Database, selection: RunSelection) {
  let query = db
    .selectFrom('audits as audit')
    .where('audit.workspace_id', '=', selection.workspaceId)
    .where('audit.project_id', '=', selection.projectId)
    .where('audit.audit_scope', '=', visibility.brand_audit_scope)
    .where('audit.status', 'in', visibility.dashboard_audit_statuses);
  if (selection.auditId !== null) query = query.where('audit.id', '=', selection.auditId);
  if (selection.auditIds?.length) query = query.where('audit.id', 'in', selection.auditIds);
  if (readsMarket(selection))
    query = query.where('audit.market_id', 'is not distinct from', selection.marketId);
  if (selection.fromAt !== null) {
    query = query.where('audit.completed_at', '>=', timestamptz(selection.fromAt));
  }
  if (selection.toAt !== null) {
    query = query.where('audit.completed_at', '<=', timestamptz(selection.toAt));
  }
  return query;
}

export const observedAt = sql`coalesce(audit.completed_at, audit.created_at)`;

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
