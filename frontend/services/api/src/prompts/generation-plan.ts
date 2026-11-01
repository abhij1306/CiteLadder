/**
 * The quick-generate universe plan: a deterministic, coverage-first sample of
 * offering × facet × stage × cohort × market cells, the narrow brief a draft
 * batch receives, and the geography vocabulary admission and metrics read.
 */
import { DENSE_SCRIPT } from '../analysis/aliases.ts';
import { policy } from '../config.ts';
import { record, strings } from '../db/json.ts';
import { z } from 'zod';

import type { GenerationContext, OfferingMap } from './generation-context.ts';
import {
  cohortShares,
  generationCohorts,
  generationSetting,
  type GenerationCohort,
  type GenerationInput,
} from './generation-input.ts';
import { isNonEmpty, type NonEmpty } from '../lists.ts';
import { bindingTokens, sharedTokens } from './binding.ts';
import { seedQueries, type ObservedQuery } from './observed-queries.ts';

const G = policy.prompts.generation;
export const dimensions = ['attributes', 'situations', 'audiences'] as const;
const facets = ['attribute', 'situation_or_constraint', 'audience'] as const;
const PERSONA = dimensions.indexOf('audiences');

export type Slot = {
  slot_id: string;
  /** The cohort the cell is drafted and admitted under. */
  cohort: GenerationCohort;
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
  /**
   * A brand diagnostic cell's only claimable attributes: the topic's
   * offerings and the attributes a person confirmed in its business map. The
   * judge checks the draft against them; other cells carry none.
   */
  grounded_attributes?: string[];
};
type Grounding = Pick<
  ObservedQuery,
  'id' | 'source' | 'text' | 'classifier_version' | 'override_id'
>;
/**
 * Where a facet value comes from: `confirmed` by a person in the business map,
 * `suggested` by a model or inferred buyer roles, or `requested` as a persona
 * for this run only.
 */
type FacetSource = 'confirmed' | 'suggested' | 'requested';
type Facet = { dimension: number; value: string; source: FacetSource };
/** A cell's evidence review state; `not_applicable` when it carries no facet. */
type CellReviewState = FacetSource | 'not_applicable';
type PlanContext = Pick<GenerationContext, 'selected' | 'topics' | 'maps' | 'observed'> & {
  context: Pick<GenerationContext['context'], 'business_context'>;
};

const business = (context: Pick<PlanContext, 'context'>) =>
  record(context.context.business_context);
const ATTRIBUTE = dimensions.indexOf('attributes');

/**
 * `business_context.topic_offerings`: the saved offerings each recovered topic
 * was proposed from, by topic id, so a buyer-facing category keeps its
 * offerings' business-map facets whatever it is named.
 */
export const topicLinks = z.record(z.string(), z.array(z.string())).catch({});

/**
 * The offerings a topic covers: those it was proposed from, else the offering
 * it is named after.
 */
export function topicOfferings(
  values: Record<string, unknown>,
  topic: { id: string; name: string },
): string[] {
  const linked = topicLinks.parse(values.topic_offerings ?? {})[topic.id] ?? [];
  return linked.length ? linked : [topic.name];
}

/**
 * Each selected topic's weight in a run: how many saved offerings it covers
 * (`topicOfferings`), so the category holding most of the catalogue gets the
 * most cells and selected prompts. A topic covering one offering, or none
 * recorded, weighs one; equal weights plan and select round-robin.
 */
export function topicWeights(
  context: Pick<PlanContext, 'selected' | 'context'>,
): Map<string, number> {
  const values = business(context);
  return new Map(
    context.selected.map((topic) => [topic.id, Math.max(1, topicOfferings(values, topic).length)]),
  );
}

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

const entryFacets = (dimension: number, entries: OfferingMap[(typeof dimensions)[number]]) =>
  entries.map((entry) => ({
    dimension,
    value: entry.value,
    source: entry.review_state === 'confirmed' ? ('confirmed' as const) : ('suggested' as const),
  }));
const personaFacets = (values: readonly string[], source: FacetSource) =>
  values.map((value) => ({ dimension: PERSONA, value, source }));
