import { z } from 'zod';

const pageEntityFields = {
  entity_kind: z.string(),
  entity_name: z.string(),
  match_method: z.string(),
  match_count: z.number().int(),
  passages: z.array(z.string()),
} as const;

export const pageEntitySchema = z.object({
  ...pageEntityFields,
  presence: z.string(),
});
