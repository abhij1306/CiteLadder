import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';

import { policy } from '../config.ts';
import { queueRecovery } from '../config/queue-recovery.ts';
import { recoverDiscoveryLeases } from '../queue/recovery.ts';
import { leaseSignal, maintainLease } from '../queue/heartbeat.ts';
import type { Database } from '../db/database.ts';
import { jsonObject } from '../db/json.ts';
import { getLogger } from '../logging.ts';
import { discoveryProgress, discoveryRow } from '../projects/discovery.ts';
import { discoveryCreate, discoverySettings } from '../projects/discovery-inputs.ts';
import { researchBrand, type ResearchDependencies } from '../projects/research.ts';
import { resolveSite } from '../projects/site-resolution.ts';
import { FetchError, fetchWebsite } from '../projects/safe-fetch.ts';
import { meterFor, type Meter } from '../models/metering.ts';
import {
  DiscoveryQueue,
  type DiscoveryTask,
  type DiscoveryTarget,
} from '../queue/discovery-queue.ts';

const cfg = policy.discovery.constants;
const logger = getLogger('app.workers.brand_discovery_worker');
type Result = Awaited<ReturnType<typeof researchBrand>>;
/** Research dependencies; each task meters its own workspace. */
type WorkerDependencies = Omit<ResearchDependencies, 'meter'> & {
  meter?: (workspaceId: string) => Meter;
};
function siteFailure(error: unknown): error is FetchError {
  return (
    error instanceof FetchError &&
    ['invalid_url', 'site_not_found', 'ssrf_blocked', 'out_of_scope'].includes(error.code)
  );
}
function retryable(error: unknown, attempt: number, maximum: number) {
  return error != null && !siteFailure(error) && attempt < maximum;
}
function terminalStatus(retry: boolean, error: unknown) {
  if (retry) return policy.task_queue.statuses.retry_wait;
  return error != null ? policy.task_queue.statuses.failed : policy.task_queue.statuses.succeeded;
}
export class DiscoveryWorker {
  readonly queue: DiscoveryQueue;
  readonly settings: ReturnType<typeof discoverySettings>;
  readonly db: Database;
  readonly dependencies: WorkerDependencies;
  constructor(db: Database, dependencies: WorkerDependencies = {}) {
    this.db = db;
    this.dependencies = dependencies;
    this.settings = discoverySettings(dependencies.env);
    if (this.settings.heartbeat_interval_seconds >= this.settings.lease_seconds)
      throw new Error('Discovery heartbeat must be shorter than the lease');
    this.queue = new DiscoveryQueue(db, this.settings.lease_seconds);
  }
  async runOnce(owner: string, target?: DiscoveryTarget, signal?: AbortSignal): Promise<boolean> {
    // Interactive admission touches only its authorized discovery. The runner
    // and periodic recovery retain ownership of sweeping expired leases.
    if (!target) await recoverDiscoveryLeases(this.db);
    signal?.throwIfAborted();
    const task = await this.queue.claim(owner, target);
    if (!task) return false;
    const heartbeat = maintainLease(
      () => this.queue.heartbeat(task, owner),
      this.settings.heartbeat_interval_seconds * 1000,
      (error) => logger.exception('discovery_heartbeat_failed', error, { task_id: task.id }),
    );
    const executionSignal = leaseSignal(heartbeat.signal, signal);
    const checkCancelled = () => executionSignal.throwIfAborted();
    const fetcher: typeof fetchWebsite = async (url, options) => {
      checkCancelled();
      return (this.dependencies.fetcher ?? fetchWebsite)(url, {
        ...options,
        signal: leaseSignal(executionSignal, options?.signal),
      });
    };
    try {
      const row = await discoveryRow(this.db, task.workspace_id, task.discovery_id);
      if ([cfg.discovery_status_ready, cfg.discovery_status_project_created].includes(row.status)) {
        await this.finish(task, owner, null, null);
        return true;
      }
      const input = discoveryCreate.parse(row.input_data);
      await this.progress(task, owner, 'opening_website', 0);
      const site = await resolveSite(input.website_url, fetcher);
      checkCancelled();
      const homepageRead = site.page ? 1 : 0;
      await this.progress(task, owner, 'understanding_business', 1, homepageRead, site);
      const result = await researchBrand(input, site, {
        ...this.dependencies,
        meter: (this.dependencies.meter ?? ((workspaceId) => meterFor(this.db, workspaceId)))(
          task.workspace_id,
        ),
        fetcher,
        signal: executionSignal,
        checkCancelled,
        transport: async (url, options) => {
          checkCancelled();
          return (this.dependencies.transport ?? fetch)(url, {
            ...options,
            signal: leaseSignal(executionSignal, options?.signal),
          });
        },
        onCompetitors: async () => {
          checkCancelled();
          await this.progress(task, owner, 'finding_competitors', 2, homepageRead);
        },
      });
      checkCancelled();
      await this.finish(task, owner, result, null);
    } catch (error) {
      if (heartbeat.signal.aborted) return true;
      logger.warning('brand discovery task failed', {
        task_id: task.id,
        workspace_id: task.workspace_id,
        error_code: error instanceof FetchError ? error.code : cfg.error_brand_discovery,
      });
      await this.finish(task, owner, null, error);
    } finally {
      await heartbeat.stop();
    }
    return true;
  }
  async progress(
    task: DiscoveryTask,
    owner: string,
    phase: string,
    steps: number,
    pages = 0,
    site?: { url: string; domain: string },
  ) {
    await this.db.transaction().execute(async (trx) => {
      if (!(await this.queue.lockedTask(trx, task, owner))) throw new Error('lease_lost');
      const row = await discoveryRow(trx, task.workspace_id, task.discovery_id, true);
      if (!(await this.queue.lockedTask(trx, task, owner))) throw new Error('lease_lost');
      await trx
        .updateTable('brand_discoveries')
        .set({
          status: cfg.discovery_status_running,
          stage: phase,
          progress: JSON.stringify(discoveryProgress(phase, steps, pages)),
          ...(site
            ? {
                input_data: JSON.stringify({
                  ...jsonObject(row.input_data, 'discovery.input_data'),
                  website_url: site.url,
                }),
                domains: JSON.stringify([site.domain]),
              }
            : {}),
          updated_at: new Date(),
        })
        .where('id', '=', row.id)
        .where('workspace_id', '=', task.workspace_id)
        .execute();
    });
  }
  async finish(task: DiscoveryTask, owner: string, result: Result | null, error: unknown) {
    await this.db.transaction().execute(async (trx) => {
      const held = await this.queue.lockedTask(trx, task, owner);
      if (!held) return;
      const row = await discoveryRow(trx, task.workspace_id, task.discovery_id, true);
      if (!(await this.queue.lockedTask(trx, task, owner))) return;
      const now = new Date();
      const attempt = held.attempt_count + 1;
      const retry = retryable(error, attempt, held.max_attempts);
      if (result) {
        await trx
          .insertInto('brand_research_snapshots')
          .values({
            id: randomUUID(),
            workspace_id: task.workspace_id,
            discovery_id: row.id,
            research_version: cfg.brand_discovery_version,
            provider: result.provider,
            model: result.model,
            method: 'first_party+keenable+structured_models',
            extracted_fields: JSON.stringify(result.snapshot),
            field_confidence: JSON.stringify(result.profile.field_confidence),
            evidence: JSON.stringify(result.evidence),
            warnings: JSON.stringify(result.warnings),
            created_at: now,
          })
          .execute();
        await trx
          .updateTable('brand_discoveries')
          .set({
            status: cfg.discovery_status_ready,
            stage: 'review',
            profile: JSON.stringify(result.profile),
            competitors: JSON.stringify(result.competitors),
            evidence: JSON.stringify(result.evidence),
            warnings: JSON.stringify(result.warnings),
            error_code: '',
            error_detail: '',
            progress: JSON.stringify(
              discoveryProgress(
                'preparing_review',
                cfg.discovery_progress_total_steps - 1,
                result.pagesRead,
                result.competitors.length,
              ),
            ),
            updated_at: now,
          })
          .where('id', '=', row.id)
          .where('workspace_id', '=', task.workspace_id)
          .execute();
      } else if (
        error != null &&
        !retry &&
        ![cfg.discovery_status_ready, cfg.discovery_status_project_created].includes(row.status)
      ) {
        await trx
          .updateTable('brand_discoveries')
          .set({
            status: cfg.discovery_status_failed,
            stage: 'failed',
            error_code: siteFailure(error) ? error.code : cfg.error_brand_discovery,
            error_detail: 'Brand research could not complete',
            warnings: JSON.stringify(['research_degraded']),
            updated_at: now,
          })
          .where('id', '=', row.id)
          .where('workspace_id', '=', task.workspace_id)
          .execute();
      }
      const finalized = await trx
        .updateTable('brand_discovery_tasks')
        .set({
          status: terminalStatus(retry, error),
          attempt_count: attempt,
          completed_at: retry ? null : now,
          available_at: retry
            ? new Date(now.getTime() + this.settings.failure_backoff_max_seconds * 1000)
            : now,
          lease_owner: null,
          lease_expires_at: null,
          error_code: error != null ? cfg.error_brand_discovery : '',
          error_detail: error != null ? 'Brand research could not complete' : '',
          updated_at: now,
        })
        .where('id', '=', task.id)
        .where('workspace_id', '=', task.workspace_id)
        .where('lease_owner', '=', owner)
        .where('status', '=', policy.task_queue.statuses.running)
        .where('lease_expires_at', '>', sql<Date>`clock_timestamp()`)
        .executeTakeFirst();
      if (finalized.numUpdatedRows !== 1n) throw new Error('lease_lost');
    });
  }

  async runUntilIdle(signal?: AbortSignal) {
    const owner = `brand-discovery-drain:${randomUUID()}`;
    const deadline = performance.now() + queueRecovery.drainBudgetSeconds * 1000;
    let count = 0;
    while (
      count < policy.task_queue.max_drain_batches &&
      !signal?.aborted &&
      performance.now() < deadline
    ) {
      if (!(await this.runOnce(owner))) break;
      count++;
    }
    return count;
  }
}
