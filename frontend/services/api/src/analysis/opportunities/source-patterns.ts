import { policy } from '../../config.ts';
import { domainMatches, normalizeDomain } from '../domains.ts';
import type { CitationEvidence } from './evidence.ts';
import { compareText } from '../../text-order.ts';
const p = policy.opportunity.source_patterns;
/**
 * True when `google` is the registrable label: only a public suffix follows
 * it. Not a prefix
 * test, so `google.evil.com` is an ordinary publisher.
 */
function isGoogleSearchSurface(domain: string): boolean {
  const [first, secondLevel, ...rest] = domain.split('.');
  if (first !== 'google' || secondLevel === undefined) return false;
  return (
    rest.length === 0 || (rest.length === 1 && p._PUBLIC_SECOND_LEVEL_LABELS.includes(secondLevel))
  );
}
export function classifySourceOrigin(domain: string): string {
  const normalized = domain
    .trim()
    .toLowerCase()
    .replace(/^www\./u, '');
  return isGoogleSearchSurface(normalized) || p.GOOGLE_OWNED_PLATFORM_DOMAINS.includes(normalized)
    ? p.SOURCE_ORIGIN_GOOGLE_OWNED
    : p.SOURCE_ORIGIN_EXTERNAL;
}
/** `SOURCE_CLASS_ORDER.index`, which raises for a class outside the taxonomy. */
function classRank(kind: string): number {
  const rank = p.SOURCE_CLASS_ORDER.indexOf(kind);
  if (rank < 0) throw new Error(`${kind} is not in SOURCE_CLASS_ORDER`);
  return rank;
}
export function classifySourceDomain(
  domain: string,
  owned: boolean,
  competitor: string | null,
): string {
  if (owned) return p.SOURCE_CLASS_BRAND_OWNED;
  if (competitor) return p.SOURCE_CLASS_COMPETITOR_OWNED;
  const normalized = normalizeDomain(domain);
  if (isGoogleSearchSurface(normalized)) return p.SOURCE_CLASS_SEARCH_SURFACE;
  for (const [kind, domains] of p.SOURCE_CLASS_DOMAIN_TABLES as [string, string[]][]) {
    if (domains.some((d) => domainMatches(normalized, d))) return kind;
  }
  return p.SOURCE_CLASS_OTHER_THIRD_PARTY;
}
export function byDomain(citations: CitationEvidence[]): Map<string, [string, CitationEvidence]> {
  const found = new Map<string, [string, CitationEvidence]>();
  for (const citation of citations) {
    const domain = normalizeDomain(citation.domain) || normalizeDomain(citation.url);
    if (domain && !found.has(domain))
      found.set(domain, [
        classifySourceDomain(domain, citation.is_owned, citation.matched_competitor),
        citation,
      ]);
  }
  return found;
}
export function summarizeSourcePattern(citations: CitationEvidence[]) {
  const domains = byDomain(citations);
  const counts = new Map<string, number>();
  const competitors = new Map<string, string[]>();
  const independent = new Set<string>();
  const independentClasses = new Set<string>([
    p.SOURCE_CLASS_REVIEW_MARKETPLACE,
    p.SOURCE_CLASS_EDITORIAL_THIRD_PARTY,
    p.SOURCE_CLASS_COMMUNITY,
    p.SOURCE_CLASS_SOCIAL,
    p.SOURCE_CLASS_INSTITUTIONAL,
    p.SOURCE_CLASS_VIDEO,
    p.SOURCE_CLASS_OTHER_THIRD_PARTY,
  ]);
  for (const [domain, [kind, citation]] of domains) {
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
    if (independentClasses.has(kind)) independent.add(domain);
    if (citation.matched_competitor) {
      const list = competitors.get(citation.matched_competitor) ?? [];
      list.push(domain);
      competitors.set(citation.matched_competitor, list);
    }
  }
  const patterns: string[] = [];
  if (counts.has(p.SOURCE_CLASS_COMPETITOR_OWNED))
    patterns.push(p.PATTERN_COMPETITOR_OWNED_SOURCES);
  if (
    counts.has(p.SOURCE_CLASS_REVIEW_MARKETPLACE) ||
    counts.has(p.SOURCE_CLASS_EDITORIAL_THIRD_PARTY)
  )
    patterns.push(p.PATTERN_INDEPENDENT_VALIDATION);
  if (counts.has(p.SOURCE_CLASS_COMMUNITY)) patterns.push(p.PATTERN_COMMUNITY_EVIDENCE);
  if (counts.has(p.SOURCE_CLASS_VIDEO)) patterns.push(p.PATTERN_VIDEO_EVIDENCE);
  if (independent.size >= p.MULTIPLE_INDEPENDENT_DOMAIN_MIN)
    patterns.push(p.PATTERN_MULTIPLE_INDEPENDENT_DOMAINS);
  const ordered = [...domains].sort(
    ([a, [ak]], [b, [bk]]) => classRank(ak) - classRank(bk) || compareText(a, b),
  );
  return {
    taxonomy_version: p.SOURCE_TAXONOMY_VERSION,
    distinct_domain_count: domains.size,
    independent_domain_count: independent.size,
    class_counts: Object.fromEntries(
      p.SOURCE_CLASS_ORDER.filter((k) => counts.has(k)).map((k) => [k, counts.get(k)]),
    ),
    observed_patterns: patterns,
    competitor_source_domains: Object.fromEntries(
      [...competitors]
        .sort(([a], [b]) => compareText(a, b))
        .map(([name, list]) => [name, list.toSorted(compareText)]),
    ),
    top_citations: ordered.slice(0, p.MAX_TOP_CITATIONS).map(([domain, [source_class, c]]) => ({
      domain,
      url: c.url,
      title: c.title,
      source_class,
      matched_competitor: c.matched_competitor,
    })),
    top_citations_truncated: ordered.length > p.MAX_TOP_CITATIONS,
    recommended_action:
      p.PATTERN_TO_ACTION.find(([pattern]) => patterns.includes(pattern!))?.[1] ?? p.ACTION_DEFAULT,
  };
}
