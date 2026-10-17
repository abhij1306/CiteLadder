import { randomUUID } from 'node:crypto';
import type { Selectable } from 'kysely';
import { auditScheduleSchema } from '@citeladder/contracts/audits';
import type { z } from 'zod';
import { inTransaction, type Database } from '../db/database.ts';
import type { AuditSchedules } from '../generated/db-schema.ts';
import { ApiError, notFound } from '../errors.ts';
import { marketIds, resolveMarkets } from '../projects/markets.ts';
import {
  scheduleIntervalIssue,
  type ScheduleCreate,
  type ScheduleUpdate,
} from './schedule-inputs.ts';

export type ScheduleScope = { workspaceId: string; projectId: string };
type Row = Selectable<AuditSchedules>;

function scoped(db: Database, scope: ScheduleScope) {
  return db
    .selectFrom('audit_schedules')
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId);
}

function view(row: Row): z.output<typeof auditScheduleSchema> {
  return auditScheduleSchema.parse({
    ...row,
    market_ids: marketIds(row.market_ids),
    next_run_at: row.next_run_at?.toISOString() ?? null,
    last_run_at: row.last_run_at?.toISOString() ?? null,
    last_failure_at: row.last_failure_at?.toISOString() ?? null,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  });
}

async function requirePromptSet(db: Database, scope: ScheduleScope, id: string) {
  const set = await db
    .selectFrom('prompt_sets')
    .innerJoin('projects', 'projects.id', 'prompt_sets.project_id')
    .select('prompt_sets.id')
    .where('prompt_sets.id', '=', id)
    .where('projects.id', '=', scope.projectId)
    .where('projects.workspace_id', '=', scope.workspaceId)
    .executeTakeFirst();
  if (!set) throw new ApiError(422, 'Prompt set not found for project');
}

export function createSchedule(db: Database, scope: ScheduleScope, input: ScheduleCreate) {
  return inTransaction(db, async (trx) => {
    await requirePromptSet(trx, scope, input.prompt_set_id);
    await resolveMarkets(trx, scope, input.market_ids);
    const now = new Date();
    const row = await trx
      .insertInto('audit_schedules')
      .values({
        ...input,
        id: randomUUID(),
        workspace_id: scope.workspaceId,
        project_id: scope.projectId,
        engines: JSON.stringify(input.engines),
        market_ids: JSON.stringify(input.market_ids),
        next_run_at: input.next_run_at ? new Date(input.next_run_at) : now,
        last_run_at: null,
        failure_count: 0,
        last_error: '',
        last_failure_at: null,
        lease_owner: null,
        lease_expires_at: null,
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return view(row);
  });
}

export async function listSchedules(db: Database, scope: ScheduleScope) {
  return (await scoped(db, scope).selectAll().orderBy('created_at').orderBy('id').execute()).map(
    view,
  );
}

export async function readSchedule(db: Database, scope: ScheduleScope, id: string) {
  const row = await scoped(db, scope).selectAll().where('id', '=', id).executeTakeFirst();
  if (!row) throw notFound('Audit schedule');
  return view(row);
}

/** An omitted next run re-arms a schedule being enabled with nothing pending. */
function nextRunPatch(input: ScheduleUpdate, current: Row, now: Date) {
  if (input.next_run_at === undefined)
    return input.enabled === true && current.next_run_at === null ? { next_run_at: now } : {};
  return { next_run_at: input.next_run_at === null ? null : new Date(input.next_run_at) };
}

export function updateSchedule(
  db: Database,
  scope: ScheduleScope,
  id: string,
  input: ScheduleUpdate,
) {
  return db.transaction().execute(async (trx) => {
    const current = await scoped(trx, scope)
      .selectAll()
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst();
    if (!current) throw notFound('Audit schedule');
    const message = scheduleIntervalIssue({ ...current, ...input });
    if (message) throw new ApiError(422, message);
    if (input.prompt_set_id !== undefined) await requirePromptSet(trx, scope, input.prompt_set_id);
    if (input.market_ids !== undefined) await resolveMarkets(trx, scope, input.market_ids);
    const { engines, market_ids: markets, next_run_at: _nextRunAt, ...fields } = input;
    const now = new Date();
    const row = await trx
      .updateTable('audit_schedules')
      .set({
        ...fields,
        ...(engines === undefined ? {} : { engines: JSON.stringify(engines) }),
        ...(markets === undefined ? {} : { market_ids: JSON.stringify(markets) }),
        ...nextRunPatch(input, current, now),
        // Resuming a schedule paused by failures starts its failure count afresh.
        ...(input.enabled === true && !current.enabled ? { failure_count: 0, last_error: '' } : {}),
        updated_at: now,
      })
      .where('id', '=', id)
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .returningAll()
      .executeTakeFirstOrThrow();
    return view(row);
  });
}

export async function deleteSchedule(db: Database, scope: ScheduleScope, id: string) {
  // DELETE takes the row lock the retained scheduler's claim/finalize waits on.
  const deleted = await db
    .deleteFrom('audit_schedules')
    .where('id', '=', id)
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .returning('id')
    .executeTakeFirst();
  if (!deleted) throw notFound('Audit schedule');
}
