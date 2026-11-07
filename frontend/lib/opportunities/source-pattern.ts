import { sourceClassSchema, type SourceClass, type SourcePattern } from '@citeladder/contracts';
import type { ClassificationValue } from '@/components/ui/badge';

/**
 * Display copy for the `source_pattern` block (`sourcePatternSchema`) the
 * backend embeds in a visibility opportunity's evidence.
 *
 * The backend owns the taxonomy and the classification; this module only maps
 * each class to display copy. It NEVER re-derives a class from a domain, and
 * the copy must stay descriptive: these are the sources observed alongside a
 * measured gap, not a cause of it.
 */

/**
 * Every class in the backend taxonomy needs a line here; the `Record` makes a
 * new class a compile error rather than a chip that silently vanishes.
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

export function recommendedActionLabel(action: string): string | null {
  return ACTION_LABELS[action] ?? null;
}

/**
 * The class chips in taxonomy order, not payload key order, so they render
 * identically whatever order the JSON keys arrive in.
 */
export function classCountChips(
  pattern: SourcePattern,
): { sourceClass: SourceClass; count: number }[] {
  return sourceClassSchema.options.flatMap((sourceClass) => {
    const count = pattern.class_counts[sourceClass];
    return count ? [{ sourceClass, count }] : [];
  });
}

/**
 * The block to show, or `null` when the answers cited nothing: "not
 * observed", which the drawer renders as nothing rather than a measured zero.
 */
export function observedSourcePattern(pattern: SourcePattern | undefined): SourcePattern | null {
  return pattern && pattern.distinct_domain_count > 0 ? pattern : null;
}
