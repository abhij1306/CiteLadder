/**
 * The Action status a reader sees, derived in SQL so filters and reads agree.
 *
 * A user stores `open` or `dismissed` and a declaration stores
 * `implemented`; the rest is derived: an open Action reads as in progress
 * while a linked chat has an output, and an implemented one reads as
 * measuring once the verifier observed its declaration and as done while the
 * latest observation, which folds every check's own latest reading, verified
 * every check.
 */
import { sql, type RawBuilder, type SqlBool } from 'kysely';

import { policy } from '../config.ts';
import { ApiError } from '../errors.ts';
import { compareText } from '../text-order.ts';

const a = policy.opportunity.actions;

/** The effective status of the `actions` row visible as `actions`. */
export function effectiveStatus(): RawBuilder<string> {
  // One lookup of the latest observation, read only for a declared Action.
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
    when actions.status = ${a.ACTION_STATUS_OPEN}
      and exists (select 1 from agent_outputs where agent_outputs.action_id = actions.id
        and agent_outputs.workspace_id = actions.workspace_id
        and agent_outputs.project_id = actions.project_id)
      then ${a.ACTION_STATUS_IN_PROGRESS}::varchar
    when actions.status = ${a.ACTION_STATUS_IMPLEMENTED}
      then coalesce(${measured}, ${a.ACTION_STATUS_IMPLEMENTED}::varchar)
    else actions.status
  end`;
}

/**
 * Opportunities whose Action has `status`; by default the work queue. A row
 * recomputed before Actions existed has no Action and stays in the queue.
 */
export function opportunityStatusClause(status: string | null): RawBuilder<SqlBool> {
  if (status) {
    return sql<SqlBool>`opportunities.action_id in (
      select actions.id from actions where ${effectiveStatus()} = ${status}
    )`;
  }
  const active = [...a.ACTION_ACTIVE_STATUSES].sort(compareText);
  return sql<SqlBool>`(opportunities.action_id is null or opportunities.action_id in (
    select actions.id from actions where ${effectiveStatus()} in (${sql.join(active)})
  ))`;
}

export function validateStatus(status: string): void {
  if (!a.ACTION_STATUSES.includes(status)) {
    throw new ApiError(422, `unknown action status: ${status}`);
  }
}
