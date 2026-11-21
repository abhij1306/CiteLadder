import { businessModelSchema, marketScopeSchema } from '@citeladder/contracts/project';
import { z } from 'zod';

import type {
  BrandProfileUpdateRequest,
  BusinessMapOfferingEdit,
  BusinessMapUpdateRequest,
} from '@citeladder/contracts/project-requests';
import type { BrandProfile, BusinessMap } from '@citeladder/contracts';

type BusinessModel = z.infer<typeof businessModelSchema>;
type OfferingMapDraft = BusinessMapOfferingEdit;
export type MapEntryDraft = OfferingMapDraft['audiences'][number];

export type BusinessDraft = {
  offerings: string[];
  buyerRoles: string[];
  serviceAreas: string[];
  categoryTerms: string[];
  jobs: string[];
  businessModel: BusinessModel | null;
  maps: OfferingMapDraft[];
  suggested: SuggestedField[];
};

const CONTEXT_LISTS = [
  ['buyerRoles', 'buyer_roles'],
  ['serviceAreas', 'service_areas'],
  ['categoryTerms', 'category_terms'],
  ['jobs', 'jobs_to_be_done'],
] as const satisfies readonly (readonly [keyof BusinessDraft, keyof BrandProfileUpdateRequest])[];

export type ContextListKey = (typeof CONTEXT_LISTS)[number][0];
export type SuggestedField = ContextListKey | 'businessModel';

const stringList = z.array(z.string()).catch([]);
const fieldSources = z.record(z.string(), z.unknown()).catch({});
const sameValue = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

function offeringMap(map: BusinessMap, offering: string): OfferingMapDraft {
  const saved = map.offerings.find((item) => sameValue(item.offering, offering));
  const entries = (key: 'attributes' | 'situations' | 'audiences') =>
    (saved?.[key] ?? []).map(({ value, review_state }) => ({ value, review_state }));
  return {
    offering,
    attributes: entries('attributes'),
    situations: entries('situations'),
    audiences: entries('audiences'),
    exclusions: saved?.exclusions ?? [],
  };
}

export function businessDraft(profile: BrandProfile, map: BusinessMap): BusinessDraft {
  const context = profile.business_context;
  const model = businessModelSchema.safeParse(context.business_model);
  const fields = {
    buyerRoles: stringList.parse(context.buyer_roles),
    serviceAreas: stringList.parse(context.service_areas),
    categoryTerms: stringList.parse(context.category_terms),
    jobs: stringList.parse(context.jobs_to_be_done),
    businessModel: model.success ? model.data : null,
  };
  const sources = fieldSources.parse(context.field_sources ?? {});
  const hidden = (key: SuggestedField) => key === 'serviceAreas' && !showsServiceAreas(context);
  const inferred = (key: SuggestedField, field: keyof BrandProfileUpdateRequest) =>
    sources[field] !== 'reviewed' &&
    !hidden(key) &&
    (key === 'businessModel' ? fields[key] : fields[key].length);
  return {
    offerings: [...profile.products_services],
    ...fields,
    maps: profile.products_services.map((offering) => offeringMap(map, offering)),
    suggested: [
      ...CONTEXT_LISTS.filter(([key, field]) => inferred(key, field)).map(([key]) => key),
      ...(inferred('businessModel', 'business_model') ? ['businessModel' as const] : []),
    ],
  };
}

const MAP_DIMENSIONS = ['audiences', 'situations', 'attributes'] as const;
export type MapDimension = (typeof MAP_DIMENSIONS)[number];

const confirmed = (entries: readonly MapEntryDraft[]): MapEntryDraft[] =>
  entries.map((entry) => ({ ...entry, review_state: 'confirmed' }));

export function withField<K extends SuggestedField>(
  draft: BusinessDraft,
  key: K,
  value: BusinessDraft[K],
): BusinessDraft {
  return { ...draft, [key]: value, suggested: draft.suggested.filter((item) => item !== key) };
}

export function acceptCell(map: OfferingMapDraft, dimension: MapDimension): OfferingMapDraft {
  return { ...map, [dimension]: confirmed(map[dimension]) };
}

export function acceptAll(draft: BusinessDraft): BusinessDraft {
  return {
    ...draft,
    suggested: [],
    maps: draft.maps.map((map) =>
      MAP_DIMENSIONS.reduce((next, dimension) => acceptCell(next, dimension), map),
    ),
  };
}

export function suggestionCount(draft: BusinessDraft): number {
  const fields = draft.suggested.reduce(
    (sum, key) => sum + (key === 'businessModel' ? 1 : draft[key].length),
    0,
  );
  const entries = draft.maps
    .flatMap((map) => MAP_DIMENSIONS.flatMap((dimension) => map[dimension]))
    .filter((entry) => entry.review_state === 'suggested').length;
  return fields + entries;
}

export function withOfferings(
  draft: BusinessDraft,
  offerings: string[],
  map: BusinessMap,
): BusinessDraft {
  return {
    ...draft,
    offerings,
    maps: offerings.map(
      (offering) =>
        draft.maps.find((item) => sameValue(item.offering, offering)) ?? offeringMap(map, offering),
    ),
  };
}

export function showsServiceAreas(context: Record<string, unknown>): boolean {
  const scope = marketScopeSchema.safeParse(context.market_scope);
  return scope.success && (scope.data === 'local' || scope.data === 'regional');
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function profileChanges(
  draft: BusinessDraft,
  saved: BusinessDraft,
): BrandProfileUpdateRequest {
  const accepted = (key: SuggestedField) =>
    saved.suggested.includes(key) && !draft.suggested.includes(key);
  const update: BrandProfileUpdateRequest = {};
  if (!same(draft.offerings, saved.offerings)) update.products_services = draft.offerings;
  if (
    draft.businessModel &&
    (draft.businessModel !== saved.businessModel || accepted('businessModel'))
  )
    update.business_model = draft.businessModel;
  for (const [key, field] of CONTEXT_LISTS)
    if (!same(draft[key], saved[key]) || accepted(key)) update[field] = draft[key];
  return update;
}

function liveExclusions(map: OfferingMapDraft): OfferingMapDraft['exclusions'] {
  const values = new Set(
    [...map.attributes, ...map.situations, ...map.audiences].map((entry) =>
      entry.value.toLowerCase(),
    ),
  );
  return map.exclusions.filter(
    (pair) => values.has(pair.first.toLowerCase()) && values.has(pair.second.toLowerCase()),
  );
}

export function mapChanges(
  draft: BusinessDraft,
  saved: BusinessDraft,
): BusinessMapUpdateRequest | null {
  const changed = draft.maps.some((map) => {
    const prior = saved.maps.find((item) => sameValue(item.offering, map.offering));
    return !prior || MAP_DIMENSIONS.some((key) => !same(map[key], prior[key]));
  });
  if (!changed) return null;
  return { offerings: draft.maps.map((map) => ({ ...map, exclusions: liveExclusions(map) })) };
}

export function personaChoices(draft: BusinessDraft): string[] {
  const choices: string[] = [];
  for (const value of [
    ...draft.buyerRoles,
    ...draft.maps.flatMap((map) => map.audiences.map((entry) => entry.value)),
  ])
    if (!choices.some((choice) => sameValue(choice, value))) choices.push(value);
  return choices;
}
