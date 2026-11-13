import { randomBytes } from 'node:crypto';
import { retryAfterSeconds } from '@citeladder/contracts/retry-after';
import { sql } from 'kysely';
import type { Database } from '../db/database.ts';
import { strings } from '../db/json.ts';
import { policy } from '../config.ts';
import { resolveSettingSpec, type SettingSource } from '../config/settings.ts';
import { createAuditsInTransaction } from '../audits/creation.ts';
import { marketIds } from '../projects/markets.ts';
import { auditInput } from '../audits/inputs.ts';
import type { AuditRuntime } from '../audits/config.ts';
import { nextRunAfter } from '../audits/schedule-cadence.ts';
import { getLogger } from '../logging.ts';
import { ApiError } from '../errors.ts';
import { claimDueSchedules } from '../queue/audit-queue.ts';

export function schedulerSettings(env: SettingSource = process.env) {
  return Object.fromEntries(
    Object.entries(policy.audit_schedules.settings).map(([name, spec]) => [
      name,
      Number(resolveSettingSpec(spec, env)),
    ]),
  ) as Record<keyof typeof policy.audit_schedules.settings, number>;
}
type ScheduleClaim = Awaited<ReturnType<typeof claimDueSchedules>>[number];
const logger = getLogger('workers.audit_scheduler');
export class AuditScheduler {
  readonly db: Database;
  readonly runtime: AuditRuntime;
  readonly settings: ReturnType<typeof schedulerSettings>;
  readonly owner: string;
  readonly now: () => Date;
  constructor(
    db: Database,
    runtime: AuditRuntime,
    settings = schedulerSettings(),
    options: { owner?: string; now?: () => Date } = {},
  ) {
    this.db = db;
    this.runtime = runtime;
    this.settings = settings;
    this.owner = options.owner ?? `audit-scheduler-ts-${randomBytes(6).toString('hex')}`;
    this.now = options.now ?? (() => new Date());
  }
  claimDue(at: Date, limit = this.settings.claim_batch_size): Promise<ScheduleClaim[]> {
    return claimDueSchedules(this.db, {
      owner: this.owner,
      at,
      limit,
      leaseSeconds: this.settings.lease_ttl_seconds,
    });
  }
  planClaim(claim: ScheduleClaim, at = this.now()) {
    return this.db.transaction().execute(async (trx) => {
      const schedule = await trx
        .selectFrom('audit_schedules')
        .selectAll()
        .where('workspace_id', '=', claim.workspaceId)
        .where('project_id', '=', claim.projectId)
        .where('id', '=', claim.id)
        .where('lease_owner', '=', this.owner)
        .where('lease_expires_at', '>', sql<Date>`clock_timestamp()`)
        .forUpdate()
        .executeTakeFirst();
      if (!schedule) return false;
      const release = { lease_owner: null, lease_expires_at: null, updated_at: at };
      if (!schedule.enabled || schedule.next_run_at?.getTime() !== claim.scheduledFor.getTime()) {
        await trx
          .updateTable('audit_schedules')
          .set(release)
          .where('id', '=', schedule.id)
          .where('workspace_id', '=', claim.workspaceId)
          .execute();
        return false;
      }
      await sql`savepoint schedule_planning`.execute(trx);
      try {
        await createAuditsInTransaction(
          trx,
          schedule.workspace_id,
          auditInput.parse({
            project_id: schedule.project_id,
            prompt_set_id: schedule.prompt_set_id,
            engines: strings(schedule.engines),
            market_ids: marketIds(schedule.market_ids),
            repetitions: schedule.repetitions,
            benchmark_mode: schedule.benchmark_mode,
            audit_scope: schedule.audit_scope,
          }),
          { trigger: 'scheduled', scheduleId: schedule.id, scheduledFor: claim.scheduledFor },
          this.runtime,
          at,
        );
        const next = nextRunAfter(schedule, at);
        await trx
          .updateTable('audit_schedules')
          .set({
            ...release,
            last_run_at: at,
            next_run_at: next,
            enabled: next !== null,
            failure_count: 0,
            last_error: '',
            last_failure_at: null,
          })
          .where('id', '=', schedule.id)
          .where('workspace_id', '=', claim.workspaceId)
          .execute();
        await sql`release savepoint schedule_planning`.execute(trx);
        return true;
      } catch (error) {
        await sql`rollback to savepoint schedule_planning`.execute(trx);
        await sql`release savepoint schedule_planning`.execute(trx);
        if (error instanceof ApiError && error.isRetryable()) {
          // A transient refusal (active-launch limit, daily task budget) is not the
          // owner's to fix: try the same occurrence again without counting a failure.
          // `next_run_at` stays the occurrence (it anchors the cadence); an ownerless
          // lease until `Retry-After` keeps claims away until then.
          await trx
            .updateTable('audit_schedules')
            .set({
              lease_owner: null,
              lease_expires_at: sql<Date>`clock_timestamp() + ${this.retrySeconds(error)} * interval '1 second'`,
              updated_at: at,
            })
            .where('id', '=', schedule.id)
            .where('workspace_id', '=', claim.workspaceId)
            .execute();
          logger.info('scheduled_audit_planning_deferred', { schedule_id: schedule.id });
          return false;
        }
        const failures = schedule.failure_count + 1;
        const enabled = failures < this.settings.max_consecutive_failures;
        // `next_run_at` keeps anchoring the cadence: the same occurrence retries
        // after an ownerless lease, and success advances from the original anchor.
        // A schedule paused by failures holds no lease, so Resume plans at once.
        await trx
          .updateTable('audit_schedules')
          .set({
            ...release,
            ...(enabled
              ? {
                  lease_expires_at: sql<Date>`clock_timestamp() + ${this.settings.failure_retry_seconds} * interval '1 second'`,
                }
              : {}),
            failure_count: failures,
            // The admission reason (e.g. no connected provider) is what the owner can act on.
            last_error: error instanceof ApiError ? error.code : 'audit_planning_failed',
            last_failure_at: at,
            enabled,
          })
          .where('id', '=', schedule.id)
          .where('workspace_id', '=', claim.workspaceId)
          .execute();
        logger.info('scheduled_audit_planning_failed', { schedule_id: schedule.id });
        return false;
      }
    });
  }
  /** How long a retryable refusal asks to wait: its `Retry-After`, else the failure delay. */
  private retrySeconds(error: ApiError) {
    return retryAfterSeconds(error.headers?.['retry-after']) ?? this.settings.failure_retry_seconds;
  }
  async runOnce(at = this.now(), canAdmit?: () => boolean) {
    if (canAdmit) return this.planUntilBudget(at, canAdmit);
    const claims = await this.claimDue(at);
    let created = 0;
    for (const claim of claims) if (await this.planClaim(claim, this.now())) created++;
    return created;
  }
  private async planUntilBudget(at: Date, canAdmit: () => boolean) {
    let created = 0;
    for (let count = 0; count < this.settings.claim_batch_size && canAdmit(); count++) {
      // Claim one occurrence so stopping does not strand a preclaimed batch.
      const [claim] = await this.claimDue(at, 1); // NOSONAR -- Lease one occurrence before checking the next admission.
      if (!claim) break;
      if (await this.planClaim(claim, this.now())) created++; // NOSONAR -- Finish the leased occurrence before claiming another.
    }
    return created;
  }
}
