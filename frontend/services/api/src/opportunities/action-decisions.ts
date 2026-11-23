import type { ActionBulkStatusRequest, ActionUserStatus } from '@citeladder/contracts/actions';
import { sql } from 'kysely';

import { policy } from '../config.ts';
import { inTransaction, type Database } from '../db/database.ts';
import type { RecordScope } from '../db/workspace-scope.ts';
import { ApiError } from '../errors.ts';
import { acquireProjectLock } from '../prompts/locks.ts';
import { recordStatus } from './action-status.ts';
import { actionItem, matchingActions, requireAction } from './actions.ts';
import type { Scope } from './sources.ts';

const a = policy.opportunity.actions;
const TRANSITIONS = new Map<string, readonly string[]>(Object.entries(a.ACTION_TRANSITIONS));

const allowed = (from: string, to: string) => TRANSITIONS.get(from)?.includes(to) ?? false;

export async function updateActionStatus(
  db: Database,
  scope: RecordScope,
  actionId: string,
  status: ActionUserStatus,
  userId: string,
) {
  await inTransaction(db, async (trx) => {
    const action = await requireAction(trx, scope, actionId, true);
    if (action.status === status) return;
    if (action.status === a.ACTION_STATUS_IMPLEMENTED)
      throw new ApiError(422, 'A declared Action cannot be changed');
    if (!allowed(action.status, status))
      throw new ApiError(422, `An Action cannot move from ${action.status} to ${status}`);
    await recordStatus(trx, [action], status, userId);
  });
  return actionItem(await requireAction(db, scope, actionId));
}

export async function bulkUpdateActionStatus(
  db: Database,
  scope: Scope,
  input: ActionBulkStatusRequest,
  userId: string,
) {
  return inTransaction(db, async (trx) => {
    await acquireProjectLock(trx, scope.projectId);
    let candidates: string[];
    let truncated = false;
    if (input.ids) {
      candidates = [...new Set(input.ids)];
    } else if (input.filter) {
      const rows = await matchingActions(trx, scope, input.filter)
        .select('id')
        .orderBy(sql`coalesce(actions.priority_score, -1)`, 'desc')
        .orderBy('id')
        .limit(a.ACTION_BULK_MAX + 1)
        .execute();
      truncated = rows.length > a.ACTION_BULK_MAX;
      candidates = rows.slice(0, a.ACTION_BULK_MAX).map((row) => row.id);
    } else {
      throw new ApiError(422, 'Name either ids or a filter');
    }
    if (!candidates.length) return { updated: 0, skipped: 0, truncated };
    const reach = input.filter
      ? matchingActions(trx, scope, input.filter)
      : trx
          .selectFrom('actions')
          .where('workspace_id', '=', scope.workspaceId)
          .where('project_id', '=', scope.projectId);
    const locked = await reach
      .selectAll()
      .where('id', 'in', candidates)
      .orderBy('id')
      .forUpdate()
      .execute();
    const moving = locked.filter((action) => allowed(action.status, input.to));
    await recordStatus(trx, moving, input.to, userId);
    return { updated: moving.length, skipped: candidates.length - moving.length, truncated };
  });
}

export async function acceptForAgent(db: Database, scope: Scope, actionId: string, userId: string) {
  const action = await db
    .selectFrom('actions')
    .selectAll()
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('id', '=', actionId)
    .forNoKeyUpdate()
    .executeTakeFirst();
  if (action?.status === a.ACTION_STATUS_OPEN)
    await recordStatus(db, [action], a.ACTION_STATUS_IN_PROGRESS, userId);
}
