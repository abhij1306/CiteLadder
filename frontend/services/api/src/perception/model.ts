import { z } from 'zod';
import { perceptionLabelSchema } from '@citeladder/contracts/visibility-perception';

import type { FactCheckPolicy, PerceptionPolicy } from '../config/perception.ts';
import type { PerceptionPackage } from './passages.ts';

export const LABELS = perceptionLabelSchema.options;
export type Label = (typeof LABELS)[number];

export const perceptionOutputSchema = z.object({
  entities: z.array(
    z.object({
      entity_id: z.string(),
      label: z.enum(LABELS),
      confidence: z.number().min(0).max(1),
      aspects: z.array(
        z.object({
          category: z.string(),
          attribute: z.string(),
          polarity: z.enum(['positive', 'negative']),
          quote: z.string(),
        }),
      ),
    }),
  ),
  untracked_businesses: z.array(z.string()).optional(),
});
export type PerceptionOutput = z.infer<typeof perceptionOutputSchema>;

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

type ClaimsRequest = Pick<
  FactCheckPolicy,
  'topics' | 'max_claims_per_answer' | 'claims_system_addendum' | 'claims_user_addendum'
>;

export function perceptionPrompt(
  pkg: PerceptionPackage,
  policy: Pick<
    PerceptionPolicy,
    | 'system_template'
    | 'user_template'
    | 'project_themes'
    | 'max_aspects_per_entity'
    | 'max_aspects_per_brand'
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
    '{categories}': [...pkg.themes.map((theme) => theme.name), policy.project_themes.fallback].join(
      ', ',
    ),
    '{max_brand_aspects}': String(policy.max_aspects_per_brand),
    '{max_aspects}': String(policy.max_aspects_per_entity),
    '{entities}': JSON.stringify(entities, null, 2),
  };
  const user = policy.user_template.replaceAll(
    /\{(?:prompt|language|categories|max_brand_aspects|max_aspects|entities)\}/gu,
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
