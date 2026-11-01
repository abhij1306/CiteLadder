/**
 * The Prompt Builder's "About your business" step as data: a draft read from
 * the saved brand profile and business map, and the edits each owner needs
 * to save it. Only changed fields are sent, because the API marks every sent
 * field reviewed; map suggestions keep their state until a person confirms.
 */
import { businessModelSchema, marketScopeSchema } from '@citeladder/contracts/project';
import { z } from 'zod';

import type { BrandProfileUpdateInput, BusinessMapUpdateInput } from '@/lib/api/projects';
import type { BrandProfile, BusinessMap } from '@/lib/api/types';

type BusinessModel = z.infer<typeof businessModelSchema>;
type OfferingMapDraft = BusinessMapUpdateInput['offerings'][number];
export type MapEntryDraft = OfferingMapDraft['audiences'][number];

export type BusinessDraft = {
  offerings: string[];
  buyerRoles: string[];
  serviceAreas: string[];
  categoryTerms: string[];
  jobs: string[];
  businessModel: BusinessModel | null;
  /**
   * One map per offering, in offering order. Exclusions ride along unedited
   * (generation reads none) and drop when an entry they name is removed.
   */
  maps: OfferingMapDraft[];
};

/** The business-context lists the builder edits, each with its API field. */
const CONTEXT_LISTS = [
  ['buyerRoles', 'buyer_roles'],
  ['serviceAreas', 'service_areas'],
  ['categoryTerms', 'category_terms'],
  ['jobs', 'jobs_to_be_done'],
] as const satisfies readonly (readonly [keyof BusinessDraft, keyof BrandProfileUpdateInput])[];

const stringList = z.array(z.string()).catch([]);
const sameValue = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** An offering's saved map, or an empty one for an offering the map has not described yet. */
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
  return {
    offerings: [...profile.products_services],
    buyerRoles: stringList.parse(context.buyer_roles),
    serviceAreas: stringList.parse(context.service_areas),
    categoryTerms: stringList.parse(context.category_terms),
    jobs: stringList.parse(context.jobs_to_be_done),
    businessModel: model.success ? model.data : null,
    maps: profile.products_services.map((offering) => offeringMap(map, offering)),
  };
}

/** The draft with `offerings` replaced; maps follow, a new offering starting empty. */
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

/** Places only appear in prompts for a local or regional business. */
export function showsServiceAreas(context: Record<string, unknown>): boolean {
  const scope = marketScopeSchema.safeParse(context.market_scope);
  return scope.success && (scope.data === 'local' || scope.data === 'regional');
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The brand-profile fields the draft changed; empty when nothing did. */
export function profileChanges(
  draft: BusinessDraft,
  saved: BusinessDraft,
): BrandProfileUpdateInput {
  const update: BrandProfileUpdateInput = {};
  if (!same(draft.offerings, saved.offerings)) update.products_services = draft.offerings;
  if (draft.businessModel && draft.businessModel !== saved.businessModel)
    update.business_model = draft.businessModel;
  for (const [key, field] of CONTEXT_LISTS)
    if (!same(draft[key], saved[key])) update[field] = draft[key];
  return update;
}

/** Exclusions that still name two remaining entries of their offering. */
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

const MAP_DIMENSIONS = ['audiences', 'situations', 'attributes'] as const;

/**
 * The full business-map edit when any offering's audiences, situations or
 * attributes changed, else null. It covers exactly the draft's offerings, so
 * the map never names one the profile no longer lists.
 */
export function mapChanges(
  draft: BusinessDraft,
  saved: BusinessDraft,
): BusinessMapUpdateInput | null {
  const changed = draft.maps.some((map) => {
    const prior = saved.maps.find((item) => sameValue(item.offering, map.offering));
    return !prior || MAP_DIMENSIONS.some((key) => !same(map[key], prior[key]));
  });
  if (!changed) return null;
  return { offerings: draft.maps.map((map) => ({ ...map, exclusions: liveExclusions(map) })) };
}

/** Who the run may balance across: buyer roles, then each offering's audiences, once each. */
export function personaChoices(draft: BusinessDraft): string[] {
  const choices: string[] = [];
  for (const value of [
    ...draft.buyerRoles,
    ...draft.maps.flatMap((map) => map.audiences.map((entry) => entry.value)),
  ])
    if (!choices.some((choice) => sameValue(choice, value))) choices.push(value);
  return choices;
}
