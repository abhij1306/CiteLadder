/** Persisted crawl listing and the short, idempotent stop transaction. */
import { setTimeout } from 'node:timers/promises';
import { sql } from 'kysely';
import type { Database } from '../db/database.ts';
import { policy } from '../config.ts';
import { notFound } from '../errors.ts';
import {
  decodeKeysetCursor,
  encodeKeysetCursor,
  InvalidCursorError,
} from '../http/keyset-cursor.ts';
import { parseUuid } from '../http/uuid.ts';
import { crawlSetting } from './planner-policy.ts';
import { isTerminal, loadProject, projectCrawl } from './reads/crawl.ts';
import { recordCrawlEvent } from './site-task.ts';

export async function listCrawls(
  db: Database,
  workspaceId: string,
  input: {
    project_id: string | null;
    limit: number;
    cursor: string | null;
  },
) {
  const filters = { workspace_id: workspaceId, project_id: input.project_id };
  let query = db.selectFrom('site_crawls').selectAll().where('workspace_id', '=', workspaceId);
  if (input.project_id) {
    await loadProject(db, workspaceId, input.project_id);
    query = query.where('project_id', '=', input.project_id);
  }
  if (input.cursor) {
    const keys = decodeKeysetCursor(input.cursor, 'crawls', filters);
    const date = keys[0] ? new Date(keys[0]) : null;
    const id = parseUuid(keys[1]);
    if (keys.length !== 2 || !date || !Number.isFinite(date.getTime()) || !id)
      throw new InvalidCursorError('invalid cursor');
    query = query.where(sql<boolean>`(created_at, id) < (${date}, ${id}::uuid)`);
  }
  const rows = await query
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(input.limit + 1)
    .execute();
  const items = rows.slice(0, input.limit);
  const last = items.at(-1);
  return {
    items: items.map((crawl) => projectCrawl(crawl)),
    next_cursor:
      rows.length > input.limit && last
        ? encodeKeysetCursor('crawls', filters, [last.created_at.toISOString(), last.id])
        : null,
  };
}

function cancelOnce(db: Database, workspaceId: string, crawlId: string) {
  return db.transaction().execute(async (trx) => {
    const crawl = await trx
      .selectFrom('site_crawls')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .where('id', '=', crawlId)
      .forUpdate()
      .executeTakeFirst();
    if (!crawl) throw notFound('Crawl');
    if (isTerminal(crawl)) return;
    const now = new Date();
    await trx
      .updateTable('site_crawls')
      .set({
        status: 'cancelled',
        completed_at: now,
        updated_at: now,
        ...(['pending', 'running', 'stopped'].includes(crawl.discovery_status)
          ? { discovery_status: 'cancelled' }
          : {}),
        ...(!['completed', 'partially_completed', 'failed', 'cancelled'].includes(
          crawl.analysis_status,
        )
          ? { analysis_status: 'cancelled' }
          : {}),
      })
      .where('workspace_id', '=', workspaceId)
      .where('id', '=', crawlId)
      .execute();
    await trx
      .updateTable('site_crawl_tasks')
      .set({
        status: 'cancelled',
        lease_owner: null,
        lease_expires_at: null,
        completed_at: now,
        updated_at: now,
        error_code: 'cancelled',
      })
      .where('workspace_id', '=', workspaceId)
      .where('crawl_id', '=', crawlId)
      .where('status', 'not in', ['succeeded', 'failed', 'cancelled'])
      .execute();
    await recordCrawlEvent(trx, crawl, 'crawl.cancelled', 'crawl cancelled', {});
  });
}

/** Replay the entire stop transaction after bounded PostgreSQL lock conflicts. */
export function cancelCrawl(db: Database, workspaceId: string, crawlId: string) {
  return cancelWithRetry(db, workspaceId, crawlId, 0);
}

async function cancelWithRetry(
  db: Database,
  workspaceId: string,
  crawlId: string,
  attempt: number,
): Promise<void> {
  try {
    await cancelOnce(db, workspaceId, crawlId);
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
    if (
      attempt >= policy.site_health.crawl.cancel_db_conflict_retries ||
      typeof code !== 'string' ||
      !['40001', '40P01', '55P03'].includes(code)
    )
      throw error;
    const delay =
      Number(crawlSetting('db_conflict_base_delay_seconds')) +
      (((attempt + 1) * 0.37) % 1) * Number(crawlSetting('db_conflict_jitter_seconds'));
    await setTimeout(delay * 1000);
    await cancelWithRetry(db, workspaceId, crawlId, attempt + 1);
  }
}
