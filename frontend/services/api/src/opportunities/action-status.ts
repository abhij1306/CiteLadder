import { randomUUID } from 'node:crypto';
import { actionStatusSchema, type ActionStatus } from '@citeladder/contracts/actions';
import { sql, type RawBuilder, type Selectable, type SqlBool } from 'kysely';

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { ApiError } from '../errors.ts';
import type { Actions } from '../generated/db-schema.ts';
import { compareText } from '../text-order.ts';

const a = policy.opportunity.actions;
type StatusView = (typeof a.ACTION_STATUS_VIEW)[keyof typeof a.ACTION_STATUS_VIEW];
const VIEWS = new Map<string, StatusView>(Object.entries(a.ACTION_STATUS_VIEW));

export function statusView(effective: string): StatusView {
  const view = VIEWS.get(effective);
  if (!view) throw new Error(`Unknown persisted action status: ${effective}`);
  return view;
}

export function persistedStatuses(statuses: readonly ActionStatus[]): string[] {
  return Object.entries(a.ACTION_STATUS_VIEW)
    .filter(([, view]) => statuses.includes(view.status))
    .map(([persisted]) => persisted)
    .sort(compareText);
}

function derivedStatus(): RawBuilder<string> {
  const measured = sql`(
    select case when ve.observation_kind = 'verified'
      then ${a.ACTION_STATUS_DONE}::varchar else ${a.ACTION_STATUS_MEASURING}::varchar end
    from opportunity_verification_events ve
    join opportunity_implementation_events ie on ie.id = ve.implementation_event_id
    where ie.action_id = actions.id
      and ie.workspace_id = actions.workspace_id
      and ie.project_id = actions.project_id
      and ve.workspace_id = ie.workspace_id
      and ve.project_id = ie.project_id
    order by ve.created_at desc, ve.id desc
    limit 1
  )`;
  return sql<string>`case
    when actions.status = ${a.ACTION_STATUS_IMPLEMENTED}
      then coalesce(${measured}, ${a.ACTION_STATUS_IMPLEMENTED}::varchar)
    else actions.status
  end`;
}

export async function refreshActionStatus(
  db: Database,
  workspaceId: string,
  ...actionIds: string[]
): Promise<void> {
  if (!actionIds.length) return;
  await db
    .selectFrom('actions')
    .select('id')
    .where('workspace_id', '=', workspaceId)
    .where('id', 'in', actionIds)
    .orderBy('id')
    .forNoKeyUpdate()
    .execute();
  await db
    .updateTable('actions')
    .set({ effective_status: derivedStatus() })
    .where('workspace_id', '=', workspaceId)
    .where('id', 'in', actionIds)
    .where(sql<SqlBool>`effective_status is distinct from ${derivedStatus()}`)
    .execute();
}

type StatusRow = Pick<Selectable<Actions>, 'id' | 'workspace_id' | 'project_id' | 'status'>;

export async function recordStatus(
  db: Database,
  actions: readonly StatusRow[],
  status: string,
  userId: string,
) {
  const moving = actions.filter((action) => action.status !== status);
  const [first] = moving;
  if (!first) return;
  const ids = moving.map((action) => action.id);
  const now = new Date();
  await db
    .updateTable('actions')
    .set({ status, updated_at: now })
    .where('workspace_id', '=', first.workspace_id)
    .where('id', 'in', ids)
    .execute();
  await db
    .insertInto('action_status_events')
    .values(
      moving.map((action) => ({
        id: randomUUID(),
        workspace_id: action.workspace_id,
        project_id: action.project_id,
        action_id: action.id,
        previous_status: action.status,
        next_status: status,
        changed_by_user_id: userId,
        created_at: now,
      })),
    )
    .execute();
  await refreshActionStatus(db, first.workspace_id, ...ids);
}

export function opportunityStatusClause(status: ActionStatus | null): RawBuilder<SqlBool> {
  if (status) {
    return sql<SqlBool>`opportunities.action_id in (
      select actions.id from actions
      where actions.workspace_id = opportunities.workspace_id
        and actions.project_id = opportunities.project_id
        and actions.effective_status in (${sql.join(persistedStatuses([status]))})
    )`;
  }
  const active = [...a.ACTION_ACTIVE_STATUSES].sort(compareText);
  return sql<SqlBool>`(opportunities.action_id is null or opportunities.action_id in (
    select actions.id from actions
    where actions.workspace_id = opportunities.workspace_id
      and actions.project_id = opportunities.project_id
      and actions.effective_status in (${sql.join(active)})
  ))`;
}

export function validateStatus(status: string): ActionStatus {
  const parsed = actionStatusSchema.safeParse(status);
  if (!parsed.success) throw new ApiError(422, `unknown action status: ${status}`);
  return parsed.data;
}
