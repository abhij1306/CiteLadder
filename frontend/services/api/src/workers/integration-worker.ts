import { createHash, randomUUID } from 'node:crypto';
import { sql } from 'kysely';

import { policy } from '../config.ts';
import { crawlLogs } from '../config/crawl-logs.ts';
import { queueRecovery } from '../config/queue-recovery.ts';
import { recoverIntegrationLeases } from '../queue/recovery.ts';
import { leaseSignal, maintainLease } from '../queue/heartbeat.ts';
import type { Database } from '../db/database.ts';
import { getLogger } from '../logging.ts';
import type { ImportPage } from '../integrations/client.ts';
import type { Dataset, IntegrationProvider } from '../integrations/config.ts';
import { IntegrationClient, IntegrationError } from '../integrations/client.ts';
import { integrationPolicy, integrationSettings } from '../integrations/config.ts';
import { freshAccessToken } from '../integrations/tokens.ts';
import { normalizedRows } from '../integrations/normalize.ts';
import { extractMetadata } from '../integrations/partitions.ts';
import { projectHosts } from '../integrations/host-scope.ts';
import { lockCrawlState, enqueueRollup } from '../crawl-logs/state.ts';
import {
  activeSyncTarget,
  artifactOffset,
  selectedItemDataset,
} from '../integrations/sync-state.ts';
import { enqueuePostSyncProjections } from '../integrations/projections.ts';
import { nextDueAt } from '../queue/next-due.ts';

const logger = getLogger('workers.integrations');
const statuses = policy.task_queue.statuses;
const templates = Object.values(integrationPolicy.datasets);
const excluded = new Set(integrationPolicy.excluded_datasets);
// 13 bound parameters a row stays well inside PostgreSQL's 65,535 limit.
const METRIC_INSERT_BATCH = 2_000;
/** Marks a stop requested by the caller's deadline rather than a failure. */
const DEADLINE = Symbol('deadline');

type Run = {
  id: string;
  workspace_id: string;
  connection_id: string;
  mapping_id: string;
  project_id: string;
  property_ref: string;
  sync_kind: string;
  window_start: string;
  window_end: string;
  resync_seq: number;
  attempt_count: number;
  max_attempts: number;
};

function valueDate(value: string): string {
  return value.slice(0, 10);
}

type Artifact = { dataset: string; query_snapshot: unknown; row_count: number };
type Lease = { status: string; lease_owner: string | null; lease_live: boolean | null };

function ownsLease(current: Lease | undefined, owner: string): boolean {
  return (
    current?.status === statuses.running &&
    current.lease_owner === owner &&
    current.lease_live === true
  );
}

function failureDetail(failure: unknown): string {
  try {
    return JSON.stringify(failure) ?? 'Unknown integration failure';
  } catch {
    return 'Unserializable integration failure';
  }
}

export class IntegrationWorker {
  readonly #db: Database;
  readonly #owner = `integration-worker-ts-${randomUUID()}`;
  readonly #client: Pick<IntegrationClient, 'page'>;
  readonly #settings: ReturnType<typeof integrationSettings>;
  readonly #tokenResolver: typeof freshAccessToken;
  readonly #scope?: { workspaceId: string; runId: string };
  /** Pages this attempt committed; a deadline stop with progress is not charged. */
  #committedPages = 0;
  /** When this claim's first provider request started; null until one has. */
  #firstRequestAt: number | null = null;

  constructor(
    db: Database,
    client: Pick<IntegrationClient, 'page'> = new IntegrationClient(),
    settings: ReturnType<typeof integrationSettings> = integrationSettings(),
    tokenResolver: typeof freshAccessToken = freshAccessToken,
    scope?: { workspaceId: string; runId: string },
  ) {
    this.#db = db;
    this.#client = client;
    this.#settings = settings;
    this.#tokenResolver = tokenResolver;
    this.#scope = scope;
  }

