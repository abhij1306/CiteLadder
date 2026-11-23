import { policy } from '../config.ts';

const s = policy.opportunity.source_pages;
const earned = policy.opportunity.earned_actions;
const OWN_PAGE_CLASSES: readonly string[] = earned.EARNED_EXCLUDED_SOURCE_CLASSES;
const SITE_SUFFIX = new RegExp(earned.EARNED_TITLE_SITE_SUFFIX, 'u');

type Verdict = Readonly<{ entity_kind: string; entity_name: string; presence: string }>;
type ListingPage = Readonly<{
  source_class: string | null;
  registrable_domain: string;
  title: string;
}>;

function isExcludedEarnedDomain(domain: string): boolean {
  return earned.EARNED_EXCLUDED_DOMAINS.some(
    (excluded) => domain === excluded || domain.endsWith(`.${excluded}`),
  );
}

function titleSubject(title: string): string {
  return title.replace(SITE_SUFFIX, '').trim().toLocaleLowerCase('en');
}

export function isListingGap(page: ListingPage, verdicts: readonly Verdict[]): boolean {
  if (OWN_PAGE_CLASSES.includes(page.source_class ?? '')) return false;
  if (isExcludedEarnedDomain(page.registrable_domain)) return false;
  const brand = verdicts.find((row) => row.entity_kind === s.ENTITY_KIND_BRAND);
  const competitors = verdicts.filter(
    (row) => row.entity_kind !== s.ENTITY_KIND_BRAND && row.presence === s.PRESENCE_PRESENT,
  );
  const subject = titleSubject(page.title);
  if (competitors.some((row) => row.entity_name.trim().toLocaleLowerCase('en') === subject))
    return false;
  return competitors.length > 0 && brand?.presence === s.PRESENCE_NOT_DETECTED;
}
