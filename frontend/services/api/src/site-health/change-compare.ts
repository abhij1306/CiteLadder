/** Pure deterministic comparison of two explicitly comparable crawls' page evidence. */
import { isDeepStrictEqual } from 'node:util';
import { compareText } from '../text-order.ts';
import { policy } from '../config.ts';

const p = policy.site_health.change_intel;
const failing = new Set(policy.site_health.reads.failing_outcomes);

export type RuleState = { outcome: string; severity: string; evaluationId: string };
export type ChangePage = {
  siteUrlId: string;
  normalizedUrl: string;
  analysisId: string;
  artifactId: string;
  fields: Record<string, unknown>;
  rules: Record<string, RuleState>;
  /** True only when the indexability rule recorded an explicit intent to index. */
  intendedIndexable: boolean;
};
export type ExpectedChange = { eventId: string; expectedValue: unknown };
/** Declared implementation outcomes, keyed by `expectedKey(siteUrlId, field)`. */
export type ExpectedChanges = ReadonlyMap<string, ExpectedChange>;
/** One changed field, shaped as its `site_change_observations` row. */
export type ChangeObservation = {
  site_url_id: string;
  normalized_url: string;
  field: string;
  change_class: string;
  before_value: unknown;
  after_value: unknown;
  source_analysis_a_id: string | null;
  source_analysis_b_id: string | null;
  source_artifact_a_id: string | null;
  source_artifact_b_id: string | null;
  source_evaluation_a_id: string | null;
  source_evaluation_b_id: string | null;
  expected: boolean;
  implementation_event_id: string | null;
};
type ContentRecord = Record<string, unknown>;

/** A declared check may name a rule outcome by its pass/fail alias. */
const OUTCOME_ALIASES: Record<string, string> = { pass: 'satisfied', fail: 'missing' };

export const expectedKey = (siteUrlId: string, field: string) => `${siteUrlId} ${field}`;

function ruleClass(before: RuleState | undefined, after: RuleState | undefined) {
  if (!before || !after || before.outcome === after.outcome) return null;
  if (failing.has(before.outcome) && after.outcome === 'satisfied') return p.class_improvement;
  if (before.outcome === 'satisfied' && failing.has(after.outcome))
    return after.severity === 'critical' ? p.class_critical : p.class_regression;
  return null;
}
const statusIn = (value: unknown, low: number, high: number) =>
  Number.isInteger(value) && (value as number) >= low && (value as number) < high;
function httpClass(before: unknown, after: unknown) {
  if (statusIn(before, 200, 300) && statusIn(after, 400, 600)) return p.class_critical;
  if (statusIn(before, 400, 600) && statusIn(after, 200, 300)) return p.class_improvement;
  return p.class_neutral;
}
function changeClass(field: string, before: ChangePage, after: ChangePage) {
  const byRule = ruleClass(before.rules[field], after.rules[field]);
  if (byRule) return byRule;
  if (field === 'http_status') return httpClass(before.fields[field], after.fields[field]);
  if (
    field === 'robots_noindex' &&
    before.intendedIndexable &&
    before.fields[field] === false &&
    after.fields[field] === true
  )
    return p.class_critical;
  return p.class_neutral;
}
function expectedLink(
  expected: ExpectedChanges,
  after: ChangePage,
  field: string,
): Pick<ChangeObservation, 'expected' | 'implementation_event_id'> {
  const item = expected.get(expectedKey(after.siteUrlId, field));
  const declared = item?.expectedValue;
  const value =
    typeof declared === 'string' && Object.hasOwn(OUTCOME_ALIASES, declared)
      ? OUTCOME_ALIASES[declared]
      : declared;
  const rule = after.rules[field];
  const matches =
    item !== undefined &&
    (isDeepStrictEqual(value, after.fields[field]) ||
      (rule !== undefined && value === rule.outcome));
  return matches
    ? { expected: true, implementation_event_id: item.eventId }
    : { expected: false, implementation_event_id: null };
}

