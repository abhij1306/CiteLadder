/**
 * The quick-generate universe plan: a deterministic, coverage-first sample of
 * offering × stage × intent × facet × market cells, the narrow brief a draft
 * batch receives, and the geography vocabulary admission and metrics read.
 */
import { DENSE_SCRIPT } from '../analysis/aliases.ts';
import { policy } from '../config.ts';
import { record, strings } from '../db/json.ts';
import type { GenerationContext, OfferingMap } from './generation-context.ts';
import { generationSetting, type GenerationInput } from './generation-input.ts';
import { isNonEmpty, type NonEmpty } from '../lists.ts';
import { bindingTokens, sharedTokens } from './binding.ts';
import type { ObservedQuery } from './observed-queries.ts';

const G = policy.prompts.generation;
export const dimensions = ['attributes', 'situations', 'audiences'] as const;
const facets = ['attribute', 'situation_or_constraint', 'audience'] as const;
const PERSONA = dimensions.indexOf('audiences');

export type Slot = {
  slot_id: string;
  topic_id: string;
  topic_name: string;
  topic_description: string;
  buyer_need: Record<string, string>;
  target_buyer_stage: string;
  allowed_prompt_intents: string[];
  /** Intents that suit the target stage: planning guidance, not an admission rule. */
  target_prompt_intents?: string[];
  evidence_ref: Record<string, unknown>;
  /** Same-topic searches that steer phrasing; absent when the project has none. */
  grounding?: Grounding[];
};
type Grounding = Pick<
  ObservedQuery,
  'id' | 'source' | 'text' | 'classifier_version' | 'override_id'
>;
type Facet = { dimension: number; value: string; suggested: boolean };
type PlanContext = Pick<GenerationContext, 'selected' | 'topics' | 'maps' | 'observed'> & {
  context: Pick<GenerationContext['context'], 'business_context'>;
};

const business = (context: PlanContext) => record(context.context.business_context);

/** The reviewed market scope's share of cells that may name a market. */
function locationShare(context: PlanContext): number {
  return G.location_policy[String(business(context).market_scope)] ?? 0;
}

/** Service areas a cell may name; none when the market scope forbids places. */
function plannedMarkets(context: PlanContext): string[] {
  return locationShare(context) > 0 ? [...new Set(strings(business(context).service_areas))] : [];
}

/**
 * Words that name the project's places: service areas and the primary market's
 * context terms. A generated draft naming one in a
 * cell without a market is `location_unplanned`.
 */
export function geoTerms(context: PlanContext): string[] {
  const values = business(context);
  const market =
    typeof values.primary_market === 'string' ? values.primary_market.toUpperCase() : '';
  const terms = (policy.discovery.constants.market_context_terms as Record<string, string[]>)[
    market
  ];
  return [...new Set([...strings(values.service_areas), ...(terms ?? [])])].filter((term) =>
    term.trim(),
  );
}

const folded = (text: string) =>
  text
    .normalize('NFKD')
    .replaceAll(/\p{M}+/gu, '')
    .toLowerCase()
    .normalize('NFC');
const wordsOf = (text: string) => folded(text).match(/[\p{L}\p{N}]+/gu) ?? [];

/**
 * Whether `text` names one of `terms` as whole words. A short all-capital term
 * ("US", "UK") must match its capitals, so the pronoun "us" is not a place; a
 * term in a script written without spaces matches as a substring.
 */
export function namesPlace(text: string, terms: readonly string[]): boolean {
  const padded = ` ${wordsOf(text).join(' ')} `;
  return terms.some((term) => {
    if (DENSE_SCRIPT.test(term)) return folded(text).includes(folded(term.trim()));
    if (/^\p{Lu}{2,3}$/u.test(term.replaceAll('.', ''))) {
      const optionalDots = term.replaceAll('.', String.raw`\.?`);
      return new RegExp(String.raw`(?<![\p{L}\p{N}])${optionalDots}(?![\p{L}\p{N}])`, 'u').test(
        text,
      );
    }
    const phrase = wordsOf(term).join(' ');
    return Boolean(phrase) && padded.includes(` ${phrase} `);
  });
}

