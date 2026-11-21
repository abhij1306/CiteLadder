import { z } from 'zod';

import type { PerceptionPolicy } from '../config/perception.ts';
import { cleanName, nameKey } from './themes.ts';

export const themeCandidates = z
  .array(
    z.object({
      name: z.string(),
      kind: z.enum(['buyer_choice', 'company_fact']),
      confidence: z.number().min(0).max(1),
    }),
  )
  .default([]);
type Candidate = z.output<typeof themeCandidates>[number];

const words = (text: string) =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

export function researchThemes(
  identity: { themes: readonly Candidate[] } | null,
  limits: PerceptionPolicy['project_themes'],
): string[] {
  const candidates = identity?.themes ?? [];
  const facts = limits.company_fact_terms.map((term) => ` ${words(term).join(' ')} `);
  const seen = new Set([nameKey(limits.fallback)]);
  return candidates
    .filter(
      (candidate) =>
        candidate.kind === 'buyer_choice' && candidate.confidence >= limits.research_min_confidence,
    )
    .toSorted((a, b) => b.confidence - a.confidence)
    .flatMap((candidate) => {
      const name = cleanName(candidate.name);
      const tokens = words(name);
      const padded = ` ${tokens.join(' ')} `;
      if (
        !tokens.length ||
        tokens.length > limits.research_max_words ||
        name.length > limits.name_max_chars ||
        facts.some((fact) => padded.includes(fact)) ||
        seen.has(nameKey(name))
      )
        return [];
      seen.add(nameKey(name));
      return [name];
    })
    .slice(0, limits.research_max);
}
