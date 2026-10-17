import { createHash, randomUUID } from 'node:crypto';
import ipaddr from 'ipaddr.js';
import { crawlLogs } from '../config/crawl-logs.ts';
import { crawlers } from '../config/crawlers.ts';
import { fetchWebsite, type WebsiteFetcher } from '../projects/safe-fetch.ts';
import { hash } from '../traffic/normalization.ts';
import { record } from '../db/json.ts';
import { enqueueTask } from '../referrals/enqueue.ts';
import type { Database } from '../db/database.ts';
import type { Executor } from '../workers/executor.ts';
import { sql } from 'kysely';
import { enqueueRollup, lockCrawlState, type CrawlScope } from './state.ts';
import { enqueueTrafficInsights } from './insights-enqueue.ts';
import { stallQuietSources } from './stall.ts';
import { enqueueDuePulls } from './pull.ts';

export function botIpRangeRefresh(fetcher: WebsiteFetcher = fetchWebsite): Executor {
  return async (task, { checkCancelled }) => {
    const bot = crawlers.bots.find((b) => b.bot_id === record(task.payload).bot_id);
    if (bot?.verification.method !== 'ip_ranges') throw new Error('Unknown IP range bot');
    await checkCancelled('ip-range-dispatch');
    const source = bot.verification.source_url;
    let cidrs: string[] = [],
      status = 'failed',
      contentHash = hash('');
    const fetchedAt = new Date();
    try {
      // Analytics running dispatch was committed by the owning worker before this I/O.
      const response = await fetcher(source, {
        maxBytes: crawlLogs.ip_range_max_bytes,
        maxDecodedBytes: crawlLogs.ip_range_max_bytes,
        timeoutSeconds: crawlLogs.ip_range_timeout_seconds,
        redirects: crawlLogs.ip_range_max_redirects,
        contentTypes: ['application/json'],
      });
      if (response.status < 200 || response.status >= 300) throw new Error('Range response failed');
      contentHash = createHash('sha256').update(response.body).digest('hex');
      const value = record(
        JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(response.body)),
      );
      if (!Array.isArray(value.prefixes)) throw new Error('Missing prefixes');
      cidrs = value.prefixes.flatMap((p) => {
        const prefix = record(p);
        return [prefix.ipv4Prefix, prefix.ipv6Prefix].filter(
          (v): v is string => typeof v === 'string',
        );
      });
      if (!cidrs.length) throw new Error('Empty IP range response');
      cidrs.forEach((c) => ipaddr.parseCIDR(c));
      status = 'succeeded';
    } catch {
      cidrs = [];
    }
    return {
      error: null,
      persist: async (trx) => {
        await trx
          .insertInto('bot_ip_range_snapshots')
          .values({
            id: randomUUID(),
            bot_id: bot.bot_id,
            source_url: source,
            fetched_at: fetchedAt,
            content_hash: contentHash,
            cidrs: JSON.stringify(cidrs),
            status,
          })
          .execute();
      },
    };
  };
}
export const botRequestRetentionSweep: Executor = async (task, { db, checkCancelled }) => {
  const cutoff = new Date(Date.now() - crawlLogs.retention_days * 86400000);
  for (;;) {
    await checkCancelled('crawl-log-retention');
    const deleted = await db.transaction().execute(async (trx) => {
      const rows = await trx
        .selectFrom('bot_requests')
        .select('id')
        .where('workspace_id', '=', task.workspace_id)
        .where('occurred_at', '<', cutoff)
        .orderBy('occurred_at')
        .orderBy('id')
        .limit(crawlLogs.sweep_batch_size)
        .execute();
      if (!rows.length) return 0;
      await trx
        .deleteFrom('bot_requests')
        .where('workspace_id', '=', task.workspace_id)
        .where(
          'id',
          'in',
          rows.map((r) => r.id),
        )
        .execute();
      return rows.length;
    });
    if (!deleted) return;
  }
};
export async function abandonUploads(db: Database, workspaceId: string, now = new Date()) {
  const cutoff = new Date(now.getTime() - crawlLogs.upload_abandon_hours * 3600000);
  const rows = await db
    .selectFrom('crawl_log_uploads')
    .select(['id', 'project_id'])
    .where('workspace_id', '=', workspaceId)
    .where('status', '=', 'open')
    .where('updated_at', '<', cutoff)
    .limit(crawlLogs.sweep_batch_size)
    .execute();
  for (const row of rows)
    await db.transaction().execute(async (trx) => {
      const scope = { workspaceId, projectId: row.project_id };
      await lockCrawlState(trx, scope);
      const changed = await trx
        .updateTable('crawl_log_uploads')
        .set({ status: 'abandoned', updated_at: now })
        .where('workspace_id', '=', workspaceId)
        .where('project_id', '=', row.project_id)
        .where('id', '=', row.id)
        .where('status', '=', 'open')
        .where('updated_at', '<', cutoff)
        .returning('id')
        .executeTakeFirst();
      if (changed) await enqueueRollup(trx, scope, now);
    });
  return rows.length;
}
export const crawlLogUploadAbandonSweep: Executor = async (task, { db, checkCancelled }) => {
  for (;;) {
    await checkCancelled('upload-abandon');
    if (!(await abandonUploads(db, task.workspace_id))) return;
  }
};
/** The UTC day whose insight sweep finished in this process; later ticks skip the query. */
let insightsSweptDay: string | null = null;
/** Insight windows end on a closed day, so each GA4-mapped project refreshes once a day. */
async function refreshDailyInsights(db: Database, now: Date, canAdmit: () => boolean) {
  const day = now.toISOString().slice(0, 10);
  if (insightsSweptDay === day) return true;
  const dayStart = new Date(day + 'T00:00:00Z');
  const due =
    await sql<CrawlScope>`select distinct m.workspace_id as "workspaceId",m.project_id as "projectId"
    from integration_property_mappings m where m.provider='ga4' and m.status='active'
      and not exists (select 1 from analytics_tasks t where t.workspace_id=m.workspace_id
        and t.project_id=m.project_id and t.task_kind='ai_traffic_insights_refresh' and t.created_at>=${dayStart})
      and not exists (select 1 from ai_traffic_insights i where i.workspace_id=m.workspace_id
        and i.project_id=m.project_id and i.created_at>=${dayStart})
    limit ${crawlLogs.sweep_batch_size}`.execute(db);
  for (const scope of due.rows) {
    if (!canAdmit()) return false;
    // One project at a time keeps each enqueue inside the tick's admission budget.
    await db.transaction().execute((trx) => enqueueTrafficInsights(trx, scope, now)); // NOSONAR
  }
  if (due.rows.length < crawlLogs.sweep_batch_size) insightsSweptDay = day;
  return true;
}
export async function crawlLogTick(
  db: Database,
  now = new Date(),
  canAdmit: () => boolean = () => true,
) {
  const system = await db
    .selectFrom('workspaces')
    .select('id')
    .where('is_system', '=', true)
    .executeTakeFirst();
  if (system && crawlLogs.ingestion_enabled)
    for (const bot of crawlers.bots.filter((b) => b.verification.method === 'ip_ranges')) {
      if (!canAdmit()) return;
      await enqueueTask(db, {
        workspaceId: system.id,
        projectId: null,
        kind: 'bot_ip_range_refresh',
        payload: { bot_id: bot.bot_id },
        keyParts: [
          bot.bot_id,
          Math.floor(now.getTime() / (crawlLogs.ip_range_refresh_hours * 3600000)),
        ],
        maxAttempts: crawlLogs.task_max_attempts,
      });
    }
  if (!(await refreshDailyInsights(db, now, canAdmit))) return;
  const workspaces = await db
    .selectFrom('crawl_log_sources')
    .select('workspace_id')
    .distinct()
    .execute();
  for (const workspace of workspaces)
    if (!(await maintainWorkspace(db, workspace.workspace_id, now, canAdmit))) return;
}
/** One workspace's daily crawl-log upkeep; false once the tick's budget is spent. */
async function maintainWorkspace(
  db: Database,
  workspaceId: string,
  now: Date,
  canAdmit: () => boolean,
) {
  // A paused collection is not the sender's silence.
  if (crawlLogs.ingestion_enabled) {
    if (!canAdmit()) return false;
    await stallQuietSources(db, workspaceId, now);
    if (!(await enqueueDuePulls(db, workspaceId, now, canAdmit))) return false;
  }
  for (const kind of ['bot_request_retention_sweep', 'crawl_log_upload_abandon_sweep']) {
    if (!canAdmit()) return false;
    await enqueueTask(db, {
      workspaceId,
      projectId: null,
      kind,
      payload: {},
      keyParts: [workspaceId, now.toISOString().slice(0, 10)],
      maxAttempts: crawlLogs.task_max_attempts,
    });
  }
  return true;
}
