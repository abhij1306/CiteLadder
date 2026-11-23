import { z } from 'zod';
import { auditLaunchRequestSchema } from '@citeladder/contracts/audit-requests';
import { auditScopeSchema } from '@citeladder/contracts/audits';
import { auditPolicy } from './config.ts';
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
  market_ids: marketIdsInput,
});
const selectedPrompts = (input: { prompt_set_id?: string | null; prompt_ids: string[] }) =>
  Boolean(input.prompt_set_id || input.prompt_ids.length);
export const auditRequestInput = auditFields.refine(
  selectedPrompts,
  'Select a prompt set or prompt IDs',
);
export const auditInput = auditFields
  .extend({ audit_scope: auditScopeSchema.default('brand') })
  .refine(selectedPrompts, 'Select a prompt set or prompt IDs');
export const auditLaunchInput = auditFields
  .omit({ project_id: true })
  .extend({ max_attempts: z.int().min(1) })
  .refine(selectedPrompts, 'Select a prompt set or prompt IDs');
export const auditLaunchDraft = auditFields
  .omit({ project_id: true })
  .refine(selectedPrompts, 'Select a prompt set or prompt IDs');
export type AuditInput = z.output<typeof auditInput>;
