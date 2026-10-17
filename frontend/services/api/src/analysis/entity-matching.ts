/**
 * Per-project entity matching policy: when a brand or competitor name counts
 * as a mention. Stored in `brand_profiles.business_context.entity_matching`
 * (keyed by normalized entity name), frozen into each audit's configuration at
 * admission, and read back from that frozen copy by analysis.
 *
 * A name that normalizes to one common word ("Target", "Notion", "Next")
 * defaults to `context_required`, seeded with the project's category terms and
 * offerings; every other name defaults to `always`. People override either.
 */
import { entityMatchingModeSchema } from '@citeladder/contracts/project';
import { z } from 'zod';

import { policy } from '../config.ts';
import { record, strings } from '../db/json.ts';
import { normalizeAlias } from './aliases.ts';
import { onlyOf } from '../lists.ts';

const A = policy.audits.analysis;
const COMMON_WORDS = new Set([
  ...A.common_noun_names,
  ...policy.prompts.generation.brand_common_words,
  ...policy.prompts.binding.stopwords,
]);

const entityPolicy = z.object({
  mode: entityMatchingModeSchema,
  context_terms: z.array(z.string()).default([]),
  exclusion_phrases: z.array(z.string()).default([]),
});
export type EntityPolicy = z.infer<typeof entityPolicy>;
// Malformed storage reads as no saved policies.
const storedMatching = z
  .object({ entities: z.record(z.string(), entityPolicy).default({}) })
  .catch({ entities: {} });

export type MatchedEntity = { name: string; aliases: readonly string[] };
export type EffectivePolicy = EntityPolicy & { common_word: boolean };

/** The key an entity's policy is stored and frozen under. */
export const entityKey = (name: string) => normalizeAlias(name);

/** Whether any of the entity's names is a single common word. */
function commonWordName(entity: MatchedEntity): boolean {
  return [entity.name, ...entity.aliases].some((name) => {
    const only = onlyOf(normalizeAlias(name).split(' ').filter(Boolean));
    return only !== undefined && COMMON_WORDS.has(only);
  });
}

/** Policies a person saved, by entity key; malformed storage reads as none. */
export function storedEntityMatching(businessContext: unknown): Record<string, EntityPolicy> {
  return storedMatching.parse(record(businessContext).entity_matching ?? {}).entities;
}

/** Context terms a common-word default starts with: category terms, then offerings. */
function contextSeeds(businessContext: unknown, offerings: readonly string[]): string[] {
  const business = record(businessContext);
  return [
    ...new Set([...strings(business.category_terms), ...offerings].map((term) => term.trim())),
  ]
    .filter(Boolean)
    .slice(0, A.entity_context_seed_max);
}

/** The policy each entity is matched under: saved, else its default. */
function effectiveEntityMatching(
  stored: Record<string, EntityPolicy>,
  entities: readonly MatchedEntity[],
  seeds: readonly string[],
): Record<string, EffectivePolicy> {
  return Object.fromEntries(
    entities
      .filter((entity) => entity.name.trim())
      .map((entity) => {
        const common = commonWordName(entity);
        const saved = stored[entityKey(entity.name)];
        const fallback: EntityPolicy = common
          ? { mode: 'context_required', context_terms: [...seeds], exclusion_phrases: [] }
          : { mode: 'always', context_terms: [], exclusion_phrases: [] };
        return [entityKey(entity.name), { ...(saved ?? fallback), common_word: common }];
      }),
  );
}

/**
 * The policy each of a project's entities is matched under, from its stored
 * business context and offerings. Freezing, project views and generation all
 * read this one composition.
 */
export function projectEntityMatching(
  businessContext: unknown,
  offerings: readonly string[],
  entities: readonly MatchedEntity[],
) {
  return effectiveEntityMatching(
    storedEntityMatching(businessContext),
    entities,
    contextSeeds(businessContext, offerings),
  );
}

/** The stored and frozen `entity_matching` shape. */
export const matchingBlock = (entities: Record<string, EntityPolicy>) => ({
  version: A.entity_matching_version,
  entities,
});

/** The block frozen into an audit's configuration. */
export function frozenEntityMatching(effective: Record<string, EffectivePolicy>) {
  return matchingBlock(
    Object.fromEntries(
      Object.entries(effective).map(([key, { common_word: _common, ...rule }]) => [key, rule]),
    ),
  );
}