function combinations(map: OfferingMap | undefined, personas: Facet[]): Facet[][] {
  const options = [
    ...dimensions.flatMap((dimension, index) =>
      (map?.[dimension] ?? []).map((entry) => ({
        dimension: index,
        value: entry.value,
        suggested: entry.review_state !== 'confirmed',
      })),
    ),
    ...(map?.audiences.some((entry) => entry.review_state === 'confirmed') ? [] : personas),
  ];
  const result: Facet[][] = [[]];
  for (const option of options) {
    // Extend only the combinations that existed before this option.
    const size = result.length;
    for (let index = 0; index < size; index++) {
      const prior = result[index]!;
      if (
        prior.length >= G.cell_max_facets ||
        prior.some((item) => item.dimension === option.dimension)
      )
        continue;
      const values = new Set([
        ...prior.map((item) => item.value.toLowerCase()),
        option.value.toLowerCase(),
      ]);
      if (
        map?.exclusions.some(
          (pair) => values.has(pair.first.toLowerCase()) && values.has(pair.second.toLowerCase()),
        )
      )
        continue;
      result.push([...prior, option]);
    }
  }
  return result.slice(1);
}

type Planner = {
  topic: GenerationContext['selected'][number];
  map: OfferingMap | undefined;
  combos: Facet[][];
  cells: number;
  faceted: number;
  located: number;
  usage: Map<string, number>;
};

function planners(context: PlanContext, suggestions: OfferingMap[]): Planner[] {
  const maps = [...context.maps, ...suggestions];
  // Without confirmed audiences, inferred buyer roles are suggested personas.
  const personas = strings(business(context).buyer_roles).map((value) => ({
    dimension: PERSONA,
    value,
    suggested: true,
  }));
  return context.selected.map((topic) => {
    const parent = context.topics.find((item) => item.id === topic.parent_id);
    const match = (name: string) =>
      maps.find(
        (map) =>
          map.offering.toLowerCase() === name.toLowerCase() &&
          dimensions.some((dimension) => map[dimension].length),
      );
    const map = match(topic.name) ?? (parent ? match(parent.name) : undefined);
    return {
      topic,
      map,
      combos: combinations(map, personas),
      cells: 0,
      faceted: 0,
      located: 0,
      usage: new Map(),
    };
  });
}

/** The least-used facet combination, confirmed values before suggested ones. */
function nextCombo(plan: Planner, combos: NonEmpty<Facet[]>): Facet[] {
  const used = (facet: Facet) => plan.usage.get(`${facet.dimension}:${facet.value}`) ?? 0;
  const score = (combo: Facet[]) => combo.reduce((sum, facet) => sum + used(facet), 0);
  const compare = (a: Facet[], b: Facet[]) =>
    score(a) - score(b) ||
    Number(a.some((facet) => facet.suggested)) - Number(b.some((facet) => facet.suggested)) ||
    a.length - b.length;
  // The first of the least: the head of a stable sort.
  return combos.reduce((best, combo) => (compare(combo, best) < 0 ? combo : best));
}

/**
 * Up to `examples_per_slot` of the topic's observed searches, those sharing
 * the most tokens with the cell's offering and facets first. Ties keep the
 * loader's ranking (Search Console impressions, then keyword volume, then
 * text): weights of different sources are never compared directly.
 */
type TokenizedSearch = { query: ObservedQuery; tokens: Set<string> };
/** Each topic's observed searches in loader order, tokenized once per plan. */
const searchesByTopic = (observed: readonly ObservedQuery[]) =>
  Map.groupBy(
    observed.map((query) => ({ query, tokens: bindingTokens(query.text) })),
    (search) => search.query.topic_id,
  );

function groundingFor(
  searches: readonly TokenizedSearch[],
  need: Record<string, string>,
): Grounding[] {
  const cell = bindingTokens(Object.values(need).join(' '));
  return (
    searches
      .map(({ query, tokens }) => ({ query, shared: sharedTokens(tokens, cell) }))
      // A stable sort, so equal overlap keeps the loader's order.
      .toSorted((a, b) => b.shared - a.shared)
      .slice(0, G.observed.examples_per_slot)
      .map(({ query: { id, source, text, classifier_version, override_id } }) => ({
        id,
        source,
        text,
        classifier_version,
        override_id,
      }))
  );
}

