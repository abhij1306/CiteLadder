import type { Database } from '../db/database.ts';
import { ApiError } from '../errors.ts';
import { InvalidCursorError } from '../http/keyset-cursor.ts';
import { AnalysisNotFoundError, TrendQueryError } from '../visibility/selection.ts';

export type McpPrincipal = {
  userId: string;
  grantId: string;
  workspaceIds: string[];
  tokenHash: string;
  /** The grant holds `citeladder:write`; each change still needs the live role. */
  canWrite: boolean;
};
/** Internal evidence readers use live membership, pinned to one project. */
export type EvidencePrincipal =
  | McpPrincipal
  | {
      kind: 'member';
      userId: string;
      workspaceId: string;
      projectId: string;
    };
export type Evidence = Record<string, unknown>;
export type ReadScope = { workspaceId: string; projectId: string };
/** An authorized project read: `origin` builds app links, empty for in-app reads. */
export type ProjectRead = { db: Database; scope: ReadScope; origin: string };
/** A caller-caused argument problem the model can correct. */
export class McpInputError extends Error {}

/**
 * The message a caller can act on, or null for a server failure whose detail
 * stays in the log. Owners signal caller mistakes with their own 4xx errors.
 */
export function callerMessage(error: unknown): string | null {
  if (
    error instanceof McpInputError ||
    error instanceof TrendQueryError ||
    error instanceof InvalidCursorError
  )
    return error.message;
  if (error instanceof AnalysisNotFoundError) return 'Selected measurement is unavailable';
  if (error instanceof ApiError && error.status === 429)
    return `${error.message}; retry in ${error.headers?.['retry-after'] ?? 'a few'} seconds`;
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return error.message;
  return null;
}
