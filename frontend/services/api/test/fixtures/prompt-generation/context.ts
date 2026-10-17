/** Business-context fixtures as generation contexts, for planner tests and live calibration. */
import type { GenerationContext } from '../../../src/prompts/generation-context.ts';
import fixtures from './contexts.json' with { type: 'json' };

export type GenerationFixture = (typeof fixtures)[number];
export { fixtures as generationFixtures };

/** A deterministic topic UUID for the offering at `index`. */
export const fixtureTopicId = (index: number) =>
  `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;

/**
 * A fixture's synthetic observed searches, bound to their offering's topic, as
 * the loader would return them for a project with Search Console data.
 */
export function fixtureObserved(fixture: GenerationFixture): GenerationContext['observed'] {
  return fixture.observed_queries.map((query, index) => ({
    id: `00000000-0000-4000-9000-${String(index).padStart(12, '0')}`,
    source: 'gsc' as const,
    text: query.text,
    topic_id: fixtureTopicId(fixture.offerings.indexOf(query.offering)),
    weight: query.weight,
    classifier_version: 'branded-query-1',
    override_id: null,
  }));
}

/**
 * One topic per offering; binding vocabulary from the offering words. A
 * grounded context carries the fixture's observed searches; otherwise none.
 */
export function fixtureContext(
  fixture: GenerationFixture,
  maps: GenerationContext['maps'] = [],
  { grounded = false }: { grounded?: boolean } = {},
): GenerationContext {
  const topics = fixture.offerings.map((name, index) => ({
    id: fixtureTopicId(index),
    name,
    description: '',
    parent_id: null,
  }));
  return {
    selected: topics,
    topics,
    maps,
    matching: {},
    offerings: fixture.offerings,
    prompts: [],
    candidates: [],
    observed: grounded ? fixtureObserved(fixture) : [],
    revision: null,
    vocabulary: {
      tokens: new Set(fixture.offerings.flatMap((name) => name.toLowerCase().split(' '))),
      phrases: new Set<string>(),
    },
    context: {
      brand_name: fixture.brand_name,
      brand_aliases: fixture.brand_aliases,
      competitors: fixture.competitors,
      country_code: fixture.country_code,
      language_code: fixture.language_code,
      business_context: { ...fixture.business_context, products_services: fixture.offerings },
      demand_signals: [],
    },
  } as unknown as GenerationContext;
}
