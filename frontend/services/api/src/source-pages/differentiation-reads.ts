/** Persisted comparisons are descriptive evidence; reads never inspect or recompute. */
import type { Database } from '../db/database.ts';
import { wireUtc, utcTextOf } from '../db/timestamps.ts';
import { sql } from 'kysely';
import type { Scope } from '../opportunities/sources.ts';
import { requireProject } from '../projects/access.ts';

/**
 * Each task's newest report, newest first, without the workspace, task and
 * formula bookkeeping. Reports are insert-only; earlier ones stay as history.
 */
export async function listDifferentiationReports(db: Database, scope: Scope, limit: number) {
  await requireProject(db, scope);
  const latest = db
    .selectFrom('content_differentiation_reports')
    .distinctOn('audit_task_id')
    .select(['id', 'report', 'created_at'])
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .orderBy('audit_task_id')
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .as('latest');
  const rows = await db
    .selectFrom(latest)
    .select(['report', utcTextOf(sql.ref('created_at')).as('created_text')])
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(limit)
    .execute();
  return rows.map((row) => ({ report: row.report, created_at: wireUtc(row.created_text) }));
}
