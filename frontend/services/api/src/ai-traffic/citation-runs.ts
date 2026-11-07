/**
 * The runs whose owned citations AI Traffic reports over a window: each audit
 * scope's newest `completed` run created inside it, with the metric snapshot
 * its finalization wrote. Overview, Pages and the URL detail all select runs
 * this way and read the snapshot's persisted citation facts; none of them
 * counts citation rows. A run without a snapshot has no fact (`not computed`),
 * which is not zero.
 */
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
    .where('a.status', '=', 'completed')
    .where('a.created_at', '>=', bounds.from)
    .where('a.created_at', '<', bounds.to)
    .orderBy('a.audit_scope')
    .orderBy('a.created_at', 'desc')
    .orderBy('a.id', 'desc');
}

/** Whether the window's runs have persisted citation facts to read. */
export type CitationCoverage = 'no_completed_run' | 'not_computed' | 'measured';

export function citationCoverage(
  runs: readonly { owned_citation_count: number | null; analyzer_version: string | null }[],
): CitationCoverage {
  if (!runs.length) return 'no_completed_run';
  return runs.some((run) => run.owned_citation_count === null || run.analyzer_version === null)
    ? 'not_computed'
    : 'measured';
}
