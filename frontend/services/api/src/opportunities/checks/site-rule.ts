/** A Site Health rule on the declared page passes in a later crawl. */
import { siteIssueEvidenceSchema } from '@citeladder/contracts/opportunity-evidence';

import { policy } from '../../config.ts';
import { record } from '../../db/json.ts';
import { parseUuid } from '../../http/uuid.ts';
import { ruleTitle } from '../../site-health/reads/rules.ts';
import { compareText } from '../../text-order.ts';
import { expectedRuleOutcome, outcome } from '../verification-decisions.ts';
import type { CheckModule, MemberFacts } from './kind.ts';
import { pageAnalysis } from './read-context.ts';

const foldedIssues = siteIssueEvidenceSchema.pick({ issues: true });

/**
 * Every Site Health rule a page finding folds together, in rule order; empty
 * when its evidence names none, which nothing can then verify.
 */
function issueRuleIds(member: MemberFacts): string[] {
  const parsed = foldedIssues.safeParse(member.evidence);
  if (!parsed.success) return [];
  return [...new Set(parsed.data.issues.map((issue) => issue.rule_id))].sort(compareText);
}

export const siteRuleCheck: CheckModule<'site_rule'> = {
  kind: 'site_rule',
  leg: policy.opportunity.actions.LEG_CRAWL,
  sources: ['site_crawl'],
  measurable: (member) => issueRuleIds(member).length > 0,
  /** One check per folded rule: the finding verifies only when every one passes (SH-B2). */
  freeze(members) {
    return Promise.resolve(
      members.flatMap((member) => {
        const siteUrlId = parseUuid(record(member.evidence).site_url_id);
        return issueRuleIds(member).map((ruleId) => ({
          member,
          check: {
            kind: 'site_rule' as const,
            rule_id: ruleId,
            expected_outcome: 'pass' as const,
            ...(siteUrlId ? { target_site_url_id: siteUrlId } : {}),
          },
        }));
      }),
    );
  },
  async read(ctx, source, check) {
    const analysis = await pageAnalysis(ctx, source.id, check.target_site_url_id);
    if (typeof analysis === 'string') return outcome(ctx.reading, 'unavailable', analysis);
    const ids = Array.isArray(analysis.source_evaluation_ids)
      ? analysis.source_evaluation_ids.map(String)
      : [];
    const rule = ids.length
      ? await ctx.scope
          .selectFrom(ctx.db, 'site_rule_evaluations')
          .select(['id', 'outcome'])
          .where('id', 'in', ids)
          .where('rule_id', '=', check.rule_id)
          .executeTakeFirst()
      : undefined;
    if (!rule || !['satisfied', 'missing', 'partial'].includes(rule.outcome))
      return outcome(ctx.reading, 'unavailable', 'rule_not_evaluated');
    ctx.result.rule_evaluation_ids.add(rule.id);
    ctx.result.analysis_ids.add(analysis.id);
    return outcome(
      ctx.reading,
      rule.outcome === expectedRuleOutcome(check.expected_outcome) ? 'met' : 'unmet',
    );
  },
  subject: (check) => ruleTitle(check.rule_id),
};
