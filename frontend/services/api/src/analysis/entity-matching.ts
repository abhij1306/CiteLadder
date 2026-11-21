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
const storedMatching = z
  .object({ entities: z.record(z.string(), entityPolicy).default({}) })
  .catch({ entities: {} });

export type MatchedEntity = { name: string; aliases: readonly string[] };
export type EffectivePolicy = EntityPolicy & { common_word: boolean };

export const entityKey = (name: string) => normalizeAlias(name);

function commonWordName(entity: MatchedEntity): boolean {
  return [entity.name, ...entity.aliases].some((name) => {
    const only = onlyOf(normalizeAlias(name).split(' ').filter(Boolean));
    return only !== undefined && COMMON_WORDS.has(only);
  });
}

export function storedEntityMatching(businessContext: unknown): Record<string, EntityPolicy> {
  return storedMatching.parse(record(businessContext).entity_matching ?? {}).entities;
}

function contextSeeds(businessContext: unknown, offerings: readonly string[]): string[] {
  const business = record(businessContext);
  return [
    ...new Set([...strings(business.category_terms), ...offerings].map((term) => term.trim())),
  ]
    .filter(Boolean)
    .slice(0, A.entity_context_seed_max);
}

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

export const matchingBlock = (entities: Record<string, EntityPolicy>) => ({
  version: A.entity_matching_version,
  entities,
});

export function frozenEntityMatching(effective: Record<string, EffectivePolicy>) {
  return matchingBlock(
    Object.fromEntries(
      Object.entries(effective).map(([key, { common_word: _common, ...rule }]) => [key, rule]),
    ),
  );
}
