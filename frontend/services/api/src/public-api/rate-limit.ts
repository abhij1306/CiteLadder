/**
 * The public API's per-key and per-workspace request windows, reported as the
 * IETF draft RateLimit fields (draft-ietf-httpapi-ratelimit-headers):
 * `RateLimit-Policy` names each window's quota (`q`) and length (`w`);
 * `RateLimit` gives what remains (`r`) and the seconds until it resets (`t`).
 */
import { budget, spendBudgetState, type Budget } from '../abuse/usage.ts';
import type { Database } from '../db/database.ts';
import { ApiError } from '../errors.ts';

const WINDOWS = {
  key: budget('public_api_key'),
  workspace: budget('public_api_workspace'),
} as const satisfies Record<string, Budget>;

const POLICY = Object.entries(WINDOWS)
  .map(([name, { limit, windowSeconds }]) => `"${name}";q=${limit};w=${windowSeconds}`)
  .join(', ');

async function spend(db: Database, name: keyof typeof WINDOWS, subject: string): Promise<string> {
  try {
    const state = await spendBudgetState(db, WINDOWS[name], subject);
    return `"${name}";r=${state.remaining};t=${state.resetSeconds}`;
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 429) throw error;
    throw new ApiError(429, error.message, {
      code: error.code,
      headers: {
        ...error.headers,
        'RateLimit-Policy': POLICY,
        RateLimit: `"${name}";r=0;t=${error.headers?.['retry-after'] ?? 1}`,
      },
    });
  }
}

export async function spendRateLimits(
  db: Database,
  key: { id: string; workspace_id: string },
): Promise<Record<string, string>> {
  const keyWindow = await spend(db, 'key', key.id);
  const workspaceWindow = await spend(db, 'workspace', key.workspace_id);
  return { 'RateLimit-Policy': POLICY, RateLimit: `${keyWindow}, ${workspaceWindow}` };
}
