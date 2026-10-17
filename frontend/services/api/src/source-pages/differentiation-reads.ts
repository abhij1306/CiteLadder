/** Persisted comparisons are descriptive evidence; reads never inspect or recompute. */
import type { Database } from '../db/database.ts';
import { wireUtc, utcTextOf } from '../db/timestamps.ts';
import { sql } from 'kysely';
import type { Scope } from '../opportunities/sources.ts';
import { requireProject } from '../opportunities/reads.ts';

/** The newest reports, without the workspace, task and formula bookkeeping. */
export async function listDifferentiationReports(db: Database, scope: Scope, limit: number) {
  await requireProject(db, scope);
  const rows = await db
    .selectFrom('content_differentiation_reports')
    .select(['report', utcTextOf(sql.ref('created_at')).as('created_text')])
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(limit)
    .execute();
  return rows.map((row) => ({ report: row.report, created_at: wireUtc(row.created_text) }));
}