/** Facets with case-insensitively repeated values removed, first spelling kept. */
const distinctFacets = (facets: readonly Facet[]) => [
  ...new Map(facets.map((facet) => [facet.value.toLowerCase(), facet])).values(),
];

type Planner = {
  topic: GenerationContext['selected'][number];
  /** The offering label cells carry. */
  offering: string;
  /** The topic's facet options; every cell takes exactly one when any exist. */
  options: Facet[];
  /** What a branded cell may attribute to the business (`Slot.grounded_attributes`). */
  claims: string[];
  cells: number;
  located: number;
  usage: Map<string, number>;
};

/**
 * The offering maps a topic draws facets from: the map named like the topic,
 * else the maps of the offerings it was proposed from (`topicOfferings`),
 * else its parent's. A map named like the topic lends its offering label; a
 * category proposed from offerings keeps its own buyer-facing name.
 */
function topicMaps(
  context: PlanContext,
  maps: readonly OfferingMap[],
  topic: GenerationContext['selected'][number],
): { maps: OfferingMap[]; offering: string } {
  const values = business(context);
  const withFacets = (name: string) =>
    maps.filter(
      (map) =>
        map.offering.toLowerCase() === name.toLowerCase() &&
        dimensions.some((dimension) => map[dimension].length),
    );
  const parent = context.topics.find((item) => item.id === topic.parent_id);
  for (const owner of parent ? [topic, parent] : [topic]) {
    const named = withFacets(owner.name);
    if (named[0]) return { maps: named.slice(0, 1), offering: named[0].offering };
    const linked = topicOfferings(values, owner).flatMap(withFacets);
    if (linked.length) return { maps: linked, offering: topic.name };
  }
  return { maps: [], offering: topic.name };
}

/**
 * Each selected topic's facet options: its offering maps' attributes,
 * situations and audiences. The run's personas, when requested, replace the
 * audiences; otherwise inferred buyer roles stand in for missing confirmed
 * audiences. A topic without map facets falls back to those personas and
 * every audience the business map lists; only a business without any of them
 * plans bare cells.
 */
function planners(
  context: PlanContext,
  suggestions: OfferingMap[],
  input: GenerationInput,
): Planner[] {
  const maps = [...context.maps, ...suggestions];
  const requested = personaFacets(input.distribution?.personas ?? [], 'requested');
  const roles = personaFacets(strings(business(context).buyer_roles), 'suggested');
  const audiences = maps.flatMap((map) => entryFacets(PERSONA, map.audiences));
  const fallback = distinctFacets(requested.length ? requested : [...roles, ...audiences]);
  return context.selected.map((topic) => {
    const { maps: own, offering } = topicMaps(context, maps, topic);
    const confirmedAudience = own.some((map) =>
      map.audiences.some((entry) => entry.review_state === 'confirmed'),
    );
    let people = requested;
    if (!requested.length)
      people = [
        ...own.flatMap((map) => entryFacets(PERSONA, map.audiences)),
        ...(confirmedAudience ? [] : roles),
      ];
    const options = own.length
      ? distinctFacets([
          ...own.flatMap((map) => entryFacets(dimensions.indexOf('attributes'), map.attributes)),
          ...own.flatMap((map) => entryFacets(dimensions.indexOf('situations'), map.situations)),
          ...people,
        ])
      : [];
    const confirmed = own.flatMap((map) =>
      map.attributes
        .filter((entry) => entry.review_state === 'confirmed')
        .map(({ value }) => value),
    );
    return {
      topic,
      offering,
      options: options.length ? options : fallback,
      claims: [...new Set([...topicOfferings(business(context), topic), ...confirmed])],
      cells: 0,
      located: 0,
      usage: new Map(),
    };
  });
}

const facetKey = (facet: Facet) => `${facet.dimension}:${facet.value}`;

/**
 * The topic's least-used facet: fewest uses of the value, then of its
 * dimension (so attributes, situations and audiences alternate), confirmed
 * values before suggestions, then map order.
 */
