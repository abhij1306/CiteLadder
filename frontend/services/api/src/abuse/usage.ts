/**
 * Durable fixed-window usage counters (`usage_windows`) keyed by a hashed,
 * case-folded subject.
 *
 * A request consumes its budget in its own committed transaction before the
 * work it guards starts, so a failed import still spends its attempt.
 */
import { createHash, randomUUID } from 'node:crypto';

import { sql } from 'kysely';

import type { Database } from '../db/database.ts';
import { ApiError } from '../errors.ts';
import { abuse, budgets, type BudgetName, type BudgetSubject } from '../config/abuse.ts';
import {
  resolveSettingSpec,
  resolveSpec,
  type SettingSource,
  type SettingSpec,
} from '../config/settings.ts';
import { getLogger } from '../logging.ts';

/** The `Retry-After` a request refused for too many active jobs carries. */
export function activeJobRetrySeconds(source: SettingSource = process.env): number {
  return resolveSpec(
    'active_job_retry_after_seconds',
    abuse.active_job_retry_after_seconds,
    source,
  ) as number;
}

/** A resolved budget: who it counts, its persisted operation, its limit and its window. */
export type Budget = {
  subject: BudgetSubject;
  operation: string;
  limit: number;
  windowSeconds: number;
};

/** Budgets whose limit and window are fixed policy numbers, with no overridable setting. */
type FixedBudgetName = {
  [K in BudgetName]: (typeof budgets)[K] extends { limit: number; windowSeconds: number }
    ? K
    : never;
}[BudgetName];

/**
 * A named budget from `config/abuse.ts`. Overridable limits resolve from
 * `settings`: the startup settings wherever a config is in reach.
 */
export function budget(name: FixedBudgetName): Budget;
export function budget(name: BudgetName, settings: SettingSource): Budget;
export function budget(name: BudgetName, settings?: SettingSource): Budget {
  const entry: { limit: number | SettingSpec; windowSeconds: number | SettingSpec } = budgets[name];
  const value = (v: number | SettingSpec) => {
    if (typeof v === 'number') return v;
    if (!settings) throw new Error(`Budget ${name} needs the settings it resolves from`);
    return Number(resolveSettingSpec(v, settings));
  };
  return {
    subject: budgets[name].subject,
    operation: budgets[name].operation,
    limit: value(entry.limit),
    windowSeconds: value(entry.windowSeconds),
  };
}

/** Spend `amount` units of `budget` for `subject`, or throw 429 with `Retry-After`. */
export async function spendBudget(
  db: Database,
  { subject: kind, ...limit }: Budget,
  subject: string,
  { amount = 1, at = new Date() }: { amount?: number; at?: Date } = {},
): Promise<void> {
  return enforceSubjectRequest(db, kind, subject, { ...limit, amount }, at);
}

/** Forget every window of one subject's named budget (a proven owner resets their failures). */
export async function releaseBudget(
  db: Database,
  name: BudgetName,
  subject: string,
): Promise<void> {
  const { subject: kind, operation } = budgets[name];
  await db
    .deleteFrom('usage_windows')
    .where('subject_kind', '=', kind)
    .where('subject_hash', '=', subjectHash(subject))
    .where('operation', '=', operation)
    .execute();
}

/** Subjects are case-folded and hashed; no raw address or identifier is stored. */
function subjectHash(subjectValue: string): string {
  return createHash('sha256').update(subjectValue.trim().toLowerCase()).digest('hex');
}

function windowOf(windowSeconds: number, now: Date) {
  const epoch = Math.floor(now.getTime() / 1000);
  const startedEpoch = epoch - (epoch % windowSeconds);
  return {
    started: new Date(startedEpoch * 1000),
    expires: new Date((startedEpoch + windowSeconds) * 1000),
  };
}

function throttled(subjectKind: BudgetSubject, operation: string, expires: Date, now: Date) {
  getLogger('api.abuse').info('request.throttled', { operation, subject_kind: subjectKind });
  const retryAfter = Math.max(1, Math.ceil((expires.getTime() - now.getTime()) / 1000));
  return new ApiError(
    429,
    subjectKind === 'workspace' ? 'Workspace usage limit exceeded' : 'Too many requests',
    { headers: { 'retry-after': String(retryAfter) } },
  );
}

/** Autocommitted atomic counters, before hashing or provider I/O. */
async function enforceSubjectRequest(
  db: Database,
  subjectKind: BudgetSubject,
  subjectValue: string,
  { operation, limit, windowSeconds, amount }: Omit<Budget, 'subject'> & { amount: number },
  now: Date,
): Promise<void> {
  if (![limit, windowSeconds, amount].every((value) => Number.isInteger(value) && value > 0)) {
    throw new Error('Usage limit, window and amount must be positive integers');
  }
  const { started, expires } = windowOf(windowSeconds, now);
  if (amount > limit) throw throttled(subjectKind, operation, expires, now);
  const consumed = await db
    .insertInto('usage_windows')
    .values({
      id: randomUUID(),
      subject_kind: subjectKind,
      subject_hash: subjectHash(subjectValue),
      operation,
      window_started_at: started,
      expires_at: expires,
      count: amount,
      created_at: now,
      updated_at: now,
    })
    .onConflict((conflict) =>
      conflict
        .constraint('uq_usage_window_subject_operation_start')
        .doUpdateSet({ count: sql`usage_windows.count + ${amount}`, updated_at: now })
        .where(sql<boolean>`usage_windows.count + ${amount} <= ${limit}`),
    )
    .returning('count')
    .executeTakeFirst();
  if (consumed === undefined) throw throttled(subjectKind, operation, expires, now);
}

/** Delete a bounded batch of expired windows; live windows are never touched. */
export async function pruneUsageWindows(
  db: Database,
  now: Date,
  batch: number,
  canAdmit: () => boolean = () => true,
): Promise<number> {
  if (!canAdmit()) return 0;
  return await db.transaction().execute(async (trx) => {
    const rows = await trx
      .selectFrom('usage_windows')
      .select('id')
      .where('expires_at', '<=', now)
      .orderBy('expires_at')
      .limit(batch)
      .forUpdate()
      .skipLocked()
      .execute();
    if (!rows.length) return 0;
    const deleted = await trx
      .deleteFrom('usage_windows')
      .where(
        'id',
        'in',
        rows.map((row) => row.id),
      )
      .executeTakeFirst();
    return Number(deleted.numDeletedRows);
  });
}
