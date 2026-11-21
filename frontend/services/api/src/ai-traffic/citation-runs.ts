import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import type { windowBounds } from '../crawl-logs/reads.ts';
import type { CrawlScope } from '../crawl-logs/state.ts';

export function citationRuns(
  db: Database,
  scope: CrawlScope,
  bounds: ReturnType<typeof windowBounds>,
) {
  return db
    .selectFrom('audits as a')
    .leftJoin('metric_snapshots as m', (join) =>
      join
        .onRef('m.audit_id', '=', 'a.id')
        .onRef('m.workspace_id', '=', 'a.workspace_id')
        .onRef('m.project_id', '=', 'a.project_id'),
    )
    .select(['a.id as audit_id', 'a.created_at', 'm.owned_citation_count', 'm.analyzer_version'])
    .distinctOn('a.audit_scope')
    .where('a.workspace_id', '=', scope.workspaceId)
    .where('a.project_id', '=', scope.projectId)
    .where('a.audit_scope', '<>', policy.probes.audit_scope)
    .where('a.status', '=', 'completed')
    .where('a.created_at', '>=', bounds.from)
    .where('a.created_at', '<', bounds.to)
    .orderBy('a.audit_scope')
    .orderBy('a.created_at', 'desc')
    .orderBy('a.id', 'desc');
}

export type CitationCoverage = 'no_completed_run' | 'not_computed' | 'measured';

export function citationCoverage(
  runs: readonly { owned_citation_count: number | null; analyzer_version: string | null }[],
): CitationCoverage {
  if (!runs.length) return 'no_completed_run';
  return runs.some((run) => run.owned_citation_count === null || run.analyzer_version === null)
    ? 'not_computed'
    : 'measured';
}
