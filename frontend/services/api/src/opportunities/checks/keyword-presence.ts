/**
 * A keyword gap is measured by appearing for the search, not by clicks: a
 * query with no Search Console row has no baseline to compare a rate with.
 */
import { keywordGapEvidenceSchema } from '@citeladder/contracts/opportunities';
import { policy } from '../../config.ts';
import { keywordDatasetOutcome, keywordTrafficOutcome } from '../keyword-verification.ts';
import type { CheckModule, CheckOf, MemberFacts } from './kind.ts';

/** Evidence that does not parse cannot name the search or site to check: no check. */
function checkOf(member: MemberFacts): CheckOf<'keyword_presence'> | null {
  const parsed = keywordGapEvidenceSchema.safeParse(member.evidence);
  if (!parsed.success) return null;
  const { keyword, query_key, owned_origin, market } = parsed.data;
  return { kind: 'keyword_presence', keyword, query_key, owned_origin, ...market };
}

export const keywordPresenceCheck: CheckModule<'keyword_presence'> = {
  kind: 'keyword_presence',
  // A later paid analysis may also read it, but the scheduled reading is Search Console.
  leg: policy.opportunity.actions.LEG_SEARCH_CONSOLE_WINDOW,
  sources: ['traffic_snapshot', 'search_intelligence_dataset'],
  measurable: (member) => checkOf(member) !== null,
  freeze(members) {
    return Promise.resolve(
      members.flatMap((member) => {
        const check = checkOf(member);
        return check ? [{ member, check }] : [];
      }),
    );
  },
  read: (ctx, source, check) =>
    source.kind === 'traffic_snapshot'
      ? keywordTrafficOutcome(ctx, source.id, check)
      : keywordDatasetOutcome(ctx, source.id, check),
  subject: (check) => check.keyword || null,
};