function nextFacet(plan: Planner, options: NonEmpty<Facet>): Facet {
  const used = (key: string) => plan.usage.get(key) ?? 0;
  const compare = (a: Facet, b: Facet) =>
    used(facetKey(a)) - used(facetKey(b)) ||
    used(`dimension:${a.dimension}`) - used(`dimension:${b.dimension}`) ||
    Number(a.source === 'suggested') - Number(b.source === 'suggested');
  // The first of the least: the head of a stable sort.
  return options.reduce((best, facet) => (compare(facet, best) < 0 ? facet : best));
}

/** Planned stages weighted by the requested intent mix; equal without one. */
function stageWeights(input: GenerationInput): [string, number][] {
  const mix = input.distribution?.intent_mix;
  return G.planned_stages.map((stage) => {
    if (!mix) return [stage, 1];
    const shares = Object.entries(mix).filter(([intent]) => G.intent_mix_stages[intent] === stage);
    return [stage, shares.reduce((sum, [, share]) => sum + share, 0)];
  });
}

/**
 * The next label by highest averages (Sainte-Laguë): the option whose next use
 * keeps its count closest to its weight's share. Each later counter breaks the
 * ties of the one before; remaining ties keep option order. Zero weights never
 * win.
 */
function proportional<T extends string>(
  weights: readonly (readonly [T, number])[],
  ...counters: ((option: T) => number)[]
): T | null {
  let best: { option: T; quotients: number[] } | null = null;
  const ahead = (a: number[], b: number[]) => {
    const index = a.findIndex((value, at) => value !== b[at]);
    return index >= 0 && a[index]! > b[index]!;
  };
  for (const [option, weight] of weights) {
    if (weight <= 0) continue;
    const quotients = counters.map((used) => weight / (2 * used(option) + 1));
    if (!best || ahead(quotients, best.quotients)) best = { option, quotients };
  }
  return best?.option ?? null;
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
 * A branded cell asserts something about the business, so it never takes an
 * attribute only a model suggested: situations and audiences describe the
 * buyer, while an unconfirmed attribute would become a claim about the brand.
 */
const claimable = (facet: Facet) => facet.dimension !== ATTRIBUTE || facet.source === 'confirmed';

/**
 * Plan `count × overgenerate_factor` cells over the selected topics. Cohorts
 * follow the requested shares; within each cohort every topic gets a cell
 * before any gets a second, then topics share cells by `topicWeights`. Every
 * cell carries exactly one facet (the topic's least-used attribute, situation
 * or audience; a branded cell only a `claimable` one) from the first cell on.
 * The buyer stage is a label balanced per topic and across the run, weighted
 * by any requested intent mix. A market attaches to at most the scope's
 * `location_policy` share of a topic's cells. Grounding comes only from the
 * searches the request's seeds allow.
 */
export function planSlots(
  context: PlanContext,
  input: GenerationInput,
  suggestions: OfferingMap[],
): Slot[] {
  const plans = planners(context, suggestions, input);
  const weights = topicWeights(context);
  const topicOptions = plans.map(
    (plan) => [plan.topic.id, weights.get(plan.topic.id) ?? 1] as const,
  );
  const searches = searchesByTopic(seedQueries(context.observed, input));
  const markets = plannedMarkets(context),
    share = locationShare(context),
    stages = stageWeights(input),
    shares = cohortShares(input),
    plannedStages = G.planned_stages;
  if (!isNonEmpty(plannedStages)) throw new Error('Expected at least one planned buyer stage');
  const run = new Map<string, number>();
  const runUsed = (key: string) => run.get(key) ?? 0;
  const count = (usage: Map<string, number>, key: string) =>
    usage.set(key, (usage.get(key) ?? 0) + 1);
  return Array.from(
    { length: input.count * generationSetting('overgenerate_factor') },
    (_, index) => {
      const cohort =
        proportional(
          generationCohorts.map((name) => [name, shares[name]] as const),
          (name) => runUsed(`cohort:${name}`),
        ) ?? 'core';
      const inCohort = (id: string) => runUsed(`${cohort}:topic:${id}`);
      const uncoveredTopics = topicOptions.filter(([id]) => !inCohort(id));
      const topicId = proportional(
        uncoveredTopics.length ? uncoveredTopics : topicOptions,
        inCohort,
        (id) => runUsed(`topic:${id}`),
      );
      const plan = plans.find((item) => item.topic.id === topicId) ?? plans[index % plans.length]!;
      plan.cells += 1;
      const used = (key: string) => plan.usage.get(key) ?? 0;
      // A topic first covers each weighted stage once; then the run keeps the
      // requested proportions, and the topic's own counts break ties.
      const uncovered = stages.filter(([name]) => !used(`stage:${name}`));
      const stage =
        proportional(
          uncovered.some(([, weight]) => weight > 0) ? uncovered : stages,
          (name) => runUsed(`stage:${name}`),
          (name) => used(`stage:${name}`),
        ) ?? plannedStages[0];
      const options = cohort === 'core' ? plan.options : plan.options.filter(claimable);
      const facet = isNonEmpty(options) ? nextFacet(plan, options) : null;
      const market =
        isNonEmpty(markets) && plan.located + 1 <= share * plan.cells
          ? markets.reduce((best, option) =>
              used(`market:${option}`) < used(`market:${best}`) ? option : best,
            )
          : '';
      if (market) plan.located += 1;
      for (const key of [
        ...(facet ? [facetKey(facet), `dimension:${facet.dimension}`] : []),
        `stage:${stage}`,
        ...(market ? [`market:${market}`] : []),
      ])
        count(plan.usage, key);
      count(run, `stage:${stage}`);
      count(run, `cohort:${cohort}`);
      count(run, `${cohort}:topic:${plan.topic.id}`);
      count(run, `topic:${plan.topic.id}`);
      const need: Record<string, string> = { offering: plan.offering };
      const reviewState: CellReviewState = facet?.source ?? 'not_applicable';
      if (facet) need[facets[facet.dimension]!] = facet.value;
      if (market) need.market = market;
      const grounding = groundingFor(searches.get(plan.topic.id) ?? [], need);
      return {
        slot_id: `q${index + 1}`,
        cohort,
        topic_id: plan.topic.id,
        topic_name: plan.topic.name,
        topic_description: plan.topic.description,
        buyer_need: need,
        target_buyer_stage: stage,
        allowed_prompt_intents:
          cohort === 'comparison' ? ['compare'] : Object.keys(G.intent_legacy),
        target_prompt_intents: G.stage_intents[stage] ?? [],
        evidence_ref: {
          kind: 'business_map_cell',
          ...need,
          target_buyer_stage: stage,
          review_state: reviewState,
          evidence_type: 'hypothesis',
        },
        ...(grounding.length ? { grounding } : {}),
        ...(cohort === 'brand_diagnostic' ? { grounded_attributes: plan.claims } : {}),
      };
    },
  );
}

/**
 * A slot as a draft batch receives it: grounding becomes example wording,
 * without row identities, and a slot without grounding is sent unchanged. A
 * branded slot's grounded attributes stay with the judge: the drafter writes
 * from the cell and the brief's offerings, so it cannot stack them.
 */
export function modelSlot({ grounding, grounded_attributes: _claims, ...slot }: Slot) {
  return grounding?.length
    ? { ...slot, buyer_search_examples: grounding.map((example) => example.text) }
    : slot;
}

/**
 * What a quick-generate draft batch knows about the business: category,
 * offerings, closed facets and register, plus the request's note for the run.
 * No prose, sources or demand signals, so the wording follows the planned cell
 * rather than the profile. Only branded cohorts see the brand's name, and only
 * comparisons its competitors' names: core drafts must name neither. The only
 * observed data a batch sees is a grounded slot's example searches.
 */
export function generationBrief(
  context: GenerationContext,
  input: Pick<GenerationInput, 'run_context'>,
  cohort: GenerationCohort = 'core',
) {
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
    ...(input.run_context ? { run_context: input.run_context } : {}),
    ...(cohort === 'core' ? {} : { brand_name: context.context.brand_name }),
    ...(cohort === 'comparison'
      ? { competitors: context.context.competitors.map((row) => row.name) }
      : {}),
  };
}
