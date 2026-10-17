/**
 * The editable business map: per-offering facts that ground prompt generation.
 *
 * Stored in `brand_profiles.business_context.business_map`. Entries carry
 * provenance: generation adds model suggestions (`suggested`) to
 * offerings whose map is empty, under the project advisory lock; only a
 * person confirms them, here, under the same lock.
 */
import { businessMapSchema, offeringMapSchema } from '@citeladder/contracts/project';
import { z } from 'zod';

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { jsonObject } from '../db/json.ts';
import { ApiError } from '../errors.ts';
import { acquireProjectLock } from '../prompts/locks.ts';
import { loadProfile, profileProducts, type ProjectScope } from './brand-profile.ts';

type BusinessMap = z.infer<typeof businessMapSchema>;
type OfferingMap = z.infer<typeof offeringMapSchema>;
type Entry = OfferingMap['attributes'][number];
type Exclusion = OfferingMap['exclusions'][number];

const DIMENSIONS = ['attributes', 'situations', 'audiences'] as const;
const {
  map_value_max_chars: VALUE_MAX,
  map_max_entries_per_dimension: ENTRIES_MAX,
  map_max_exclusions: EXCLUSIONS_MAX,
} = policy.brand_identity;

const mapValue = z.string().trim().min(1).max(VALUE_MAX);
const entryInput = z.object({
  value: mapValue,
  // Keeping a suggestion unconfirmed is allowed; a new entry is always a
  // confirmed manual fact, whatever the request says.
  review_state: z.enum(['suggested', 'confirmed']).default('confirmed'),
});
const dimensionInput = z.array(entryInput).max(ENTRIES_MAX).default([]);
const exclusionInput = z.object({ first: mapValue, second: mapValue });

export const businessMapUpdate = z.object({
  offerings: z
    .array(
      z.object({
        offering: mapValue,
        attributes: dimensionInput,
        situations: dimensionInput,
        audiences: dimensionInput,
        exclusions: z.array(exclusionInput).max(EXCLUSIONS_MAX).default([]),
      }),
    )
    .default([]),
});
type BusinessMapUpdate = z.infer<typeof businessMapUpdate>;
type EntryInput = z.infer<typeof entryInput>;

const storedMap = z.object({ offerings: z.array(offeringMapSchema).default([]) });

const key = (value: string) => value.toLowerCase();

function storedOfferings(businessContext: Record<string, unknown>): OfferingMap[] {
  return storedMap.parse(businessContext.business_map ?? {}).offerings;
}

function invalid(message: string): never {
  throw new ApiError(422, message);
}

function mergeEntry(requested: EntryInput, prior: Entry | undefined, reviewer: Reviewer): Entry {
  if (prior === undefined)
    return {
      value: requested.value,
      origin: 'manual',
      review_state: 'confirmed',
      reviewed_by: reviewer.userId,
      reviewed_at: reviewer.at,
      source: {},
    };
  const confirming = prior.review_state === 'suggested' && requested.review_state === 'confirmed';
  return {
    ...prior,
    value: requested.value,
    ...(confirming
      ? { review_state: 'confirmed', reviewed_by: reviewer.userId, reviewed_at: reviewer.at }
      : {}),
  };
}

type Reviewer = { userId: string; at: string };

function mergeDimension(requested: EntryInput[], prior: Entry[], reviewer: Reviewer): Entry[] {
  const priorByKey = new Map(prior.map((entry) => [key(entry.value), entry]));
  const merged = new Map<string, Entry>();
  for (const entry of requested) {
    const entryKey = key(entry.value);
    if (!merged.has(entryKey))
      merged.set(entryKey, mergeEntry(entry, priorByKey.get(entryKey), reviewer));
  }
  return [...merged.values()];
}

/** Each exclusion names two distinct entries of its offering; repeats collapse. */
function checkedExclusions(offering: Omit<OfferingMap, 'exclusions'>, exclusions: Exclusion[]) {
  const known = new Set(
    DIMENSIONS.flatMap((dimension) => offering[dimension].map((entry) => key(entry.value))),
  );
  const kept = new Map<string, Exclusion>();
  for (const exclusion of exclusions) {
    const [first, second] = [key(exclusion.first), key(exclusion.second)];
    const pair = first < second ? [first, second] : [second, first];
    if (first === second || !pair.every((item) => known.has(item)))
      invalid(`Exclusions for "${offering.offering}" must name two of its entries`);
    const pairKey = JSON.stringify(pair);
    if (!kept.has(pairKey)) kept.set(pairKey, exclusion);
  }
  return [...kept.values()];
}

function mergeBusinessMap(
  update: BusinessMapUpdate,
  prior: OfferingMap[],
  offerings: string[],
  reviewer: Reviewer,
): OfferingMap[] {
  const allowed = new Map(offerings.map((name) => [key(name), name]));
  const priorByOffering = new Map(prior.map((item) => [key(item.offering), item]));
  const result = new Map<string, OfferingMap>();
  for (const item of update.offerings) {
    const offeringKey = key(item.offering);
    const name = allowed.get(offeringKey);
    if (name === undefined) invalid(`"${item.offering}" is not one of this brand's offerings`);
    if (result.has(offeringKey)) invalid(`"${item.offering}" appears twice`);
    const previous = priorByOffering.get(offeringKey);
    const merged = {
      offering: name,
      attributes: mergeDimension(item.attributes, previous?.attributes ?? [], reviewer),
      situations: mergeDimension(item.situations, previous?.situations ?? [], reviewer),
      audiences: mergeDimension(item.audiences, previous?.audiences ?? [], reviewer),
    };
    result.set(offeringKey, { ...merged, exclusions: checkedExclusions(merged, item.exclusions) });
  }
  return [...result.values()];
}

export async function readBusinessMap(db: Database, scope: ProjectScope): Promise<BusinessMap> {
  const profile = await loadProfile(db, scope);
  const context = jsonObject(profile.business_context, 'brand_profiles.business_context');
  return { offerings: storedOfferings(context), available_offerings: profileProducts(profile) };
}

/** Replace the map; surviving entries keep their provenance. */
export function updateBusinessMap(
  db: Database,
  scope: ProjectScope,
  userId: string,
  update: BusinessMapUpdate,
): Promise<BusinessMap> {
  return db.transaction().execute(async (trx) => {
    await acquireProjectLock(trx, scope.projectId);
    const profile = await loadProfile(trx, scope, true);
    const context = jsonObject(profile.business_context, 'brand_profiles.business_context');
    const offerings = profileProducts(profile);
    const now = new Date();
    const merged = mergeBusinessMap(update, storedOfferings(context), offerings, {
      userId,
      at: now.toISOString(),
    });
    // Replace only the map key, so every other persisted fact is untouched.
    await trx
      .updateTable('brand_profiles')
      .set({
        business_context: JSON.stringify({ ...context, business_map: { offerings: merged } }),
        updated_at: now,
      })
      .where('id', '=', profile.id)
      .execute();
    return { offerings: merged, available_offerings: offerings };
  });
}
