import type { Database } from '../db/database.ts';
import { ApiError } from '../errors.ts';
import { InvalidCursorError } from '../http/keyset-cursor.ts';
import {
  AnalysisNotFoundError,
  TrendQueryError,
  type AnalysisMissing,
} from '../visibility/selection.ts';

export type McpPrincipal = {
  userId: string;
  grantId: string;
  workspaceIds: string[];
  tokenHash: string;
  canWrite: boolean;
};
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
export type ProjectRead = { db: Database; scope: ReadScope; origin: string };
export class McpInputError extends Error {}

const SELECTION_MISSING: Readonly<Record<AnalysisMissing, string>> = {
  not_found: 'Selected measurement is unavailable',
  not_measured: 'Nothing has been measured for this selection yet',
  metrics_pending: "The selected run's results are still being prepared",
};

export function callerMessage(error: unknown): string | null {
  if (
    error instanceof McpInputError ||
    error instanceof TrendQueryError ||
    error instanceof InvalidCursorError
  )
    return error.message;
  if (error instanceof AnalysisNotFoundError) return SELECTION_MISSING[error.reason];
  if (error instanceof ApiError && error.status === 429)
    return `${error.message}; retry in ${error.headers?.['retry-after'] ?? 'a few'} seconds`;
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return error.message;
  return null;
}
