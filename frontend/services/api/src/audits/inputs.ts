import { z } from 'zod';
import { auditLaunchRequestSchema } from '@citeladder/contracts/audit-requests';
import { auditPolicy } from './config.ts';
/** A launch's markets: distinct ids, `null` for the project default. */
export const marketIdList = z
  .array(z.uuid().nullable())
  .min(1)
  .max(auditPolicy.max_markets_per_launch)
  .refine((ids) => new Set(ids).size === ids.length, 'Markets must be distinct');
export const marketIdsInput = marketIdList.default([null]);
export const repetitionsInput = z
  .number()
  .int()
  .min(auditPolicy.min_repetitions)
  .max(auditPolicy.max_repetitions)
  .nullish();
const auditFields = auditLaunchRequestSchema.extend({
  repetitions: repetitionsInput,
  /** One audit per market; `null` is the project's default market. */
  market_ids: marketIdsInput,
});
const selectedPrompts = (input: { prompt_set_id?: string | null; prompt_ids: string[] }) =>
  Boolean(input.prompt_set_id || input.prompt_ids.length);
export const auditInput = auditFields.refine(selectedPrompts, 'Select a prompt set or prompt IDs');
/**
 * A public API launch: the project comes from the path, and the caller caps the
 * estimate's maximum attempt count (every answer times its retry budget).
 */
export const auditLaunchInput = auditFields
  .omit({ project_id: true })
  .extend({ max_attempts: z.int().min(1) })
  .refine(selectedPrompts, 'Select a prompt set or prompt IDs');
export type AuditInput = z.output<typeof auditInput>;
