import { policy } from '../config.ts';

const s = policy.opportunity.source_pages;
const OWN_PAGE_CLASSES: readonly string[] =
  policy.opportunity.earned_actions.EARNED_EXCLUDED_SOURCE_CLASSES;

type Verdict = Readonly<{ entity_kind: string; presence: string }>;

export function isListingGap(
  page: Readonly<{ source_class: string | null }>,
  verdicts: readonly Verdict[],
): boolean {
  if (OWN_PAGE_CLASSES.includes(page.source_class ?? '')) return false;
  const brand = verdicts.find((row) => row.entity_kind === s.ENTITY_KIND_BRAND);
  const competitorListed = verdicts.some(
    (row) => row.entity_kind !== s.ENTITY_KIND_BRAND && row.presence === s.PRESENCE_PRESENT,
  );
  return competitorListed && brand?.presence === s.PRESENCE_NOT_DETECTED;
}
