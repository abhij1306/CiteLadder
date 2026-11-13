/**
 * Starts each due scheduled crawl through ordinary crawl admission
 * (`createCrawl`), so the configured limits and the one-active-crawl rule
 * apply exactly as to Run new crawl. Planning only writes
 * rows; the site-health lane fetches after the admission commits.
 */
import { randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import { crawlScheduleCadenceSchema } from '@citeladder/contracts/site-health';
import { policy } from '../config.ts';
import { resolveSettingSpec, type SettingSource } from '../config/settings.ts';
import type { Database } from '../db/database.ts';
import { ApiError } from '../errors.ts';
import { getLogger } from '../logging.ts';
import { createCrawl } from '../site-health/planner.ts';
import { crawlRequest } from '../site-health/crawl-request.ts';
import { claimDueCrawlSchedules, nextOccurrence } from '../site-health/schedules.ts';

export function crawlSchedulerSettings(env: SettingSource = process.env) {
  return Object.fromEntries(
    Object.entries(policy.crawl_schedules.settings).map(([name, spec]) => [
      name,
      Number(resolveSettingSpec(spec, env)),
    ]),
  ) as Record<keyof typeof policy.crawl_schedules.settings, number>;
}

/** Refusals that skip one occurrence: the next one may well be admitted. */
const SKIPPED = new Set(['crawl_already_active']);

type ScheduleClaim = Awaited<ReturnType<typeof claimDueCrawlSchedules>>[number];
const logger = getLogger('workers.crawl_scheduler');

export class CrawlScheduler {
  readonly db: Database;
  readonly settings: ReturnType<typeof crawlSchedulerSettings>;
  readonly owner: string;
  readonly now: () => Date;
  constructor(
    db: Database,
    settings = crawlSchedulerSettings(),
    options: { owner?: string; now?: () => Date } = {},
  ) {
    this.db = db;
    this.settings = settings;
    this.owner = options.owner ?? `crawl-scheduler-${randomBytes(6).toString('hex')}`;
    this.now = options.now ?? (() => new Date());
  }

  claimDue(at: Date, limit = this.settings.claim_batch_size) {
    return claimDueCrawlSchedules(this.db, {
      owner: this.owner,
      at,
      limit,
      leaseSeconds: this.settings.lease_ttl_seconds,
    });
  }

  /** Plans one leased occurrence; true when it started a crawl. */
  planClaim(claim: ScheduleClaim, at = this.now()) {
    return this.db.transaction().execute(async (trx) => {
      const schedule = await trx
        .selectFrom('crawl_schedules')
        .selectAll()
        .where('workspace_id', '=', claim.workspaceId)
        .where('id', '=', claim.id)
        .where('lease_owner', '=', this.owner)
        .where('lease_expires_at', '>', sql<Date>`clock_timestamp()`)
        .forUpdate()
        .executeTakeFirst();
      if (!schedule) return false;
      const release = { lease_owner: null, lease_expires_at: null, updated_at: at };
      const scoped = trx
        .updateTable('crawl_schedules')
        .where('id', '=', schedule.id)
        .where('workspace_id', '=', claim.workspaceId);
      // Turned off or replanned since the claim: this occurrence is gone.
      if (!schedule.enabled || schedule.next_run_at?.getTime() !== claim.scheduledFor.getTime()) {
        await scoped.set(release).execute();
        return false;
      }
      const next = nextOccurrence(
        crawlScheduleCadenceSchema.parse(schedule.cadence),
        claim.scheduledFor,
        at,
      );
      await sql`savepoint crawl_schedule_planning`.execute(trx);
      try {
        const crawl = await createCrawl(
          trx,
          schedule.workspace_id,
          await crawlRequest(trx, schedule.workspace_id, schedule.project_id),
        );
        await sql`release savepoint crawl_schedule_planning`.execute(trx);
        await scoped
          .set({
            ...release,
            next_run_at: next,
            last_run_at: at,
            last_outcome: 'created',
            last_crawl_id: crawl.id,
            failure_count: 0,
            last_error: '',
            last_failure_at: null,
          })
          .execute();
        logger.info('scheduled_crawl_created', { schedule_id: schedule.id, crawl_id: crawl.id });
        return true;
      } catch (error) {
        await sql`rollback to savepoint crawl_schedule_planning`.execute(trx);
        await sql`release savepoint crawl_schedule_planning`.execute(trx);
        const code = error instanceof ApiError ? error.code : null;
        if (code && SKIPPED.has(code)) {
          await scoped.set({ ...release, next_run_at: next, last_outcome: code }).execute();
          logger.info('scheduled_crawl_skipped', { schedule_id: schedule.id, reason: code });
          return false;
        }
        // The admission reason (invalid root, limit change) is what the owner can act on.
        const reason = code ?? 'crawl_planning_failed';
        const failures = schedule.failure_count + 1;
        const retrying = failures < this.settings.max_consecutive_failures;
        await scoped
          .set({
            ...release,
            failure_count: failures,
            last_outcome: 'failed',
            last_error: reason,
            last_failure_at: at,
            enabled: retrying,
            next_run_at: retrying
              ? new Date(at.getTime() + this.settings.failure_retry_seconds * 1000)
              : null,
          })
          .execute();
        logger.warning('scheduled_crawl_failed', { schedule_id: schedule.id, error: reason });
        return false;
      }
    });
  }

  /** Claims one occurrence at a time while the shared periodic budget admits more. */
  async runOnce(at = this.now(), canAdmit: () => boolean = () => true) {
    let created = 0;
    for (let count = 0; count < this.settings.claim_batch_size && canAdmit(); count++) {
      const [claim] = await this.claimDue(at, 1); // NOSONAR -- Lease one occurrence before checking the next admission.
      if (!claim) break;
      if (await this.planClaim(claim, this.now())) created++; // NOSONAR -- Finish the leased occurrence before claiming another.
    }
    return created;
  }
}
