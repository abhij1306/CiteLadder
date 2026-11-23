import { policy } from '../config.ts';
import { isNonEmpty } from '../lists.ts';
import type { OfferingMap } from './generation-context.ts';
import { promptTokens } from './generation-metrics.ts';
import { generationSetting, type GenerationInput } from './generation-input.ts';
import {
  claimable,
  facetKey,
  facets,
  nextFacet,
  planners,
  topicWeights,
  type CellReviewState,
  type Facet,
  type PlanContext,
  type Slot,
} from './generation-plan.ts';

const B = policy.prompts.brand;

export const isBrandSlot = (slot: Pick<Slot, 'buyer_need'>) => 'angle' in slot.buyer_need;

type Planner = ReturnType<typeof planners>[number];

function claimFacet(plan: Planner, wanted: boolean): Facet | null | undefined {
  if (!wanted) return null;
  const options = plan.options.filter(claimable);
  if (!isNonEmpty(options)) return undefined;
  const facet = nextFacet(plan, options);
  plan.usage.set(facetKey(facet), (plan.usage.get(facetKey(facet)) ?? 0) + 1);
  return facet;
}

function brandNeed({
  offering,
  angle,
  facet,
  competitor,
}: {
  offering: string;
  angle: string;
  facet: Facet | null;
  competitor: string | undefined;
}) {
  const need: Record<string, string> = { offering, angle };
  const facetName = facet ? facets[facet.dimension] : undefined;
  if (facet && facetName) need[facetName] = facet.value;
  if (competitor) need.competitor = competitor;
  return need;
}

export function planBrandSlots(
  context: PlanContext & { context: { competitors: readonly { name: string }[] } },
  input: GenerationInput,
  suggestions: OfferingMap[],
): Slot[] {
  const competitors = context.context.competitors.map((row) => row.name);
  const angles = B.angles.filter((angle) => angle.cohort !== 'comparison' || competitors.length);
  const weights = topicWeights(context);
  const plans = planners(context, suggestions, input).toSorted(
    (a, b) => (weights.get(b.topic.id) ?? 1) - (weights.get(a.topic.id) ?? 1),
  );
  let compared = 0;
  return Array.from(
    { length: input.count * generationSetting('overgenerate_factor') },
    (_, index) => index,
  ).flatMap((index): Slot[] => {
    const angle = angles[index % angles.length];
    const plan = plans[(index + Math.floor(index / angles.length)) % plans.length];
    if (!angle || !plan) return [];
    const facet = claimFacet(plan, angle.facet);
    if (facet === undefined) return [];
    const competitor =
      angle.cohort === 'comparison' ? competitors[compared++ % competitors.length] : undefined;
    const need = brandNeed({ offering: plan.offering, angle: angle.key, facet, competitor });
    const reviewState: CellReviewState = facet?.source ?? 'not_applicable';
    return [
      {
        slot_id: `q${index + 1}`,
        cohort: angle.cohort,
        topic_id: plan.topic.id,
        topic_name: plan.topic.name,
        topic_description: plan.topic.description,
        buyer_need: need,
        target_buyer_stage: angle.stage,
        allowed_prompt_intents: [...angle.intents],
        target_prompt_intents: [...angle.intents],
        evidence_ref: {
          kind: 'business_map_cell',
          ...need,
          target_buyer_stage: angle.stage,
          review_state: reviewState,
          evidence_type: 'hypothesis',
        },
        grounded_attributes: plan.claims,
      },
    ];
  });
}

export function draftTokens(text: string, slot: Pick<Slot, 'buyer_need'>) {
  const tokens = promptTokens(text);
  if (slot.buyer_need.angle) tokens.add(`angle:${slot.buyer_need.angle}`);
  return tokens;
}
