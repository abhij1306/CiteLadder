import { textRole } from '@/components/ui/typography';
import type { SiteHealthOverview } from '@/lib/api/types';

type Tier = { kind: string; found: number; analyzed: number };

/** Admission tiers a reader acts on; `root` and `other` say nothing about missing pages. */
const LABELS: Readonly<Record<string, string>> = {
  product: 'Product',
  comparison: 'Comparison',
  service: 'Service',
  local: 'Location',
  category: 'Category',
  pricing: 'Pricing',
  about: 'About',
  article: 'Article',
  guide: 'Guide',
  faq: 'FAQ',
  docs: 'Docs',
  contact: 'Contact',
  trust: 'Policy',
};

const count = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

function tiers(coverage: SiteHealthOverview['crawl_coverage']): Tier[] {
  const raw = coverage.evidence.value_kinds;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return [];
    const { kind, found, analyzed } = item as Record<string, unknown>;
    const tier = { kind: String(kind), found: count(found), analyzed: count(analyzed) };
    return LABELS[tier.kind] && tier.found !== null && tier.analyzed !== null ? [tier as Tier] : [];
  });
}

/**
 * Which kinds of page the crawl found and analyzed, and which it never found:
 * "no pricing page" is a different fix from "pricing found but not analyzed".
 * Absence is the crawl's, not the site's: a partial crawl may simply not have reached it.
 */
export function CoverageByKind({
  coverage,
}: Readonly<{ coverage: SiteHealthOverview['crawl_coverage'] }>) {
  const rows = tiers(coverage);
  const found = rows.filter((row) => row.found > 0);
  const missing = rows.filter((row) => row.found === 0);
  if (!found.length && !missing.length) return null;
  return (
    <p className={textRole('caption')} data-testid="coverage-by-kind">
      {found.length ? (
        <>
          Pages analyzed by type:{' '}
          {found.map((row) => `${LABELS[row.kind]} ${row.analyzed} of ${row.found}`).join(' · ')}.
        </>
      ) : null}
      {missing.length ? (
        <>
          {found.length ? ' ' : null}Not found in this crawl:{' '}
          {missing.map((row) => LABELS[row.kind]).join(', ')}.
        </>
      ) : null}
    </p>
  );
}