/**
 * Plan `count × overgenerate_factor` cells round-robin over the selected
 * offerings. Each offering covers every stage with a bare cell before any
 * facet; afterwards facets attach to at most `facet_cell_share` of its cells
 * and a market to at most the scope's `location_policy` share.
 */
export function planSlots(
  context: PlanContext,
  input: GenerationInput,
  suggestions: OfferingMap[],
): Slot[] {
  const plans = planners(context, suggestions);
  const searches = searchesByTopic(context.observed);
  const markets = plannedMarkets(context),
    share = locationShare(context),
    stages = G.stages;
  if (!isNonEmpty(stages)) throw new Error('Expected at least one configured buyer stage');
  return Array.from(
    { length: input.count * generationSetting('overgenerate_factor') },
    (_, index) => {
      const plan = plans[index % plans.length]!;
      plan.cells += 1;
      const used = (key: string) => plan.usage.get(key) ?? 0;
      const least = (key: string, options: NonEmpty<string>) =>
        options.reduce((best, option) =>
          used(`${key}:${option}`) < used(`${key}:${best}`) ? option : best,
        );
      const stage = least('stage', stages);
      const combo =
        plan.cells > G.stages.length &&
        isNonEmpty(plan.combos) &&
        plan.faceted + 1 <= G.facet_cell_share * plan.cells
          ? nextCombo(plan, plan.combos)
          : [];
      const market =
        isNonEmpty(markets) && plan.located + 1 <= share * plan.cells
          ? least('market', markets)
          : '';
      if (combo.length) plan.faceted += 1;
      if (market) plan.located += 1;
      for (const key of [
        ...combo.map((facet) => `${facet.dimension}:${facet.value}`),
        `stage:${stage}`,
        ...(market ? [`market:${market}`] : []),
      ])
        plan.usage.set(key, used(key) + 1);
      const need: Record<string, string> = { offering: plan.map?.offering ?? plan.topic.name };
      for (const facet of combo) need[facets[facet.dimension]!] = facet.value;
      if (market) need.market = market;
      const grounding = groundingFor(searches.get(plan.topic.id) ?? [], need);
      return {
        slot_id: `q${index + 1}`,
        topic_id: plan.topic.id,
        topic_name: plan.topic.name,
        topic_description: plan.topic.description,
        buyer_need: need,
        target_buyer_stage: stage,
        allowed_prompt_intents:
          input.cohort === 'comparison' ? ['compare'] : Object.keys(G.intent_legacy),
        target_prompt_intents: G.stage_intents[stage] ?? [],
        evidence_ref: {
          kind: 'business_map_cell',
          ...need,
          target_buyer_stage: stage,
          review_state: combo.some((facet) => facet.suggested) ? 'suggested' : 'confirmed',
          evidence_type: 'hypothesis',
        },
        ...(grounding.length ? { grounding } : {}),
      };
    },
  );
}

/**
 * A slot as a draft batch receives it: grounding becomes example wording,
 * without row identities, and a slot without grounding is sent unchanged.
 */
export function modelSlot({ grounding, ...slot }: Slot) {
  return grounding?.length
    ? { ...slot, buyer_search_examples: grounding.map((example) => example.text) }
    : slot;
}

/**
 * What a quick-generate draft batch knows about the business: category,
 * offerings, closed facets and register. No prose, sources, demand signals or
 * competitors, so the wording follows the planned cell rather than the profile.
 * The only observed data a batch sees is a grounded slot's example searches.
 */
export function generationBrief(context: GenerationContext) {
  const values = business(context);
  const fields = G.quick_brief_fields.filter(
    (field) => values[field] != null && values[field] !== '',
  );
  const sources = record(values.field_sources);
  return {
    ...Object.fromEntries(fields.map((field) => [field, values[field]])),
    offerings: context.offerings,
    language_code: context.context.language_code,
    country_code: context.context.country_code,
    field_sources: Object.fromEntries(
      fields.filter((field) => field in sources).map((field) => [field, sources[field]]),
    ),
  };
}