  async runOnce(signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted) return false;
    await recoverIntegrationLeases(this.#db, queueRecovery.batchSize, this.#scope);
    if (signal?.aborted) return false;
    const run = await this.#claim();
    if (!run) return false;
    const heartbeat = maintainLease(
      () =>
        this.#db
          .updateTable('integration_sync_runs')
          .set({
            heartbeat_at: new Date(),
            lease_expires_at: sql<Date>`clock_timestamp() + ${this.#settings.lease_ttl_seconds} * interval '1 second'`,
            updated_at: new Date(),
          })
          .where('id', '=', run.id)
          .where('lease_owner', '=', this.#owner)
          .where('status', '=', statuses.running)
          .where('lease_expires_at', '>', sql<Date>`clock_timestamp()`)
          .executeTakeFirst()
          .then((result) => result.numUpdatedRows > 0n),
      this.#settings.heartbeat_interval_seconds * 1000,
      (error) => logger.exception('integration_heartbeat_failed', error, { sync_run_id: run.id }),
    );
    this.#committedPages = 0;
    this.#firstRequestAt = null;
    try {
      await this.#execute(run, leaseSignal(heartbeat.signal, signal));
      if (!heartbeat.signal.aborted) await this.#finish(run, null);
    } catch (error) {
      if (!heartbeat.signal.aborted) await this.#finish(run, signal?.aborted ? DEADLINE : error);
    } finally {
      await heartbeat.stop();
    }
    return true;
  }

  #claim(): Promise<Run | null> {
    return this.#db.transaction().execute(async (trx) => {
      // Least recently served workspace first, so one workspace's backlog cannot starve another's.
      const row = await trx
        .selectFrom('integration_sync_runs as run')
        .leftJoin('queue_workspace_turns as turns', (join) =>
          join
            .onRef('turns.workspace_id', '=', 'run.workspace_id')
            .on('turns.queue_name', '=', 'integration_sync_runs'),
        )
        .selectAll('run')
        .where('run.status', 'in', [statuses.queued, statuses.retry_wait])
        .where('run.available_at', '<=', sql<Date>`clock_timestamp()`)
        .whereRef('run.attempt_count', '<', 'run.max_attempts')
        .$if(this.#scope !== undefined, (q) =>
          q
            .where('run.workspace_id', '=', this.#scope!.workspaceId)
            .where('run.id', '=', this.#scope!.runId),
        )
        .orderBy(sql`turns.last_claimed_at asc nulls first`)
        .orderBy('run.priority', 'desc')
        .orderBy('run.available_at', 'asc')
        .orderBy('run.randomized_position', 'asc')
        .forUpdate('run')
        .skipLocked()
        .limit(1)
        .executeTakeFirst();
      if (!row) return null;
      const claimedAt = new Date();
      const updated = await trx
        .updateTable('integration_sync_runs')
        .set({
          status: statuses.running,
          lease_owner: this.#owner,
          lease_expires_at: sql<Date>`clock_timestamp() + ${this.#settings.lease_ttl_seconds} * interval '1 second'`,
          heartbeat_at: new Date(),
          attempt_count: row.attempt_count + 1,
          updated_at: new Date(),
        })
        .where('id', '=', row.id)
        .where('status', 'in', [statuses.queued, statuses.retry_wait])
        .returningAll()
        .returning([
          sql<string>`window_start::text`.as('window_start'),
          sql<string>`window_end::text`.as('window_end'),
        ])
        .executeTakeFirst();
      if (updated) {
        await trx
          .insertInto('queue_workspace_turns')
          .values({
            id: randomUUID(),
            queue_name: 'integration_sync_runs',
            workspace_id: updated.workspace_id,
            last_claimed_at: claimedAt,
            created_at: claimedAt,
          })
          .onConflict((conflict) =>
            conflict.constraint('uq_queue_workspace_turn').doUpdateSet({
              last_claimed_at: sql`greatest(queue_workspace_turns.last_claimed_at, ${claimedAt})`,
            }),
          )
          .execute();
        await trx
          .insertInto('integration_events')
          .values({
            id: randomUUID(),
            workspace_id: updated.workspace_id,
            connection_id: updated.connection_id,
            grant_id: null,
            event_type: 'integration.sync_started',
            message: 'Integration sync started',
            payload: JSON.stringify({ sync_run_id: updated.id }),
            created_at: new Date(),
          })
          .execute();
      }
      return (updated ?? null) as Run | null;
    });
  }

