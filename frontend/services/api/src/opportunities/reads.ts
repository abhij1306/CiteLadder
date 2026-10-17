/**
 * Workspace-scoped persisted Opportunity reads. Reads render what refreshes
 * persisted; none of them recomputes, refreshes a source or repairs state.
 */

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { WorkspaceScope } from '../db/workspace-scope.ts';
import { ApiError, notFound } from '../errors.ts';
import {
  decodeKeysetCursor,
  encodeKeysetCursor,
  InvalidCursorError,
} from '../http/keyset-cursor.ts';
import { parseUuid } from '../http/uuid.ts';
import { opportunityStatusClause, validateStatus } from './action-status.ts';
import {
  OPPORTUNITY_COLUMNS,
  orderedItems,
  projectDetail,
  type OpportunityRow,
} from './projection.ts';
import type { Scope } from './sources.ts';

const o = policy.opportunity.opportunities;
const LIST_SCOPE = 'opportunities';

export type OpportunityFilters = {
  type: string | null;
  severity: string | null;
  status: string | null;
  rule_id: string | null;
  min_priority: number | null;
};

export async function requireProject(db: Database, scope: Scope): Promise<void> {
  const project = await new WorkspaceScope(scope.workspaceId)
    .selectFrom(db, 'projects')
    .select('id')
    .where('id', '=', scope.projectId)
    .executeTakeFirst();
  if (!project) throw notFound('Project');
}

function invalid(message: string): never {
  throw new ApiError(422, message);
}

function validateFilters(filters: OpportunityFilters): void {
  if (filters.type !== null && !o.OPPORTUNITY_TYPES.includes(filters.type))
    invalid(`unknown opportunity type: ${filters.type}`);
  if (filters.severity !== null && !o.OPPORTUNITY_SEVERITIES.includes(filters.severity))
    invalid(`unknown opportunity severity: ${filters.severity}`);
  if (filters.status !== null) validateStatus(filters.status);
  if (filters.rule_id !== null && !Object.hasOwn(o.OPPORTUNITY_RULES_BY_ID, filters.rule_id))
    invalid(`unknown opportunity rule_id: ${filters.rule_id}`);
}

function filtered(db: Database, scope: Scope, filters: OpportunityFilters) {
  let query = new WorkspaceScope(scope.workspaceId)
    .selectFrom(db, 'opportunities')
    .select(OPPORTUNITY_COLUMNS)
    .where('opportunities.project_id', '=', scope.projectId)
    .where('opportunities.superseded_at', 'is', null);
  if (filters.type) query = query.where('opportunities.opportunity_type', '=', filters.type);
  if (filters.severity) query = query.where('opportunities.severity', '=', filters.severity);
  query = query.where(opportunityStatusClause(filters.status));
  if (filters.rule_id) query = query.where('opportunities.rule_id', '=', filters.rule_id);
  if (filters.min_priority !== null)
    query = query.where('opportunities.priority_score', '>=', filters.min_priority);
  return query;
}

function cursorFilters(scope: Scope, filters: OpportunityFilters) {
  return {
    project_id: scope.projectId,
    type: filters.type || null,
    severity: filters.severity || null,
    status: filters.status || null,
    rule_id: filters.rule_id || null,
    min_priority: filters.min_priority,
  };
}

function badCursor(error: unknown): never {
  if (!(error instanceof InvalidCursorError)) throw error;
  throw new ApiError(400, error.message, { code: 'invalid_cursor' });
}

/** A cursor's score, or an invalid cursor. */
function cursorScore(text: string): number {
  const score = Number(text);
  if (text === '' || !Number.isFinite(score)) throw new InvalidCursorError('invalid cursor');
  return score;
}

/** Live-row catalog page, ordered by priority then UUID. */
export async function listOpportunities(
  db: Database,
  scope: Scope,
  filters: OpportunityFilters,
  page: { limit: number; cursor: string | null },
) {
  await requireProject(db, scope);
  validateFilters(filters);
  const limit = Math.max(1, Math.min(page.limit, o.LIST_MAX_LIMIT));
  const fingerprint = cursorFilters(scope, filters);
  let query = filtered(db, scope, filters);
  if (page.cursor) {
    let score: number;
    let id: string;
    try {
      const [scoreText = '', idText = ''] = decodeKeysetCursor(
        page.cursor,
        LIST_SCOPE,
        fingerprint,
      );
      score = cursorScore(scoreText);
      const parsed = parseUuid(idText);
      if (parsed === null) throw new InvalidCursorError('invalid cursor');
      id = parsed;
    } catch (error) {
      badCursor(error);
    }
    query = query.where((eb) =>
      eb.or([
        eb('opportunities.priority_score', '<', score),
        eb.and([eb('opportunities.priority_score', '=', score), eb('opportunities.id', '<', id)]),
      ]),
    );
  }
  let rows: OpportunityRow[] = await query
    .orderBy('opportunities.priority_score', 'desc')
    .orderBy('opportunities.id', 'desc')
    .limit(limit + 1)
    .execute();
  let nextCursor: string | null = null;
  if (rows.length > limit) {
    rows = rows.slice(0, limit);
    const last = rows.at(-1);
    if (last)
      nextCursor = encodeKeysetCursor(LIST_SCOPE, fingerprint, [
        String(last.priority_score),
        last.id,
      ]);
  }
  const order = await new WorkspaceScope(scope.workspaceId)
    .selectFrom(db, 'opportunity_orders')
    .select('ordered_keys')
    .where('project_id', '=', scope.projectId)
    .executeTakeFirst();
  return { items: orderedItems(rows, order?.ordered_keys ?? null), next_cursor: nextCursor };
}

/** One row, live or superseded, with its full evidence and provenance. */
export async function getOpportunity(db: Database, workspaceId: string, opportunityId: string) {
  const row = await new WorkspaceScope(workspaceId)
    .selectFrom(db, 'opportunities')
    .select(OPPORTUNITY_COLUMNS)
    .where('opportunities.id', '=', opportunityId)
    .executeTakeFirst();
  if (!row) throw notFound('Opportunity');
  return projectDetail(row);
}
