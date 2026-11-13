/**
 * A project's crawl schedule: off until the person turns it on, then one crawl
 * per cadence through ordinary crawl admission (`workers/crawl-scheduler.ts`).
 * A project without a row reads as off; reading never writes one.
 */
import { sql, type Selectable } from 'kysely';
import { randomUUID } from 'node:crypto';
import {
  crawlScheduleCadenceSchema,
  crawlScheduleOutcomeSchema,
  type CrawlSchedule,
  type CrawlScheduleCadence,
} from '@citeladder/contracts/site-health';
import type { CrawlScheduleUpdateRequest } from '@citeladder/contracts/site-health-requests';
import { DAY_MS } from '../calendar-days.ts';
import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import type { CrawlSchedules } from '../generated/db-schema.ts';

export type CrawlScheduleRow = Selectable<CrawlSchedules>;

/** `anchor` plus `count` cadence steps; a month step keeps the day, clamped to the month's end. */
function stepFrom(cadence: CrawlScheduleCadence, anchor: Date, count: number) {
  const { days, months } = policy.crawl_schedules.cadences[cadence];
  const target = new Date(anchor.getTime() + days * count * DAY_MS);
  if (!months) return target;
  const month = anchor.getUTCMonth() + months * count;
  const lastDay = new Date(Date.UTC(anchor.getUTCFullYear(), month + 1, 0)).getUTCDate();
  target.setUTCFullYear(anchor.getUTCFullYear(), month, Math.min(anchor.getUTCDate(), lastDay));
  return target;
}

/** The first occurrence on the cadence from `anchor` that falls after `after`. */
export function nextOccurrence(cadence: CrawlScheduleCadence, anchor: Date, after: Date) {
  let count = 1;
  // A week is a fixed span, so jump straight to the step before `after`.
  const { days } = policy.crawl_schedules.cadences[cadence];
  if (days && after > anchor)
    count = Math.max(1, Math.floor((after.getTime() - anchor.getTime()) / (days * DAY_MS)));
  let next = stepFrom(cadence, anchor, count);
  while (next <= after) next = stepFrom(cadence, anchor, ++count);
  return next;
}

const iso = (value: Date | null) => value?.toISOString() ?? null;

function scheduleProjection(projectId: string, row: CrawlScheduleRow | undefined): CrawlSchedule {
  return {
    project_id: projectId,
    enabled: row?.enabled ?? false,
    cadence: crawlScheduleCadenceSchema.parse(row?.cadence ?? 'weekly'),
    next_run_at: iso(row?.next_run_at ?? null),
    last_run_at: iso(row?.last_run_at ?? null),
    last_outcome: row?.last_outcome ? crawlScheduleOutcomeSchema.parse(row.last_outcome) : null,
    last_crawl_id: row?.last_crawl_id ?? null,
  };
}

function scheduleRow(db: Database, workspaceId: string, projectId: string) {
  return db
    .selectFrom('crawl_schedules')
    .selectAll()
    .where('workspace_id', '=', workspaceId)
    .where('project_id', '=', projectId);
}

export async function readSchedule(db: Database, workspaceId: string, projectId: string) {
  return scheduleProjection(
    projectId,
    await scheduleRow(db, workspaceId, projectId).executeTakeFirst(),
  );
}

/**
 * `last_outcome` describes the plan the person last chose, so turning the
 * schedule off or replanning it clears it; only the scheduler turns a
 * schedule off with a `failed` outcome left in place.
 */
function scheduleChange(current: CrawlScheduleRow, request: CrawlScheduleUpdateRequest, at: Date) {
  const { cadence } = request;
  if (!request.enabled) return { cadence, enabled: false, next_run_at: null, last_outcome: null };
  if (current.enabled && current.cadence === cadence) return { cadence };
  return {
    cadence,
    enabled: true,
    next_run_at: nextOccurrence(cadence, at, at),
    last_outcome: null,
    failure_count: 0,
    last_error: '',
    last_failure_at: null,
  };
}

/**
 * Turns the schedule on, off or to another cadence. Turning it on, or changing
 * the cadence, counts the first occurrence one step from now; saving the same
 * choice again keeps the occurrence already planned. Caller owns the transaction.
 */
export async function updateSchedule(
  db: Database,
  workspaceId: string,
  projectId: string,
  request: CrawlScheduleUpdateRequest,
  at = new Date(),
) {
  await db
    .insertInto('crawl_schedules')
    .values({
      id: randomUUID(),
      workspace_id: workspaceId,
      project_id: projectId,
      enabled: false,
      cadence: request.cadence,
      failure_count: 0,
      last_error: '',
      created_at: at,
      updated_at: at,
    })
    .onConflict((conflict) => conflict.columns(['workspace_id', 'project_id']).doNothing())
    .execute();
  const current = await scheduleRow(db, workspaceId, projectId)
    .forUpdate()
    .executeTakeFirstOrThrow();
  const row = await db
    .updateTable('crawl_schedules')
    .set({ ...scheduleChange(current, request, at), updated_at: at })
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', current.id)
    .returningAll()
    .executeTakeFirstOrThrow();
  return scheduleProjection(projectId, row);
}

/** Leases up to `limit` due schedules; a live lease keeps a schedule from every other claimer. */
export function claimDueCrawlSchedules(
  db: Database,
  options: { owner: string; at: Date; limit: number; leaseSeconds: number },
) {
  return db.transaction().execute(async (trx) => {
    const due = await trx
      .selectFrom('crawl_schedules')
      .select(['id', 'workspace_id', 'project_id', 'next_run_at'])
      .where('enabled', '=', true)
      .where('next_run_at', '<=', options.at)
      .where((eb) =>
        eb.or([
          eb('lease_expires_at', 'is', null),
          eb('lease_expires_at', '<=', sql<Date>`clock_timestamp()`),
        ]),
      )
      .orderBy('next_run_at')
      .orderBy('id')
      .limit(options.limit)
      .forUpdate()
      .skipLocked()
      .execute();
    if (due.length)
      await trx
        .updateTable('crawl_schedules')
        .set({
          lease_owner: options.owner,
          lease_expires_at: sql<Date>`clock_timestamp() + ${options.leaseSeconds} * interval '1 second'`,
          updated_at: options.at,
        })
        .where(
          'id',
          'in',
          due.map((row) => row.id),
        )
        .execute();
    return due.map((row) => ({
      id: row.id,
      workspaceId: row.workspace_id,
      projectId: row.project_id,
      // The due filter excludes schedules without a next run.
      scheduledFor: row.next_run_at ?? options.at,
    }));
  });
}