  /** Earliest claimable run or lease expiry, so an idle runner stays for a retry, history chunk or recovery due soon. */
  nextDue(): Promise<Date | null> {
    return nextDueAt(this.#db, {
      table: 'integration_sync_runs',
      claimable: [statuses.queued, statuses.retry_wait],
      ready: sql`attempt_count < max_attempts`,
    });
  }

  async #execute(run: Run, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    await this.#db.transaction().execute(async (trx) => {
      await this.#ownedTarget(trx, run);
    });
    const connection = await this.#db
      .selectFrom('integration_connections as connection')
      .innerJoin('integration_oauth_grants as grant', 'grant.id', 'connection.grant_id')
      .select([
        'connection.provider',
        'connection.grant_id',
        'connection.dataset_capabilities',
        'grant.status as grant_status',
      ])
      .where('connection.id', '=', run.connection_id)
      .where('connection.workspace_id', '=', run.workspace_id)
      .where('grant.workspace_id', '=', run.workspace_id)
      .executeTakeFirst();
    if (!connection)
      throw new IntegrationError('unmapped_property', 'Integration connection no longer exists');
    if (connection.grant_status !== 'connected')
      throw new IntegrationError('grant_auth_failed', 'Integration grant needs reconnection');
    const provider = connection.provider as 'gsc' | 'ga4' | 'bing';
    const artifacts = await this.#db
      .selectFrom('integration_import_artifacts')
      .select(['dataset', 'query_snapshot', 'row_count'])
      .where('sync_run_id', '=', run.id)
      .where('workspace_id', '=', run.workspace_id)
      .execute();
    await this.#importTemplates(
      run,
      provider,
      connection.grant_id,
      this.#selectedTemplates(provider, connection.dataset_capabilities),
      artifacts,
      signal,
    );
  }

  /** Dataset imports share a grant and lease; finish each before advancing. */
  async #importTemplates(
    run: Run,
    provider: IntegrationProvider,
    grantId: string,
    templates: Dataset[],
    artifacts: Artifact[],
    signal: AbortSignal,
  ): Promise<void> {
    const [template, ...remaining] = templates;
    if (!template) return;
    signal.throwIfAborted();
    await this.#importDataset(run, provider, grantId, template, artifacts, signal);
    await this.#importTemplates(run, provider, grantId, remaining, artifacts, signal);
  }

  #selectedTemplates(provider: IntegrationProvider, capabilities: unknown) {
    const selected = selectedItemDataset(capabilities);
    return templates.filter(
      (template) =>
        template.provider === provider &&
        !excluded.has(template.dataset) &&
        (provider !== 'ga4' ||
          !template.dataset.startsWith('ga4_item_') ||
          template.dataset === selected),
    );
  }

  async #importDataset(
    run: Run,
    provider: IntegrationProvider,
    grantId: string,
    initial: Dataset,
    artifacts: Artifact[],
    signal: AbortSignal,
  ): Promise<void> {
    let template = initial;
    const previousPages = artifacts.filter((item) => item.dataset === template.dataset);
    const offsets = new Set(previousPages.map((item) => artifactOffset(item.query_snapshot)));
    if (provider === 'bing' && offsets.has(0)) return;
    const lastOffset = Math.max(...offsets);
    if (
      previousPages.some(
        (item) =>
          artifactOffset(item.query_snapshot) >= 0 &&
          artifactOffset(item.query_snapshot) === lastOffset &&
          item.row_count < this.#settings.sync_page_size,
      )
    )
      return;
    let offset = offsets.size ? lastOffset + this.#settings.sync_page_size : 0;
    // Commit each offset under the lease before fetching its successor.
    for (let pageNumber = 0; pageNumber < this.#settings.sync_max_pages; pageNumber += 1) {
      signal.throwIfAborted();
      if (offsets.has(offset)) {
        offset += this.#settings.sync_page_size;
        continue;
      }
      await this.#db.transaction().execute(async (trx) => {
        await this.#ownedTarget(trx, run);
      });
      const fetched = await this.#fetchPage(
        run,
        provider,
        grantId,
        template,
        offset,
        offsets.size > 0,
        signal,
      );
      signal.throwIfAborted();
      template = fetched.template;
      await this.#persistPage(run, provider, template, offset, fetched.page);
      offsets.add(offset);
      this.#committedPages += 1;
      if (provider === 'bing' || fetched.page.rawRowCount < this.#settings.sync_page_size) return;
      offset += this.#settings.sync_page_size;
      if (pageNumber === this.#settings.sync_max_pages - 1)
        throw new IntegrationError(
          'provider_api_error',
          'Integration paging exceeded its configured bound',
        );
    }
  }

  async #fetchPage(
    run: Run,
    provider: IntegrationProvider,
    grantId: string,
    template: Dataset,
    offset: number,
    hasPages: boolean,
    signal: AbortSignal,
  ) {
    signal.throwIfAborted();
    let page;
    try {
      page = await this.#page(run, provider, grantId, template, offset);
    } catch (error) {
      if (
        !(error instanceof IntegrationError) ||
        error.code !== integrationPolicy.contracts.ERROR_GA4_DIMENSION_INCOMPATIBLE ||
        template.dataset !== 'ga4_item_source_medium_daily' ||
        hasPages
      )
        throw error;
      signal.throwIfAborted();
      template = await this.#itemFallback(run);
      signal.throwIfAborted();
      page = await this.#page(run, provider, grantId, template, offset);
    }

    return { page, template };
  }

  /**
   * One provider page with a token resolved for it: a run can outlast the
   * refresh skew. A 401 refreshes the refused token once before it counts as
   * a credential failure that demotes the grant.
   */
  async #page(
    run: Run,
    provider: IntegrationProvider,
    grantId: string,
    template: Dataset,
    offset: number,
  ) {
    const fetch = (token: string) => {
      this.#firstRequestAt ??= performance.now();
      return this.#client.page(
        provider,
        token,
        run.property_ref,
        template,
        valueDate(run.window_start),
        valueDate(run.window_end),
        offset,
      );
    };
    const token = await this.#tokenResolver(this.#db, grantId, run.workspace_id);
    try {
      return await fetch(token);
    } catch (error) {
      if (!(error instanceof IntegrationError) || error.httpStatus !== 401) throw error;
      return fetch(
        await this.#tokenResolver(this.#db, grantId, run.workspace_id, undefined, token),
      );
    }
  }

  async #persistPage(
    run: Run,
    provider: IntegrationProvider,
    template: Dataset,
    offset: number,
    page: ImportPage,
  ): Promise<void> {
    const encoded = JSON.stringify(page.payload);
    if (Buffer.byteLength(encoded, 'utf8') > this.#settings.max_inline_payload_bytes)
      throw new IntegrationError(
        'payload_too_large',
        'Integration page exceeds the configured payload limit',
      );
    const id = randomUUID();
    const payloadHash = createHash('sha256').update(encoded).digest('hex');
    const snapshot = {
      dimensions: template.dimensions,
      metrics: template.metrics,
      date_range: { start: valueDate(run.window_start), end: valueDate(run.window_end) },
      startRow: offset,
      partition_complete: provider === 'bing' || page.rawRowCount < this.#settings.sync_page_size,
    };
    const { rows, invalid, received } = normalizedRows(
      provider,
      template.dataset,
      template,
      page.payload,
      valueDate(run.window_start),
      valueDate(run.window_end),
    );
    // Rows the provider sent that never became a payload row (Bing parses before
    // persisting) are invalid too; rows merely dated outside the window are not.
    const metadata = extractMetadata(
      page.payload,
      invalid > 0 || received !== page.rawRowCount,
      provider,
    );
    await this.#db.transaction().execute(async (trx) => {
      await this.#ownedTarget(trx, run);
      const hosts =
        template.dataset === 'ga4_landing_daily'
          ? await projectHosts(trx, run.workspace_id, run.project_id)
          : null;
      const excludedRows = hosts
        ? rows.filter(
            (row) =>
              !hosts.has(
                row.dimension_key
                  .split(integrationPolicy.dimension_separator)
                  .at(-2)!
                  .toLowerCase(),
              ),
          )
        : [];
      const excludedByDate: Record<string, number> = {};
      for (const row of excludedRows)
        excludedByDate[row.date] = (excludedByDate[row.date] ?? 0) + 1;
      await trx
        .insertInto('integration_import_artifacts')
        .values({
          id,
          sync_run_id: run.id,
          connection_id: run.connection_id,
          workspace_id: run.workspace_id,
          provider,
          dataset: template.dataset,
          query_snapshot: JSON.stringify(snapshot),
          payload_hash: payloadHash,
          fetched_at: new Date(),
          row_count: page.rawRowCount,
          payload: encoded,
          extract_metadata: JSON.stringify({
            ...metadata,
            excluded_host_rows: excludedRows.length,
            excluded_host_rows_by_date: excludedByDate,
          }),
          created_at: new Date(),
        })
        .execute();
      // All derived rows use the same artifact and locked page transaction,
      // batched so a 25,000-row page is a few statements rather than one per row.
      const createdAt = new Date();
      for (let index = 0; index < rows.length; index += METRIC_INSERT_BATCH) {
        await trx
          .insertInto('integration_metric_rows')
          .values(
            rows.slice(index, index + METRIC_INSERT_BATCH).map((row) => ({
              id: randomUUID(),
              workspace_id: run.workspace_id,
              project_id: run.project_id,
              property_ref: run.property_ref,
              provider,
              dataset: template.dataset,
              date: new Date(`${row.date}T00:00:00Z`),
              dimension_key: row.dimension_key,
              metrics: JSON.stringify(row.metrics),
              source_artifact_id: id,
              resync_seq: run.resync_seq,
              importer_version: integrationPolicy.importer_version,
              created_at: createdAt,
            })),
          )
          .onConflict((conflict) =>
            conflict
              .columns([
                'project_id',
                'property_ref',
                'provider',
                'dataset',
                'date',
                'dimension_key',
                'resync_seq',
              ])
              .doNothing(),
          )
          .execute();
      }
      if (provider === 'ga4') {
        const updated = await trx
          .updateTable('integration_property_mappings')
          .set({
            reporting_timezone: metadata.timeZone,
            currency_code: metadata.currencyCode,
          })
          .where('workspace_id', '=', run.workspace_id)
          .where('id', '=', run.mapping_id)
          .where(sql<boolean>`not exists (
            select 1 from integration_sync_runs newer
            join integration_import_artifacts artifact on artifact.workspace_id=newer.workspace_id and artifact.sync_run_id=newer.id
            where newer.workspace_id=${run.workspace_id}::uuid and newer.mapping_id=${run.mapping_id}::uuid
              and newer.resync_seq>${run.resync_seq} and artifact.provider='ga4')`)
          .returning('id')
          .executeTakeFirst();
        if (updated && metadata.timeZone) {
          const scope = { workspaceId: run.workspace_id, projectId: run.project_id };
          const state = await lockCrawlState(trx, scope);
          if (state.reporting_timezone !== metadata.timeZone) {
            await trx
              .updateTable('crawl_log_states')
              .set({ reporting_timezone: metadata.timeZone })
              .where('workspace_id', '=', run.workspace_id)
              .where('project_id', '=', run.project_id)
              .execute();
            await enqueueRollup(trx, scope, new Date(), {
              first: new Date(Date.now() - (crawlLogs.retention_days - 1) * 86400000),
              last: new Date(),
            });
          }
        }
      }
    });
  }

  async #ownedTarget(db: Database, run: Run) {
    const current = await db
      .selectFrom('integration_sync_runs')
      .select([
        'status',
        'lease_owner',
        sql<boolean>`lease_expires_at > clock_timestamp()`.as('lease_live'),
      ])
      .where('id', '=', run.id)
      .where('workspace_id', '=', run.workspace_id)
      .forUpdate()
      .executeTakeFirst();
    if (!ownsLease(current, this.#owner))
      throw new IntegrationError('provider_api_error', 'Integration sync lease was lost');
    return activeSyncTarget(db, run);
  }

  #itemFallback(run: Run) {
    return this.#db.transaction().execute(async (trx) => {
      const connection = await this.#ownedTarget(trx, run);
      const template = templates.find((item) => item.dataset === 'ga4_item_channel_group_daily');
      if (!template) throw new Error('GA4 item fallback policy is missing');
      const capabilities =
        typeof connection.dataset_capabilities === 'object' &&
        connection.dataset_capabilities !== null
          ? connection.dataset_capabilities
          : {};
      await trx
        .updateTable('integration_connections')
        .set({
          dataset_capabilities: JSON.stringify({
            ...capabilities,
            [integrationPolicy.ga4_capability_key]: {
              selected_dataset: template.dataset,
              source_granularity: integrationPolicy.ga4_fallback_granularity,
              reason: integrationPolicy.contracts.ERROR_GA4_DIMENSION_INCOMPATIBLE,
              version: integrationPolicy.ga4_capability_version,
            },
          }),
          updated_at: new Date(),
        })
        .where('id', '=', run.connection_id)
        .where('workspace_id', '=', run.workspace_id)
        .execute();
      return template;
    });
  }

  async #finish(run: Run, failure: unknown): Promise<void> {
    const now = new Date();
    await this.#db.transaction().execute(async (trx) => {
      const current = await trx
        .selectFrom('integration_sync_runs')
        .select([
          'status',
          'lease_owner',
          sql<boolean>`lease_expires_at > clock_timestamp()`.as('lease_live'),
        ])
        .where('id', '=', run.id)
        .where('workspace_id', '=', run.workspace_id)
        .forUpdate()
        .executeTakeFirst();
      if (!ownsLease(current, this.#owner)) return;
      if (failure === null) {
        try {
          await this.#ownedTarget(trx, run);
        } catch (error) {
          failure = error;
        }
      }
      if (failure === null) await this.#succeed(trx, run, now);
      else if (failure === DEADLINE) await this.#release(trx, run, now);
      else await this.#fail(trx, run, now, failure);
    });
  }

  /**
   * The caller's deadline stopped the run, not the provider. Committed pages
   * resume on the next claim, so an attempt that made progress is refunded, as
   * is one stopped before its first provider request had a full request
   * timeout (admitted late in a drain, or slowed by setup). One that had that time and committed nothing still
   * counts, which bounds a run that cannot finish a single page.
   */
  async #release(trx: Database, run: Run, now: Date): Promise<void> {
    const started = this.#firstRequestAt;
    const admittedLate =
      started === null ||
      performance.now() - started < this.#settings.sync_request_timeout_seconds * 1000;
    const refund = this.#committedPages > 0 || admittedLate ? 1 : 0;
    const exhausted = run.attempt_count - refund >= run.max_attempts;
    if (exhausted) {
      await this.#fail(
        trx,
        run,
        now,
        new IntegrationError('provider_api_error', 'Execution deadline reached', false),
      );
      return;
    }
    await trx
      .updateTable('integration_sync_runs')
      .set({
        status: statuses.queued,
        available_at: now,
        attempt_count: run.attempt_count - refund,
        lease_owner: null,
        lease_expires_at: null,
        updated_at: now,
      })
      .where('id', '=', run.id)
      .execute();
  }

  async #succeed(trx: Database, run: Run, now: Date): Promise<void> {
    await trx
      .updateTable('integration_sync_runs')
      .set({
        status: statuses.succeeded,
        completed_at: now,
        lease_owner: null,
        lease_expires_at: null,
        updated_at: now,
        error_code: '',
        error_detail: '',
      })
      .where('id', '=', run.id)
      .execute();
    await trx
      .updateTable('integration_connections')
      .set({ last_synced_at: now, updated_at: now })
      .where('id', '=', run.connection_id)
      .where('workspace_id', '=', run.workspace_id)
      .execute();
    await trx
      .insertInto('integration_events')
      .values({
        id: randomUUID(),
        workspace_id: run.workspace_id,
        connection_id: run.connection_id,
        grant_id: null,
        event_type: 'integration.sync_finished',
        message: 'Integration sync completed',
        payload: JSON.stringify({ sync_run_id: run.id }),
        created_at: now,
      })
      .execute();
    await enqueuePostSyncProjections(trx, run);
  }

  async #fail(trx: Database, run: Run, now: Date, failure: unknown): Promise<void> {
    const error = failure instanceof Error ? failure : new Error(failureDetail(failure));
    const retryable = failure instanceof IntegrationError && failure.retryable;
    const retry = retryable && run.attempt_count < run.max_attempts;
    const retryDelay = this.#retryDelay(run, failure);
    await trx
      .updateTable('integration_sync_runs')
      .set({
        status: retry ? statuses.retry_wait : statuses.failed,
        available_at: retry ? new Date(now.getTime() + retryDelay * 1000) : now,
        completed_at: retry ? null : now,
        lease_owner: null,
        lease_expires_at: null,
        updated_at: now,
        error_code: failure instanceof IntegrationError ? failure.code : 'provider_api_error',
        error_detail: error.message.slice(0, 512),
      })
      .where('id', '=', run.id)
      .execute();
    if (failure instanceof IntegrationError && failure.code === 'grant_auth_failed') {
      await trx
        .updateTable('integration_oauth_grants')
        .set({ status: 'needs_reauth', updated_at: now })
        .where(
          'id',
          '=',
          (
            await trx
              .selectFrom('integration_connections')
              .select('grant_id')
              .where('id', '=', run.connection_id)
              .where('workspace_id', '=', run.workspace_id)
              .executeTakeFirstOrThrow()
          ).grant_id,
        )
        .where('workspace_id', '=', run.workspace_id)
        .execute();
    }
    await trx
      .insertInto('integration_events')
      .values({
        id: randomUUID(),
        workspace_id: run.workspace_id,
        connection_id: run.connection_id,
        grant_id: null,
        event_type:
          failure instanceof IntegrationError && failure.code === 'grant_auth_failed'
            ? 'integration.reauth_required'
            : 'integration.sync_finished',
        message: retry ? 'Integration sync will retry' : 'Integration sync failed',
        payload: JSON.stringify({
          sync_run_id: run.id,
          error_code: failure instanceof IntegrationError ? failure.code : 'provider_api_error',
          retry,
        }),
        created_at: now,
      })
      .execute();
    logger.warning('integration_sync_failed', {
      sync_run_id: run.id,
      error_code: failure instanceof IntegrationError ? failure.code : 'provider_api_error',
      retry,
    });
    if (!retry) await enqueuePostSyncProjections(trx, run, true);
  }

  #retryDelay(run: Run, failure: unknown): number {
    if (failure instanceof IntegrationError && failure.retryAfter !== null)
      return Math.min(failure.retryAfter, this.#settings.retry_max_delay_seconds);
    return Math.min(
      this.#settings.retry_base_delay_seconds * 2 ** Math.max(0, run.attempt_count - 1),
      this.#settings.retry_max_delay_seconds,
    );
  }
}
