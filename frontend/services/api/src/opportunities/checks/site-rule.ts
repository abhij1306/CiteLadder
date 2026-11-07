/** A Site Health rule on the declared page passes in a later crawl. */
import { policy } from '../../config.ts';
import { record } from '../../db/json.ts';
import { parseUuid } from '../../http/uuid.ts';
import { ruleTitle } from '../../site-health/reads/rules.ts';
import { scalarText } from '../../text-order.ts';
import { expectedRuleOutcome, outcome } from '../verification-decisions.ts';
import type { CheckModule } from './kind.ts';
import { pageAnalysis } from './read-context.ts';

export const siteRuleCheck: CheckModule<'site_rule'> = {
  kind: 'site_rule',
  leg: policy.opportunity.actions.LEG_CRAWL,
  sources: ['site_crawl'],
  measurable: () => true,
  freeze(members) {
    return Promise.resolve(
      members.map((member) => {
        const evidence = record(member.evidence);
        const siteUrlId = parseUuid(evidence.site_url_id);
        return {
          member,
          check: {
            kind: 'site_rule' as const,
            rule_id: scalarText(evidence.issue_rule_id) || member.rule_id,
            expected_outcome: 'pass' as const,
            ...(siteUrlId ? { target_site_url_id: siteUrlId } : {}),
          },
        };
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
