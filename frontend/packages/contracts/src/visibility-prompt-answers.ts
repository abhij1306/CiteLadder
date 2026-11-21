import { z } from 'zod';

import { answerFormatsSchema, firstNamedSchema, promptAnswerSearchSchema } from './audits.ts';
import { namedBrandSchema } from './visibility.ts';

export const promptAnswerBrandSchema = namedBrandSchema.omit({ responses: true });

export const promptAnswerSchema = z.object({
  execution_id: z.uuid(),
  audit_id: z.uuid(),
  run_at: z.string(),
  logical_engine: z.string(),
  brands: z.array(promptAnswerBrandSchema),
  first_named: firstNamedSchema,
  brand_mentioned: z.boolean(),
  position: z.number().int().nullable(),
  cited: z.boolean(),
  search: promptAnswerSearchSchema,
  answer_formats: answerFormatsSchema,
});

export const promptAnswerPageSchema = z.object({
  market_id: z.uuid().nullable(),
  items: z.array(promptAnswerSchema),
  next_cursor: z.string().nullable(),
});

export type PromptAnswer = z.infer<typeof promptAnswerSchema>;
export type PromptAnswerPage = z.infer<typeof promptAnswerPageSchema>;
