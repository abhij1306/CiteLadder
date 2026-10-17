import type { ClassificationValue } from '@/components/ui/badge-variants';

/**
 * Reader-side projection of the `source_pattern` block the backend embeds in a
 * visibility opportunity's evidence payload.
 *
 * The backend owns the taxonomy and the classification; this module only
 * parses the persisted payload defensively (older rows predate the block) and
 * maps each class to display copy. It NEVER re-derives a class from a domain,
 * and the copy must stay descriptive: these are the sources observed alongside
 * a measured gap, not a cause of it.
 */

export type SourceClass =
  | 'brand_owned'
  | 'competitor_owned'
  | 'review_marketplace'
  | 'editorial_third_party'
  | 'community'
  | 'social'
  | 'institutional'
  | 'video'
  | 'search_surface'
  | 'other_third_party';

type SourcePatternCitation = {
  domain: string;
  url: string;
  title: string;
  sourceClass: SourceClass;
  matchedCompetitor: string | null;
};

export type SourcePattern = {
  distinctDomainCount: number;
  independentDomainCount: number;
  classCounts: ReadonlyArray<{ sourceClass: SourceClass; count: number }>;
  observedPatterns: readonly string[];
  competitorSourceDomains: ReadonlyArray<{ competitor: string; domains: readonly string[] }>;
  topCitations: readonly SourcePatternCitation[];
  topCitationsTruncated: boolean;
  recommendedAction: string | null;
  taxonomyVersion: string | null;
};

const SOURCE_CLASSES: readonly SourceClass[] = [
  'brand_owned',
  'competitor_owned',
  'review_marketplace',
  'editorial_third_party',
  'community',
  'social',
  'institutional',
  'video',
  'search_surface',
  'other_third_party',
];

/**
 * Every class in the backend taxonomy needs a line here. An unmapped one is
 * DROPPED by `sourceCategoryLabels`, so `social` and `institutional` pages were
 * simply missing from every source breakdown that consumed it — not shown raw,
 * not shown as "other", just absent.
 */
const CLASS_LABELS: Record<SourceClass, string> = {
  brand_owned: 'Your own pages',
  competitor_owned: 'Competitor-owned',
  review_marketplace: 'Review / marketplace',
  editorial_third_party: 'Editorial',
  community: 'Community',
  social: 'Social',
  institutional: 'Institutional',
  video: 'Video',
  // A search engine's own generated result page. Named plainly rather than
  // folded into "Other third-party", which is what it used to arrive as --
  // and which invited pursuing a page that has no publisher to pursue.
  search_surface: 'Search surface',
  other_third_party: 'Other third-party',
};

/**
 * Badge colour family per class. Only ownership drives colour — every
 * independent class shares the third-party token so the palette cannot be read
 * as a quality ranking between, say, a review site and a forum.
 */
const CLASS_BADGE: Record<SourceClass, ClassificationValue> = {
  brand_owned: 'owned',
  competitor_owned: 'competitor',
  review_marketplace: 'third-party',
  editorial_third_party: 'third-party',
  community: 'third-party',
  social: 'third-party',
  institutional: 'third-party',
  video: 'third-party',
  search_surface: 'third-party',
  other_third_party: 'third-party',
};

/** Deterministic next action per backend token (unknown tokens render null). */
const ACTION_LABELS: Record<string, string> = {
  strengthen_owned_answer_page: 'Strengthen or create an owned answer page for this prompt',
  pursue_independent_evidence: 'Pursue independent review, editorial, or customer evidence',
  pursue_community_evidence: 'Pursue community or video evidence where the discussion happens',
  investigate_competitor_sources: 'Review the competitor-owned pages the engines cited',
};

export function sourceClassLabel(sourceClass: SourceClass): string {
  return CLASS_LABELS[sourceClass];
}

export function sourceClassBadgeValue(sourceClass: SourceClass): ClassificationValue {
  return CLASS_BADGE[sourceClass];
}

export function recommendedActionLabel(action: string | null): string | null {
  return action ? (ACTION_LABELS[action] ?? null) : null;
}

function asSourceClass(value: unknown): SourceClass | null {
  return typeof value === 'string' && (SOURCE_CLASSES as readonly string[]).includes(value)
    ? (value as SourceClass)
    : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function parseClassCounts(value: unknown): SourcePattern['classCounts'] {
  const record = asRecord(value);
  if (!record) return [];
  // Iterate the KNOWN class order rather than the payload's key order so the
  // chips render identically regardless of JSON key ordering.
  return SOURCE_CLASSES.flatMap((sourceClass) => {
    const count = asCount(record[sourceClass]);
    return count > 0 ? [{ sourceClass, count }] : [];
  });
}

function parseCitations(value: unknown): SourcePatternCitation[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const record = asRecord(entry);
    const sourceClass = asSourceClass(record?.source_class);
    if (!record || !sourceClass) return [];
    const domain = asText(record.domain);
    if (!domain) return [];
    return [
      {
        domain,
        url: asText(record.url),
        title: asText(record.title),
        sourceClass,
        matchedCompetitor: asText(record.matched_competitor) || null,
      },
    ];
  });
}

function parseCompetitorDomains(value: unknown): SourcePattern['competitorSourceDomains'] {
  const record = asRecord(value);
  if (!record) return [];
  return Object.entries(record).flatMap(([competitor, domains]) => {
    const list = Array.isArray(domains)
      ? domains.filter((d): d is string => typeof d === 'string')
      : [];
    return list.length > 0 ? [{ competitor, domains: list }] : [];
  });
}

/**
 * Read the `source_pattern` block out of an opportunity evidence payload.
 *
 * Returns `null` when the block is absent (a row written before the taxonomy
 * shipped) or carries no citations at all — those are "not observed", which
 * the drawer must render as nothing rather than as a measured zero.
 */
export function parseSourcePattern(evidence: Record<string, unknown>): SourcePattern | null {
  const block = asRecord(evidence.source_pattern);
  if (!block) return null;
  const distinctDomainCount = asCount(block.distinct_domain_count);
  if (distinctDomainCount === 0) return null;
  return {
    distinctDomainCount,
    independentDomainCount: asCount(block.independent_domain_count),
    classCounts: parseClassCounts(block.class_counts),
    observedPatterns: Array.isArray(block.observed_patterns)
      ? block.observed_patterns.filter((p): p is string => typeof p === 'string')
      : [],
    competitorSourceDomains: parseCompetitorDomains(block.competitor_source_domains),
    topCitations: parseCitations(block.top_citations),
    topCitationsTruncated: block.top_citations_truncated === true,
    recommendedAction: asText(block.recommended_action) || null,
    taxonomyVersion: asText(block.taxonomy_version) || null,
  };
}