// ISO 8601 with a `T` or space separator; a value without an offset is UTC.
const ISO_DAY = /^\d{4}-\d{2}-\d{2}/;
const ISO_TIME = /^[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?/;
const ISO_OFFSET = /^(?:Z|[+-]\d{2}:?\d{2})$/;
function instant(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const day = ISO_DAY.exec(value)?.[0];
  if (!day) return null;
  const time = ISO_TIME.exec(value.slice(day.length))?.[0] ?? '';
  const offset = value.slice(day.length + time.length);
  if (offset && (!time || !ISO_OFFSET.test(offset))) return null;
  const zone = !offset || offset === 'Z' ? 'Z' : `${offset.slice(0, 3)}:${offset.slice(-2)}`;
  const parsed = Date.parse(`${day}T${time.slice(1) || '00:00:00'}${zone}`);
  return Number.isNaN(parsed) ? null : parsed;
}
const stringSet = (value: unknown) =>
  new Set(Array.isArray(value) ? value.map((item) => JSON.stringify(item)) : []);
const missingFrom = (from: Set<unknown>, other: Set<unknown>) =>
  [...from].filter((item) => !other.has(item)).length;

function contentCoverage(before: ContentRecord, after: ContentRecord): [string, string | null] {
  if (before.extractor_version !== after.extractor_version)
    return ['unknown', 'extractor_incompatible'];
  if (before.coverage === 'partial' || after.coverage === 'partial')
    return ['partial', 'truncation_established'];
  if (before.coverage === 'complete' && after.coverage === 'complete') return ['complete', null];
  return ['unknown', 'completeness_unproven'];
}
function contentClassification(coverage: string, delta: number, added: number, removed: number) {
  if (coverage !== 'complete') return 'insufficient_evidence';
  if (delta >= p.substantial_delta_ratio || added + removed >= p.substantial_section_changes)
    return 'substantial_change';
  if (delta > p.cosmetic_delta_ceiling || added || removed) return 'minor_change';
  return 'unchanged';
}
/** Whether the modification date moved exactly when the text did. */
function metadataConsistency(before: ContentRecord, after: ContentRecord, contentMoved: boolean) {
  const modifiedBefore = instant(before.modified);
  const modifiedAfter = instant(after.modified);
  if (modifiedBefore === null || modifiedAfter === null) return 'unknown';
  return (modifiedBefore !== modifiedAfter) === contentMoved ? 'consistent' : 'inconsistent';
}
function contentResult(before: ContentRecord, after: ContentRecord) {
  const beforeShingles = new Set(Array.isArray(before.shingles) ? before.shingles : []);
  const afterShingles = new Set(Array.isArray(after.shingles) ? after.shingles : []);
  const union = new Set([...beforeShingles, ...afterShingles]);
  const shared = [...beforeShingles].filter((item) => afterShingles.has(item)).length;
  const delta = union.size ? 1 - shared / union.size : 0;
  const beforeSections = stringSet(before.heading_outline);
  const afterSections = stringSet(after.heading_outline);
  const added = missingFrom(afterSections, beforeSections);
  const removed = missingFrom(beforeSections, afterSections);
  const [coverage, reason] = contentCoverage(before, after);
  const classification = contentClassification(coverage, delta, added, removed);
  const moved = classification === 'substantial_change' || classification === 'minor_change';
  return {
    content_change_classification: classification,
    metadata_consistency:
      coverage === 'complete' ? metadataConsistency(before, after, moved) : 'unknown',
    content_delta_ratio: Math.round(delta * 1e6) / 1e6,
    content_delta_measure: 'measured_text_divergence_over_compared_portion',
    sections_added: added,
    sections_removed: removed,
    comparison_coverage: coverage,
    coverage_reason: reason,
    modified_before: before.modified ?? null,
    modified_after: after.modified ?? null,
  };
}

function paired(before: ChangePage, after: ChangePage) {
  return {
    site_url_id: after.siteUrlId,
    normalized_url: after.normalizedUrl,
    source_analysis_a_id: before.analysisId,
    source_analysis_b_id: after.analysisId,
    source_artifact_a_id: before.artifactId,
    source_artifact_b_id: after.artifactId,
  };
}
function fieldObservation(
  before: ChangePage,
  after: ChangePage,
  field: string,
  expected: ExpectedChanges,
): ChangeObservation | null {
  const beforeRule = before.rules[field];
  const afterRule = after.rules[field];
  const ruleChanged =
    beforeRule !== undefined &&
    afterRule !== undefined &&
    (beforeRule.outcome !== afterRule.outcome || beforeRule.severity !== afterRule.severity);
  if (isDeepStrictEqual(before.fields[field], after.fields[field]) && !ruleChanged) return null;
  return {
    ...paired(before, after),
    field,
    change_class: changeClass(field, before, after),
    before_value: before.fields[field] ?? null,
    after_value: after.fields[field] ?? null,
    source_evaluation_a_id: beforeRule?.evaluationId ?? null,
    source_evaluation_b_id: afterRule?.evaluationId ?? null,
    ...expectedLink(expected, after, field),
  };
}
const isRecord = (value: unknown): value is ContentRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
function contentObservation(before: ChangePage, after: ChangePage): ChangeObservation | null {
  const previous = before.fields[p.change_field];
  const current = after.fields[p.change_field];
  if (!isRecord(previous) || !isRecord(current)) return null;
  const result = contentResult(previous, current);
  if (isDeepStrictEqual(previous, current) && result.coverage_reason !== 'extractor_incompatible')
    return null;
  return {
    ...paired(before, after),
    field: p.change_field,
    change_class: p.class_neutral,
    before_value: previous,
    after_value: { ...current, ...result },
    source_evaluation_a_id: null,
    source_evaluation_b_id: null,
    expected: false,
    implementation_event_id: null,
  };
}
function presence(page: ChangePage, present: boolean): ChangeObservation {
  return {
    site_url_id: page.siteUrlId,
    normalized_url: page.normalizedUrl,
    field: 'url_presence',
    change_class: present ? p.class_improvement : p.class_regression,
    before_value: !present,
    after_value: present,
    source_analysis_a_id: present ? null : page.analysisId,
    source_analysis_b_id: present ? page.analysisId : null,
    source_artifact_a_id: present ? null : page.artifactId,
    source_artifact_b_id: present ? page.artifactId : null,
    source_evaluation_a_id: null,
    source_evaluation_b_id: null,
    expected: false,
    implementation_event_id: null,
  };
}

/** Compare selected evidence; URL presence is claimed only for a complete pair. */
export function compareCrawls(
  crawlA: readonly ChangePage[],
  crawlB: readonly ChangePage[],
  options: { completePair: boolean; expected?: ExpectedChanges },
): ChangeObservation[] {
  const expected = options.expected ?? new Map();
  const pagesA = new Map(crawlA.map((page) => [page.siteUrlId, page]));
  const pagesB = new Map(crawlB.map((page) => [page.siteUrlId, page]));
  const ids = (from: Map<string, ChangePage>, present: boolean, other: Map<string, ChangePage>) =>
    [...from.keys()].filter((id) => other.has(id) === present).sort(compareText);
  const observations: ChangeObservation[] = [];
  for (const id of ids(pagesA, true, pagesB)) {
    const before = pagesA.get(id)!;
    const after = pagesB.get(id)!;
    for (const field of p.fields) {
      const observation = fieldObservation(before, after, field, expected);
      if (observation) observations.push(observation);
    }
    const content = contentObservation(before, after);
    if (content) observations.push(content);
  }
  if (options.completePair) {
    for (const id of ids(pagesB, false, pagesA)) observations.push(presence(pagesB.get(id)!, true));
    for (const id of ids(pagesA, false, pagesB))
      observations.push(presence(pagesA.get(id)!, false));
  }
  return observations;
}
