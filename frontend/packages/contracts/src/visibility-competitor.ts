import { z } from 'zod';

const competitorSourceSchema = z.object({
  domain: z.string(),
  answers: z.number().int(),
  answers_naming_you: z.number().int(),
});

const namedInsteadSchema = z.object({
  prompt_id: z.uuid().nullable(),
  prompt: z.string(),
  topic: z.string(),
  engines: z.number().int(),
  engines_answered: z.number().int(),
});

export const competitorFocusSchema = z.object({
  competitor: z.object({ id: z.uuid(), name: z.string() }),
  answers: z.number().int(),
  sources: z.array(competitorSourceSchema),
  sources_total: z.number().int(),
  named_instead: z.array(namedInsteadSchema),
  named_instead_total: z.number().int(),
});

export type CompetitorFocus = z.infer<typeof competitorFocusSchema>;
