import { policy } from '../../config.ts';
import { round } from '../../demand/projection.ts';
import type { AnalysisEvidence } from './evidence.ts';
import { byDomain } from './source-patterns.ts';
import { compareText } from '../../text-order.ts';
const p = policy.opportunity.earned_actions;
const s = policy.opportunity.source_patterns;
const sorted = (values: Iterable<string>) => [...values].sort(compareText);
function observedPath(kind: string): string {
  if (kind === s.SOURCE_CLASS_BRAND_OWNED) return p.ACTION_PATH_OWNED;
  return kind === s.SOURCE_CLASS_COMPETITOR_OWNED ? 'competitive_evidence' : p.ACTION_PATH_EARNED;
}
function empty(state: string, eligible: number, limitations: string[]) {
  return {
    state,
    projection_version: s.SOURCE_MIX_PROJECTION_VERSION,
    taxonomy_version: s.SOURCE_TAXONOMY_VERSION,
    counts: {},
    percentages: {},
    observation_count: 0,
    answers_with_sources: 0,
    eligible_analyzed_answers: eligible,
    coverage_rate: eligible ? 0 : null,
    limitations,
  };
}
export const emptySourceProjection = () =>
  empty('not_applicable', 0, ['No qualifying visibility gap.']);
function mix(counts: Map<string, number>, eligible: number, answers: number) {
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const keys = sorted(counts.keys());
  return {
    state: 'available',
    projection_version: s.SOURCE_MIX_PROJECTION_VERSION,
    taxonomy_version: s.SOURCE_TAXONOMY_VERSION,
    counts: Object.fromEntries(keys.map((k) => [k, counts.get(k)])),
    percentages: Object.fromEntries(keys.map((k) => [k, round((counts.get(k)! * 100) / total, 1)])),
    observation_count: total,
    answers_with_sources: answers,
    eligible_analyzed_answers: eligible,
    coverage_rate: eligible ? round(answers / eligible, 4) : null,
    limitations: [],
  };
}
function increment(counts: Map<string, number>, key: string) {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}
/** How the gap prompts' answers split across source classes, or why it cannot be said. */
export function buildSourceProjection(analyses: AnalysisEvidence[], gapIndices: number[]) {
  if (!gapIndices.length) return emptySourceProjection();
  const rows = analyses.filter((a) => gapIndices.includes(a.prompt_index));
  const observed = new Map<string, number>();
  let answers = 0;
  for (const row of rows) {
    const domains = byDomain(row.citations);
    if (domains.size) answers++;
    for (const [kind] of domains.values()) increment(observed, observedPath(kind));
  }
  return observed.size
    ? mix(observed, rows.length, answers)
    : empty('unavailable', rows.length, ['Gap answers had no usable citation domains.']);
}
