/**
 * The one definition of a listing gap (AS4): on a page's latest successful
 * reading, a competitor is present and the brand is confirmed absent, and the
 * page belongs to neither the business nor a competitor. The URLs table's Gap
 * standing and filter (`visibility/page-standing.ts`) and the
 * `earned_page_acquire_listing` detector both read it, so every Gap page is an
 * Action once its evidence refreshes.
 */
import { policy } from '../config.ts';

const s = policy.opportunity.source_pages;
const OWN_PAGE_CLASSES: readonly string[] =
  policy.opportunity.earned_actions.EARNED_EXCLUDED_SOURCE_CLASSES;

type Verdict = Readonly<{ entity_kind: string; presence: string }>;

/** Whether one reading's verdicts show a gap; the caller passes the latest successful reading's. */
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
