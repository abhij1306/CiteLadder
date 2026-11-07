/**
 * A selected contextual-link suggestion appears in the source page's main
 * content in a later complete capture.
 */
import { internalLinkAnalysisSchema, internalLinkSchema } from '@citeladder/contracts/site-health';
import { policy } from '../../config.ts';
import { record } from '../../db/json.ts';
import { ApiError } from '../../errors.ts';
import { latestLinkCrawl } from '../../site-health/internal-link-runs.ts';
import { linkUrl } from '../../site-health/internal-link-pages.ts';
import { outcome } from '../verification-decisions.ts';
import type { CheckModule, CheckOf, MemberCheck } from './kind.ts';
import { pageAnalysis } from './read-context.ts';

const NAVIGATION_REGIONS = new Set(['nav', 'header', 'footer', 'aside']);

/**
 * A later complete capture verifies an observed main-content link, never a
 * model score. The anchor was a suggestion the editor may reword, so any
 * main-content link to the destination satisfies the check.
 */
export function contextualLinkObserved(
  rawFacts: unknown,
  check: Pick<CheckOf<'contextual_link'>, 'extractor_version' | 'target_url'>,
): boolean | null {
  const facts = record(rawFacts);
  const capture = record(facts.extraction);
  const links = record(facts.links);
  if (
    capture.state !== 'available' ||
    capture.truncated ||
    facts.extractor_version !== check.extractor_version ||
    links.anchors_truncated === true
  )
    return null;
  const base = record(facts.delivery).final_url;
  if (!Array.isArray(links.anchors) || typeof base !== 'string') return null;
  const matching = links.anchors
    .map(record)
    .filter(
      (anchor) => typeof anchor.url === 'string' && linkUrl(anchor.url, base) === check.target_url,
    );
  if (matching.some((anchor) => anchor.region === 'main')) return true;
  // An unclassified region might be the article body: no confident "missing".
  if (matching.some((anchor) => !NAVIGATION_REGIONS.has(String(anchor.region)))) return null;
  return false;
}

export const contextualLinkCheck: CheckModule<'contextual_link'> = {
  kind: 'contextual_link',
  leg: policy.opportunity.actions.LEG_CRAWL,
  sources: ['site_crawl'],
  measurable: () => true,
  /**
   * Freeze exactly the selected, still-current suggestions. The page's other
   * findings keep their own checks in the same declaration.
   */
  async freeze(members, { db, scope, recommendationIds }) {
    if (!members.length && !recommendationIds.length) return [];
    const selected = new Set(recommendationIds);
    if (!selected.size || selected.size !== recommendationIds.length)
      throw new ApiError(409, 'Select the internal links you implemented');
    const crawl = await latestLinkCrawl(db, scope);
    const checks: MemberCheck[] = [];
    for (const member of members) {
      const evidence = record(member.evidence);
      const run = await db // NOSONAR -- One transaction connection.
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
  },
  async read(ctx, source, check) {
    const analysis = await pageAnalysis(ctx, source.id, check.target_site_url_id);
    if (typeof analysis === 'string') return outcome(ctx.reading, 'unavailable', analysis);
    const observed = contextualLinkObserved(analysis.normalized_facts, check);
    if (observed === null) return outcome(ctx.reading, 'unavailable', 'link_capture_incomplete');
    ctx.result.analysis_ids.add(analysis.id);
    return outcome(ctx.reading, observed ? 'met' : 'unmet');
  },
  subject: (check) => check.target_url || null,
};
