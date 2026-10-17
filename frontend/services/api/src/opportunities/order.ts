/**
 * The shared Opportunity queue order, the one Opportunity-level user write
 * (`commands.update_order`). It stores stable keys, so the order survives
 * refreshes that replace the rows, and never touches derived evidence.
 */
import { randomUUID } from 'node:crypto';

import { asApiErrorCode } from '@citeladder/contracts/error-codes';

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { WorkspaceScope } from '../db/workspace-scope.ts';
import { ApiError, notFound } from '../errors.ts';
import { stableKey } from './projection.ts';
import type { Scope } from './sources.ts';

const CONFLICT = asApiErrorCode(policy.opportunity.opportunities.CODE_OPPORTUNITY_ORDER_CONFLICT);

export function updateOrder(
  db: Database,
  scope: Scope,
  update: { orderedIds: string[]; expectedVersion: number; userId: string },
) {
  return db.transaction().execute(async (trx) => {
    const workspace = new WorkspaceScope(scope.workspaceId);
    const project = await workspace
      .selectFrom(trx, 'projects')
      .select('id')
      .where('id', '=', scope.projectId)
      .forUpdate()
      .executeTakeFirst();
    if (!project) throw notFound('Project');
    const ids = update.orderedIds;
    if (new Set(ids).size !== ids.length) {
      throw new ApiError(422, 'ordered opportunity ids must be unique');
    }
    const rows = ids.length
      ? await workspace
          .selectFrom(trx, 'opportunities')
          .select(['id', 'rule_id', 'target_key'])
          .where('project_id', '=', scope.projectId)
          .where('id', 'in', ids)
          .where('superseded_at', 'is', null)
          .execute()
      : [];
    const byId = new Map(rows.map((row) => [row.id, row]));
    if (byId.size !== ids.length) {
      throw new ApiError(422, 'ordered opportunity ids must identify live project opportunities');
    }
    const order = await workspace
      .selectFrom(trx, 'opportunity_orders')
      .select(['id', 'version'])
      .where('project_id', '=', scope.projectId)
      .forUpdate()
      .executeTakeFirst();
    const current = order?.version ?? 0;
    if (update.expectedVersion !== current) {
      throw new ApiError(
        409,
        `queue version changed from ${update.expectedVersion} to ${current}`,
        {
          code: CONFLICT,
        },
      );
    }
    const orderedKeys = JSON.stringify(ids.map((id) => stableKey(byId.get(id)!)));
    const now = new Date();
    if (order === undefined) {
      await trx
        .insertInto('opportunity_orders')
        .values({
          id: randomUUID(),
          workspace_id: scope.workspaceId,
          project_id: scope.projectId,
          ordered_keys: orderedKeys,
          version: 1,
          updated_by_user_id: update.userId,
          created_at: now,
          updated_at: now,
        })
        .execute();
    } else {
      await trx
        .updateTable('opportunity_orders')
        .set({
          ordered_keys: orderedKeys,
          version: current + 1,
          updated_by_user_id: update.userId,
          updated_at: now,
        })
        .where('id', '=', order.id)
        .execute();
    }
    return { version: current + 1, ordered_opportunity_ids: ids };
  });
}
