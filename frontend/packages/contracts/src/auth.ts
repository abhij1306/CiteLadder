import { z } from 'zod';

// ---------------------------------------------------------------------------
// Local user / workspace
// ---------------------------------------------------------------------------

// `role` is the account-level `users.role` (free-form string), a different axis
// from the per-workspace membership role carried on `workspaceSchema.role`.
export const sessionUserSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  role: z.string(),
  is_active: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});

// `me` returns the local user the install acts as.
export const authResponseSchema = z.object({ user: sessionUserSchema });

// The caller's membership `role` and the effective `capabilities` that role
// confers. Controls may be hidden from them; the server still enforces every denial.
export const workspaceSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  role: z.string(),
  capabilities: z.array(z.string()),
  created_at: z.string(),
  updated_at: z.string(),
});
