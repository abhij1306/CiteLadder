import { internalLinkAnalysisSchema } from '@citeladder/contracts/site-health';

import { policy } from '../config.ts';
import type { DetectorHit } from '../analysis/opportunities/evidence.ts';
import type { Database } from '../db/database.ts';
import { record } from '../db/json.ts';
import { groupBy } from '../lists.ts';
import type { Scope } from './sources.ts';

/** The crawl's newest finished internal-link run with a result, if any. */
export async function internalLinkRunId(db: Database, scope: Scope, crawlId: string) {
  const run = await db
    .selectFrom('site_internal_link_runs')
    .select('id')
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('crawl_id', '=', crawlId)
    .where('state', 'in', ['completed', 'partial'])
    .where('result', 'is not', null)
    .orderBy('created_at', 'desc')
    .executeTakeFirst();
  return run?.id ?? null;
}

/** One page Action per source page, holding every suggested link from it. */
export async function internalLinkHits(
  db: Database,
  scope: Scope,
  runId: string | null,
): Promise<DetectorHit[]> {
  if (runId === null) return [];
  const run = await db
    .selectFrom('site_internal_link_runs')
    .select(['id', 'result', 'manifest'])
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('id', '=', runId)
    .executeTakeFirstOrThrow();
  const result = internalLinkAnalysisSchema.parse(run.result);
  // The bar the run's links were judged against, frozen with the run.
  const threshold = Number(record(record(run.manifest).policy).accept_threshold);
  if (Number.isNaN(threshold) || threshold <= 0)
    throw new Error('Internal link run has no frozen accept_threshold');
  const sources = groupBy(result.recommendations, (link) => link.source.site_url_id);
  return [...sources].map(([id, links]) => {
    const source = links[0].source;
    return {
      rule_id: 'site_contextual_links',
      target_key: `internal-links:${id}`,
      target_prompt_id: null,
      target_url: source.url,
      target_theme: null,
      evidence: {
        site_url_id: id,
        crawl_id: result.crawl_id,
        internal_link_run_id: run.id,
        recommendations: links,
        content_handoff: { source_url: source.url, recommendations: links },
      },
      source_analysis_ids: [
        ...new Set(links.flatMap((link) => [link.source.analysis_id, link.target.analysis_id])),
      ],
      source_issue_ids: [],
      source_metric_ids: [run.id],
      // How far the strongest suggested link clears the acceptance bar: a clear
      // editorial win ranks above a borderline one instead of every page tying.
      value_factor: Math.max(...links.map((link) => link.usefulness)) / threshold,
      gap_factor: policy.opportunity.opportunities.SITE_GAP_FACTOR,
    };
  });
}
