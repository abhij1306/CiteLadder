import { policy } from '../../config.ts';
import { round } from '../../demand/projection.ts';
const p = policy.opportunity.opportunities;
const e = policy.opportunity.earned_actions;
const normalized = (value: string | null) => (value ?? '').trim().toLowerCase();
function weight(table: Record<string, number>, key: string, fallback: number): number {
  return table[key] ?? fallback;
}
function valueFactorForIntent(intent: string | null): number {
  return weight(p.INTENT_VALUE_WEIGHTS, normalized(intent), p.INTENT_VALUE_DEFAULT);
}
export function valueFactorForPrompt(
  stage: string | null,
  intent: string | null,
  legacy: string | null,
): [number, string, string] {
  const s = normalized(stage);
  const i = normalized(intent);
  const l = normalized(legacy);
  if (Object.hasOwn(p.BUYER_STAGE_VALUE_WEIGHTS, s))
    return [weight(p.BUYER_STAGE_VALUE_WEIGHTS, s, 0), 'buyer_stage', s];
  if (Object.hasOwn(p.PROMPT_INTENT_VALUE_WEIGHTS, i))
    return [weight(p.PROMPT_INTENT_VALUE_WEIGHTS, i, 0), 'prompt_intent', i];
  return [valueFactorForIntent(l), 'legacy_intent', l];
}
export function recommendationStrengthFactor(assessments: Record<string, unknown>[]): number {
  // A loop, not `Math.max(...spread)`: an audit's assessments are unbounded.
  let strongest = -Infinity;
  for (const a of assessments) {
    strongest = Math.max(strongest, weight(p.RECOMMENDATION_STRENGTH_FACTORS, String(a.state), 1));
  }
  return assessments.length ? strongest : 1;
}
export function gapFactorVisibility(competitors: number, ownedRate: number, strength = 1): number {
  const count = Math.min(Math.max(Math.trunc(competitors), 0), p.GAP_COMPETITOR_CAP);
  return (
    (1 +
      p.GAP_COMPETITOR_WEIGHT *
        count *
        p.GAP_OWNED_CITATION_WEIGHT *
        (1 - Math.min(Math.max(ownedRate, 0), 1))) *
    Math.max(strength, 1)
  );
}
export function pageCompetitorPresenceFactor(count: number): number {
  return Math.min(
    e.EARNED_PAGE_COMPETITOR_FACTOR_MAX,
    1 + Math.max(Math.trunc(count), 0) * e.EARNED_PAGE_COMPETITOR_FACTOR_STEP,
  );
}
export function pageRecurrenceFactor(count: number, eligible: number): number {
  return eligible <= 0
    ? 1
    : Math.min(e.EARNED_PAGE_USAGE_FACTOR_MAX, 1 + Math.max(count, 0) / eligible);
}
export function priorityScore(severity: string, value: number, gap: number): number {
  return round(
    weight(p.SEVERITY_WEIGHTS, severity, p.SEVERITY_WEIGHT_DEFAULT) *
      value *
      gap *
      p.PRIORITY_SCALE,
    p.PRIORITY_ROUNDING_DECIMALS,
  );
}
