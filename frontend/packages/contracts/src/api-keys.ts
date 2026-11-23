import { z } from 'zod';

const API_KEY_SCOPES = [
  'read',
  'prompts:write',
  'competitors:write',
  'audits:run',
  'schedules:write',
  'actions:write',
] as const;
export const apiKeyScopeSchema = z.enum(API_KEY_SCOPES);
export type ApiKeyScope = z.infer<typeof apiKeyScopeSchema>;

const apiKeyStateSchema = z.enum(['active', 'expired', 'revoked']);

export const apiKeySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  prefix: z.string(),
  scopes: z.array(apiKeyScopeSchema),
  project_ids: z.array(z.uuid()).nullable(),
  created_by_email: z.string().nullable(),
  created_at: z.string(),
  expires_at: z.string().nullable(),
  last_used_at: z.string().nullable(),
  revoked_at: z.string().nullable(),
  state: apiKeyStateSchema,
});
export type ApiKey = z.infer<typeof apiKeySchema>;

export const apiKeyListSchema = z.object({
  keys: z.array(apiKeySchema),
});
export type ApiKeyList = z.infer<typeof apiKeyListSchema>;

export const apiKeyCreateSchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
  scopes: z.array(apiKeyScopeSchema).default([]),
  project_ids: z.array(z.uuid()).min(1).max(100).nullable().default(null),
  expires_at: z.iso.datetime({ offset: true }).nullable().default(null),
});
export type ApiKeyCreate = z.input<typeof apiKeyCreateSchema>;

export const apiKeyCreatedSchema = z.object({ key: apiKeySchema, secret: z.string() });
export type ApiKeyCreated = z.infer<typeof apiKeyCreatedSchema>;
