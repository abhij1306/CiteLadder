import { internalLinkAnalysisSchema, internalLinkSchema } from '@citeladder/contracts/site-health';

import type { Database } from '../db/database.ts';
import { record } from '../db/json.ts';
import { ApiError } from '../errors.ts';
import { latestLinkCrawl } from '../site-health/internal-link-runs.ts';
import type { MemberCheck } from './declaration-checks.ts';
import type { OpportunityRow } from './projection.ts';
import type { Scope } from './sources.ts';

/** Freeze exactly the selected, still-current suggestions as expected checks. */
export async function internalLinkDeclarationChecks(
  db: Database,
  scope: Scope,
  members: OpportunityRow[],
  ids: string[],
): Promise<MemberCheck[]> {
  const selected = new Set(ids);
  if (!selected.size || selected.size !== ids.length)
    throw new ApiError(409, 'Select the internal links you implemented');
  const crawl = await latestLinkCrawl(db, scope);
  const checks: MemberCheck[] = [];
  for (const member of members) {
    const evidence = record(member.evidence);
    const run = await db
      .selectFrom('site_internal_link_runs')
      .select(['id', 'crawl_id', 'result'])
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .where('id', '=', String(evidence.internal_link_run_id))
      .where('state', 'in', ['completed', 'partial'])
      .executeTakeFirst();
    if (!run || run.crawl_id !== crawl?.id) continue;
    const result = internalLinkAnalysisSchema.parse(run.result);
    const eligible = internalLinkSchema.array().parse(evidence.recommendations);
    for (const link of eligible) {
      if (!selected.has(link.id) || !result.recommendations.some((row) => row.id === link.id))
        continue;
      checks.push({
        member,
        check: {
          kind: 'contextual_link',
          recommendation_id: link.id,
          internal_link_run_id: run.id,
          target_site_url_id: link.source.site_url_id,
          target_url: link.target.url,
          anchor_text: link.anchor,
          source_analysis_id: link.source.analysis_id,
          source_artifact_id: link.source.artifact_id,
          target_analysis_id: link.target.analysis_id,
          target_artifact_id: link.target.artifact_id,
          extractor_version: link.source.extractor_version,
        },
      });
    }
  }
  if (checks.length !== selected.size)
    throw new ApiError(409, 'Selected links are unavailable or belong to another Action');
  return checks;
}
