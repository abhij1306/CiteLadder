import { sql, type RawBuilder, type SqlBool } from 'kysely';

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { ApiError } from '../errors.ts';
import {
  decodeKeysetCursor,
  encodeKeysetCursor,
  InvalidCursorError,
} from '../http/keyset-cursor.ts';
import { parseUuid, parseUuids } from '../http/uuid.ts';
import type { Scope } from './sources.ts';

const PAGE = policy.opportunity.actions.ACTION_URLS_PAGE_SIZE;

function urlCursor(actionId: string, cursor: string) {
  try {
    const [url, id] = decodeKeysetCursor(cursor, 'action-urls', { action_id: actionId });
    const siteUrlId = parseUuid(id ?? '');
    if (url === undefined || !siteUrlId) throw new InvalidCursorError('invalid cursor');
    return { url, siteUrlId };
  } catch (error) {
    if (!(error instanceof InvalidCursorError)) throw error;
    throw new ApiError(400, error.message, { code: 'invalid_cursor' });
  }
}

export const pageKindOf = sql<string | null>`(select spa.page_kind from site_page_analyses spa
  where spa.workspace_id = site_urls.workspace_id and spa.crawl_id = site_urls.last_seen_crawl_id
    and spa.site_url_id = site_urls.id and spa.is_current)`;

export async function actionUrlsPage(
  db: Database,
  action: { id: string; workspace_id: string; project_id: string },
  {
    cursor,
    wholeSite,
    counted,
  }: { cursor: string | null; wholeSite: boolean; counted: RawBuilder<SqlBool> },
) {
  const after = cursor ? urlCursor(action.id, cursor) : null;
  let query = db
    .selectFrom('action_urls')
    .innerJoin('site_urls', (join) =>
      join
        .onRef('site_urls.workspace_id', '=', 'action_urls.workspace_id')
        .onRef('site_urls.id', '=', 'action_urls.site_url_id'),
    )
    .where('action_urls.workspace_id', '=', action.workspace_id)
    .where('action_urls.project_id', '=', action.project_id)
    .where('action_urls.action_id', '=', action.id);
  const { total } = await query
    .select(sql<number>`count(*)::int`.as('total'))
    .executeTakeFirstOrThrow();
  if (after)
    query = query.where(
      sql<boolean>`(site_urls.normalized_url collate "C", site_urls.id) > (${after.url} collate "C", ${after.siteUrlId}::uuid)`,
    );
  const rows = await query
    .select([
      'site_urls.id as site_url_id',
      'site_urls.normalized_url as url',
      pageKindOf.as('page_kind'),
    ])
    .orderBy(sql`site_urls.normalized_url collate "C"`)
    .orderBy('site_urls.id')
    .limit(PAGE + 1)
    .execute();
  const items = rows.slice(0, PAGE);
  const counts = await countsByUrl(db, action, {
    siteUrlIds: items.map((row) => row.site_url_id),
    counted,
  });
  const last = items.at(-1);
  return {
    whole_site: wholeSite,
    total,
    items: items.map((row) => ({ ...row, open_action_count: counts.get(row.site_url_id) ?? 0 })),
    next_cursor:
      rows.length > PAGE && last
        ? encodeKeysetCursor('action-urls', { action_id: action.id }, [last.url, last.site_url_id])
        : null,
  };
}

async function countsByUrl(
  db: Database,
  scope: { workspace_id: string; project_id: string },
  { siteUrlIds, counted }: { siteUrlIds: string[]; counted: RawBuilder<SqlBool> },
) {
  if (siteUrlIds.length === 0) return new Map<string, number>();
  const rows = await db
    .selectFrom('action_urls')
    .innerJoin('actions', (join) =>
      join
        .onRef('actions.workspace_id', '=', 'action_urls.workspace_id')
        .onRef('actions.id', '=', 'action_urls.action_id'),
    )
    .select(['action_urls.site_url_id', sql<number>`count(*)::int`.as('count')])
    .where('action_urls.workspace_id', '=', scope.workspace_id)
    .where('action_urls.project_id', '=', scope.project_id)
    .where('action_urls.site_url_id', 'in', siteUrlIds)
    .where(counted)
    .groupBy('action_urls.site_url_id')
    .execute();
  return new Map(rows.map((row) => [row.site_url_id, row.count]));
}

export type ActionUrlSource = Readonly<{
  actionId: string;
  kind: string;
  url: string | null;
  cohort: Readonly<{ whole_site: boolean; pages: readonly { site_url_id: string }[] }> | null;
}>;

export async function writeActionUrls(trx: Database, scope: Scope, synced: ActionUrlSource[]) {
  if (!synced.length) return;
  const pageUrls = [...new Set(synced.flatMap((s) => (s.kind === 'page' && s.url ? [s.url] : [])))];
  const owned = new Map(
    (pageUrls.length
      ? await trx
          .selectFrom('site_urls')
          .select(['id', 'normalized_url'])
          .where('workspace_id', '=', scope.workspaceId)
          .where('project_id', '=', scope.projectId)
          .where('normalized_url', 'in', pageUrls)
          .execute()
      : []
    ).map((row) => [row.normalized_url, row.id]),
  );
  const urlIds = (s: ActionUrlSource): string[] => {
    if (s.cohort)
      return s.cohort.whole_site ? [] : parseUuids(s.cohort.pages.map((page) => page.site_url_id));
    const id = s.kind === 'page' && s.url ? owned.get(s.url) : undefined;
    return id ? [id] : [];
  };
  const actionIds: string[] = [];
  const siteUrlIds: string[] = [];
  for (const s of synced)
    for (const id of new Set(urlIds(s))) {
      actionIds.push(s.actionId);
      siteUrlIds.push(id);
    }
  const wanted = sql`unnest(${actionIds}::uuid[], ${siteUrlIds}::uuid[]) as w(action_id, site_url_id)`;
  await sql`delete from action_urls a
    where a.workspace_id = ${scope.workspaceId}
      and a.action_id = any(${synced.map((s) => s.actionId)}::uuid[])
      and not exists (select 1 from ${wanted}
        where w.action_id = a.action_id and w.site_url_id = a.site_url_id)`.execute(trx);
  if (!actionIds.length) return;
  // Cohort pages come from evidence; only this project's existing URLs are kept.
  await sql`insert into action_urls (workspace_id, project_id, action_id, site_url_id)
    select u.workspace_id, u.project_id, w.action_id, u.id
    from ${wanted}
    join site_urls u on u.id = w.site_url_id
      and u.workspace_id = ${scope.workspaceId} and u.project_id = ${scope.projectId}
    on conflict (action_id, site_url_id) do nothing`.execute(trx);
}
