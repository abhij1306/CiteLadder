/**
 * Site Health page-kind vocabulary + presentation helpers (v2 P1) — PURE.
 *
 * The SINGLE shared mapping from the backend `page_kind` classification
 * vocabulary to humanized labels — every badge, filter control, and the
 * dashboard per-type breakdown reads it from here (no duplicated maps).
 * No transport, no React.
 */
import { pageKindSchema } from '@citeladder/contracts/site-health';
import type { PageKind, PageKindScoreSummary } from '@/lib/api/types';
import { ownValue, titleCaseStatus } from '@/lib/utils';

/**
 * Every page type in stable display order (filter control + breakdown
 * table). Derived from the API-contract zod enum (the same derivation as
 * `lib/prompts/forms.ts` `intentValues`) so the vocabulary has exactly one
 * frontend owner.
 */
export const PAGE_KINDS: readonly PageKind[] = pageKindSchema.options;

/** Humanized label per page type — the one shared mapping. */
const PAGE_KIND_LABELS: Record<PageKind, string> = {
  homepage: 'Homepage',
  article: 'Article',
  editorial_index: 'Editorial index',
  product: 'Product',
  category: 'Category',
  pricing: 'Pricing',
  docs: 'Docs',
  faq: 'FAQ',
  about_contact: 'About / Contact',
  service: 'Service',
  local: 'Local',
  guide: 'Guide',
  how_to: 'How-to',
  listicle: 'Listicle',
  comparison: 'Comparison',
  alternative: 'Alternative',
  case_study_review: 'Case Study / Review',
  trust_policy: 'Trust / Policy',
  other: 'Other',
};

/**
 * Display label for a page type. An unknown value (a vocabulary the frontend
 * has not caught up with) falls back to title-casing instead of rendering
 * blank — the same defensive fallback `issueTitle` applies to blank titles.
 */
export function pageKindLabel(pageKind: string): string {
  return PAGE_KIND_LABELS[pageKind as PageKind] ?? titleCaseStatus(pageKind);
}

/** One display row of the dashboard per-page-kind score breakdown. */
export type PageKindScoreRow = PageKindScoreSummary & { page_kind: string };

/**
 * Order a `score_summary.by_page_kind` map for display: the `PAGE_KINDS`
 * order first, then any unknown types alphabetically — stable and
 * deterministic, never dependent on the API's map insertion order.
 */
export function byPageKindRows(
  byPageKind: Record<string, PageKindScoreSummary>,
): PageKindScoreRow[] {
  const rank = new Map<string, number>(PAGE_KINDS.map((type, index) => [type, index]));
  return Object.entries(byPageKind)
    .map(([page_kind, scores]) => ({ page_kind, ...scores }))
    .sort((a, b) => {
      const aRank = rank.get(a.page_kind) ?? PAGE_KINDS.length;
      const bRank = rank.get(b.page_kind) ?? PAGE_KINDS.length;
      return aRank === bRank ? a.page_kind.localeCompare(b.page_kind) : aRank - bRank;
    });
}

/**
 * Display wording for the classifier's confidence label. The classifier
 * reports how strong the deciding evidence was, not a score, so the UI names
 * the evidence rather than printing a number that looks calibrated.
 */
const CONFIDENCE_LABELS: Readonly<Record<string, string>> = {
  high: 'High — page structure',
  medium: 'Medium — URL pattern',
  low: 'Low — semantic evidence',
  unknown: 'Unclassified',
};

/**
 * Display wording for an observed page trait.
 *
 * A trait says what else is on a page, independent of what the page is for,
 * so the copy reads as an observation ("Has an FAQ") rather than a
 * classification. An unknown trait falls back to its own token: a backend that
 * ships a new observation should surface it, not hide it.
 */
const PAGE_TRAIT_LABELS: Readonly<Record<string, string>> = {
  has_faq: 'Has an FAQ',
  has_reviews: 'Has reviews',
  has_variants: 'Has variants',
  listing: 'Lists items',
  local_intent: 'Local business details',
  contact_intent: 'Contact details',
  about_intent: 'About the organization',
  company_profile_intent: 'Canonical company profile',
  case_study_intent: 'Case study',
  comparison_content: 'Comparison',
  procedural: 'Step by step',
};

export function pageTraitLabel(trait: string): string {
  // Own properties only: an inherited value is a function or the prototype,
  // and React throws when asked to render one as a child.
  return ownValue(PAGE_TRAIT_LABELS, trait) ?? trait;
}

export function pageKindConfidenceLabel(confidence: string, tier: string): string {
  if (confidence === 'medium' && tier === 'structural') {
    return 'Medium — mixed evidence';
  }
  return CONFIDENCE_LABELS[confidence] ?? confidence;
}

/**
 * One ranked matched-signal entry of the persisted classifier evidence —
 * `{ signal, page_kind, tier, detail }` as the backend
 * `PageKindAssessment.to_evidence()` emits it (detail already truncated
 * server-side).
 */
type PageKindEvidenceSignal = {
  signal: string;
  pageKind: string;
  /** Evidence tier the signal belongs to: structural, route or semantic. */
  tier: string;
  detail: string;
};

