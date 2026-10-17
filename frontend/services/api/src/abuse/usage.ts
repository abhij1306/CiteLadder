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
import { policy, resolveSettingSpec } from '../config.ts';
import { getLogger } from '../logging.ts';

type SubjectKind =
  | 'api_key'
  | 'workspace'
  | 'crawl_source'
  | 'crawl_project'
  | 'mcp_grant'
  | 'user';

export type UsageLimit = {
  operation: string;
  limit: number;
  windowSeconds: number;
  amount?: number;
};

export function agentCallLimit(amount: number): UsageLimit {
  return {
    operation: 'agent.provider_call',
    limit: resolveSettingSpec(policy.abuse.agent_call_limit) as number,
    windowSeconds: resolveSettingSpec(policy.abuse.agent_call_window_seconds) as number,
    amount,
  };
}

type DailyWorkspaceSetting = Extract<keyof typeof policy.abuse, `${string}_per_workspace_daily`>;

/** A per-workspace budget over one day, sized by its `config/abuse.ts` setting. */
export function dailyWorkspaceLimit(
  operation: string,
  setting: DailyWorkspaceSetting,
  amount = 1,
): UsageLimit {
  return {
    operation,
    limit: Number(resolveSettingSpec(policy.abuse[setting])),
    windowSeconds: 86400,
    amount,
  };
}

/** Consume one unit for the workspace, or throw 429 with `Retry-After`. */
export async function enforceWorkspaceRequest(
  db: Database,
  workspaceId: string,
  { operation, limit, windowSeconds, amount = 1 }: UsageLimit,
  now: Date = new Date(),
): Promise<void> {
  return enforceSubjectRequest(
    db,
    'workspace',
    workspaceId,
    { operation, limit, windowSeconds, amount },
    now,
  );
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

function throttled(subjectKind: SubjectKind, operation: string, expires: Date, now: Date) {
  getLogger('api.abuse').info('request.throttled', { operation, subject_kind: subjectKind });
  const retryAfter = Math.max(1, Math.ceil((expires.getTime() - now.getTime()) / 1000));
  return new ApiError(
    429,
    subjectKind === 'workspace' ? 'Workspace usage limit exceeded' : 'Too many requests',
    { headers: { 'retry-after': String(retryAfter) } },
  );
}

/** Autocommitted atomic counters, before hashing or provider I/O. */
export async function enforceSubjectRequest(
  db: Database,
  subjectKind: SubjectKind,
  subjectValue: string,
  { operation, limit, windowSeconds, amount = 1 }: UsageLimit,
  now: Date = new Date(),
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
