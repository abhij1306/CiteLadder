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
  cohort: GenerationCohort;
  topic_id: string;
  topic_name: string;
  topic_description: string;
  buyer_need: Record<string, string>;
  target_buyer_stage: string;
  allowed_prompt_intents: string[];
  target_prompt_intents?: string[];
  evidence_ref: Record<string, unknown>;
  grounding?: Grounding[];
  grounded_attributes?: string[];
};
type Grounding = Pick<
  ObservedQuery,
  'id' | 'source' | 'text' | 'classifier_version' | 'override_id'
>;
type FacetSource = 'confirmed' | 'suggested' | 'requested';
type Facet = { dimension: number; value: string; source: FacetSource };
type CellReviewState = FacetSource | 'not_applicable';
type PlanContext = Pick<GenerationContext, 'selected' | 'topics' | 'maps' | 'observed'> & {
  context: Pick<GenerationContext['context'], 'business_context'>;
};

const business = (context: Pick<PlanContext, 'context'>) =>
  record(context.context.business_context);
const ATTRIBUTE = dimensions.indexOf('attributes');

export const topicLinks = z.record(z.string(), z.array(z.string())).catch({});

export function topicOfferings(
  values: Record<string, unknown>,
  topic: { id: string; name: string },
): string[] {
  const linked = topicLinks.parse(values.topic_offerings ?? {})[topic.id] ?? [];
  return linked.length ? linked : [topic.name];
}

export function topicWeights(
  context: Pick<PlanContext, 'selected' | 'context'>,
): Map<string, number> {
  const values = business(context);
  return new Map(
    context.selected.map((topic) => [topic.id, Math.max(1, topicOfferings(values, topic).length)]),
  );
}

function locationShare(context: PlanContext): number {
  return G.location_policy[String(business(context).market_scope)] ?? 0;
}

function plannedMarkets(context: PlanContext): string[] {
  return locationShare(context) > 0 ? [...new Set(strings(business(context).service_areas))] : [];
}

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
const distinctFacets = (facets: readonly Facet[]) => [
  ...new Map(facets.map((facet) => [facet.value.toLowerCase(), facet])).values(),
];

type Planner = {
  topic: GenerationContext['selected'][number];
  offering: string;
  options: Facet[];
  claims: string[];
  cells: number;
  located: number;
  usage: Map<string, number>;
};

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

function nextFacet(plan: Planner, options: NonEmpty<Facet>): Facet {
  const used = (key: string) => plan.usage.get(key) ?? 0;
  const compare = (a: Facet, b: Facet) =>
    used(facetKey(a)) - used(facetKey(b)) ||
    used(`dimension:${a.dimension}`) - used(`dimension:${b.dimension}`) ||
    Number(a.source === 'suggested') - Number(b.source === 'suggested');
  return options.reduce((best, facet) => (compare(facet, best) < 0 ? facet : best));
}

function stageWeights(input: GenerationInput): [string, number][] {
  const mix = input.distribution?.intent_mix;
  return G.planned_stages.map((stage) => {
    if (!mix) return [stage, 1];
    const shares = Object.entries(mix).filter(([intent]) => G.intent_mix_stages[intent] === stage);
    return [stage, shares.reduce((sum, [, share]) => sum + share, 0)];
  });
}

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

type TokenizedSearch = { query: ObservedQuery; tokens: Set<string> };
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
  return searches
    .map(({ query, tokens }) => ({ query, shared: sharedTokens(tokens, cell) }))
    .toSorted((a, b) => b.shared - a.shared)
    .slice(0, G.observed.examples_per_slot)
    .map(({ query: { id, source, text, classifier_version, override_id } }) => ({
      id,
      source,
      text,
      classifier_version,
      override_id,
    }));
}

const claimable = (facet: Facet) => facet.dimension !== ATTRIBUTE || facet.source === 'confirmed';

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

export function modelSlot({ grounding, grounded_attributes: _claims, ...slot }: Slot) {
  return grounding?.length
    ? { ...slot, buyer_search_examples: grounding.map((example) => example.text) }
    : slot;
}

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