/**
 * The parsed, display-ready classifier evidence for one analyzed page (the
 * per-URL detail "why this type?" disclosure payload).
 */
export type PageKindEvidenceView = {
  classifierVersion: string;
  /** Name of the winning signal (`none` when nothing matched). */
  classifiedBy: string;
  /** What the structured-data signal alone would have suggested. */
  schemaSuggestedType: string | null;
  /**
   * A label — `high`, `medium`, `low` or `unknown` — not a score. The
   * classifier reports the tier of the evidence that decided the type; a
   * decimal here invited readers to treat it as a calibrated probability.
   */
  confidence: string;
  /** The deciding evidence tier (empty when the page stayed unclassified). */
  tier: string;
  signals: PageKindEvidenceSignal[];
  /**
   * True when the schema-suggested type disagrees with the page's final
   * type — the disclosure highlights the conflict (signals 1–3 outrank the
   * schema claim by design).
   */
  schemaConflict: boolean;
  /**
   * Non-winning candidate kinds and the tier that proposed them. Dropping
   * these hid the runner-up entirely, so a near-tie looked identical to a
   * decisive classification.
   */
  alternatives: PageKindEvidenceCandidate[];
  /** Signals that disagreed with the winner (the "why not X?" evidence). */
  conflicts: PageKindEvidenceConflict[];
  /**
   * Why the page fell back to `other`. Null when a kind was chosen.
   */
  otherReason: string | null;
};

/** One non-winning candidate kind. */
type PageKindEvidenceCandidate = {
  pageKind: string;
  tier: string;
  signals: string[];
};

/** One signal that disagreed with the winning kind. */
type PageKindEvidenceConflict = {
  winnerPageKind: string;
  conflictingPageKind: string;
  signal: string;
  detail: string;
};

/** Bounded, shape-checked parse of the `alternatives` array. */
function readAlternatives(value: unknown): PageKindEvidenceCandidate[] {
  if (!Array.isArray(value)) return [];
  const out: PageKindEvidenceCandidate[] = [];
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue;
    const entry = raw as Record<string, unknown>;
    if (typeof entry.page_kind !== 'string' || typeof entry.tier !== 'string') continue;
    out.push({
      pageKind: entry.page_kind,
      tier: entry.tier,
      signals: Array.isArray(entry.signals)
        ? entry.signals.filter((item): item is string => typeof item === 'string')
        : [],
    });
  }
  return out;
}

/** Bounded, shape-checked parse of the `conflicts` array. */
function readConflicts(value: unknown): PageKindEvidenceConflict[] {
  if (!Array.isArray(value)) return [];
  const out: PageKindEvidenceConflict[] = [];
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue;
    const entry = raw as Record<string, unknown>;
    if (
      typeof entry.winner_page_kind !== 'string' ||
      typeof entry.conflicting_page_kind !== 'string' ||
      typeof entry.signal !== 'string'
    ) {
      continue;
    }
    out.push({
      winnerPageKind: entry.winner_page_kind,
      conflictingPageKind: entry.conflicting_page_kind,
      signal: entry.signal,
      detail: typeof entry.detail === 'string' ? entry.detail : '',
    });
  }
  return out;
}

function recordFrom(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readSignals(value: unknown): PageKindEvidenceSignal[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    const entry = recordFrom(raw);
    if (
      !entry ||
      typeof entry.signal !== 'string' ||
      typeof entry.page_kind !== 'string' ||
      typeof entry.tier !== 'string'
    ) {
      return [];
    }
    return [
      {
        signal: entry.signal,
        pageKind: entry.page_kind,
        tier: entry.tier,
        detail: typeof entry.detail === 'string' ? entry.detail : '',
      },
    ];
  });
}

function evidenceBasics(record: Record<string, unknown>): {
  classifiedBy: string;
  confidence: string;
  tier: string;
} | null {
  const { classified_by: classifiedBy, confidence, tier } = record;
  return typeof classifiedBy === 'string' &&
    typeof confidence === 'string' &&
    typeof tier === 'string'
    ? { classifiedBy, confidence, tier }
    : null;
}

/**
 * Narrow the untyped `page_kind_evidence` record (zod `z.unknown()` values)
 * into the display view. Returns null for absent or malformed evidence; bad
 * entries within a valid collection are skipped individually.
 */
export function readPageKindEvidence(
  evidence: unknown,
  finalPageKind: string | null,
): PageKindEvidenceView | null {
  const record = recordFrom(evidence);
  const basics = record && evidenceBasics(record);
  if (!record || !basics) return null;

  const schemaSuggestedType =
    typeof record.schema_suggested_type === 'string' ? record.schema_suggested_type : null;
  return {
    classifierVersion:
      typeof record.classifier_version === 'string' ? record.classifier_version : '',
    ...basics,
    schemaSuggestedType,
    signals: readSignals(record.signals),
    alternatives: readAlternatives(record.alternatives),
    conflicts: readConflicts(record.conflicts),
    otherReason: typeof record.other_reason === 'string' ? record.other_reason : null,
    schemaConflict:
      schemaSuggestedType !== null &&
      finalPageKind !== null &&
      schemaSuggestedType !== finalPageKind,
  };
}
