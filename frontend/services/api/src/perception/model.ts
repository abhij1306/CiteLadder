/** The perception model request: rendered templates and the structured output it must return. */
import { z } from 'zod';
import { perceptionLabelSchema } from '@citeladder/contracts/visibility-perception';

import type { FactCheckPolicy, PerceptionPolicy } from '../config/perception.ts';
import type { PerceptionPackage } from './passages.ts';

export const LABELS = perceptionLabelSchema.options;
export type Label = (typeof LABELS)[number];

// Lenient on counts and themes: the deterministic validator truncates and
// remaps them, so one extra aspect never discards a whole answer.
export const perceptionOutputSchema = z.object({
  entities: z.array(
    z.object({
      entity_id: z.string(),
      label: z.enum(LABELS),
      confidence: z.number().min(0).max(1),
      aspects: z.array(
        z.object({
          theme: z.string(),
          polarity: z.enum(['positive', 'negative']),
          quote: z.string(),
        }),
      ),
    }),
  ),
});
export type PerceptionOutput = z.infer<typeof perceptionOutputSchema>;

// A fact-checked audit's output adds the brand's factual claims. A missing
// list is unusable output, never zero claims; topic and count stay lenient for
// the same reason as aspects.
export const claimsOutputSchema = perceptionOutputSchema.extend({
  claims: z.array(
    z.object({
      topic: z.string(),
      claim: z.string(),
      quote: z.string(),
      confidence: z.number().min(0).max(1),
    }),
  ),
});
type ClaimsOutput = z.infer<typeof claimsOutputSchema>;
export type ExtractedClaim = ClaimsOutput['claims'][number];

/** The claims addendum a fact-checked audit appends to the perception templates. */
type ClaimsRequest = Pick<
  FactCheckPolicy,
  'topics' | 'max_claims_per_answer' | 'claims_system_addendum' | 'claims_user_addendum'
>;

/**
 * The system and user messages for one package; with `claims`, the configured
 * templates followed by the claims addendum, whatever template is in force.
 */
export function perceptionPrompt(
  pkg: PerceptionPackage,
  policy: Pick<
    PerceptionPolicy,
    'system_template' | 'user_template' | 'themes' | 'max_aspects_per_entity'
  >,
  claims: ClaimsRequest | null = null,
) {
  const entities = pkg.entities.map((entity) => ({
    entity_id: entity.entity_id,
    name: entity.name,
    kind: entity.kind,
    passages: entity.spans.map((span) => span.text),
  }));
  const slots: Record<string, string> = {
    '{prompt}': pkg.prompt,
    '{language}': pkg.language || 'unknown',
    '{themes}': policy.themes.join(', '),
    '{max_aspects}': String(policy.max_aspects_per_entity),
    '{entities}': JSON.stringify(entities, null, 2),
  };
  // One pass, so a slot-shaped string inside the answer is never re-substituted.
  const user = policy.user_template.replaceAll(
    /\{(?:prompt|language|themes|max_aspects|entities)\}/gu,
    (slot) => slots[slot]!,
  );
  if (!claims) return { system: policy.system_template, user };
  const addendum = claims.claims_user_addendum.replaceAll(/\{(?:topics|max_claims)\}/gu, (slot) =>
    slot === '{topics}' ? claims.topics.join(', ') : String(claims.max_claims_per_answer),
  );
  return {
    system: `${policy.system_template}\n\n${claims.claims_system_addendum}`,
    user: `${user}\n\n${addendum}`,
  };
}
