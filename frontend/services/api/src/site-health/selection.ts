/** Versioned monitored-set replacement, serialized across the entire workspace. */
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { notFound } from '../errors.ts';
import type { Database } from '../db/database.ts';
import { parseUuid } from '../http/uuid.ts';
import { admissionRuntime, createPageRerunCrawl, enqueueCrawlTask } from './planner.ts';
import { crawlError } from './planner-policy.ts';
import { inventoryCrawlIds, loadProject } from './reads/crawl.ts';
import { monitoredQuota } from './reads/runtime.ts';
import { ACTIVE_CRAWL } from './site-task.ts';

export async function monitoredSet(db: Database, workspaceId: string, projectId: string) {
  await loadProject(db, workspaceId, projectId);
  const profile = await db
    .selectFrom('site_health_profiles')
    .select('selection_version')
    .where('workspace_id', '=', workspaceId)
    .where('project_id', '=', projectId)
    .executeTakeFirst();
  const rows = await db
    .selectFrom('monitored_site_urls as m')
    .innerJoin('site_urls as u', (join) =>
      join
        .onRef('u.id', '=', 'm.site_url_id')
        .onRef('u.workspace_id', '=', 'm.workspace_id')
        .onRef('u.project_id', '=', 'm.project_id'),
    )
    .select([
      'm.site_url_id',
      'u.normalized_url',
      'u.display_url',
      'u.latest_title',
      'm.active',
      'm.selection_source',
      'm.selected_at',
      'm.deselected_at',
    ])
    .where('m.workspace_id', '=', workspaceId)
    .where('m.project_id', '=', projectId)
    .orderBy('u.normalized_url')
    .orderBy('u.id')
    .execute();
  return {
    project_id: projectId,
    selection_version: profile?.selection_version ?? 0,
    monitored_urls: rows.map((row) => ({
      site_url_id: row.site_url_id,
      normalized_url: row.normalized_url,
      display_url: row.display_url || row.normalized_url,
      title: row.latest_title || null,
      active: row.active,
      selection_source: row.selection_source as 'user' | 'bootstrap' | 'free_sample',
      selected_at: row.selected_at?.toISOString() ?? null,
      deselected_at: row.deselected_at?.toISOString() ?? null,
    })),
    quota: await monitoredQuota(db, workspaceId),
  };
}

/** Lock the parent and active crawl before runtime/profile, matching worker publication. */
export async function lockControlScope(db: Database, workspaceId: string, projectId: string) {
  const project = await db
    .selectFrom('projects')
    .select('id')
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', projectId)
    .forUpdate()
    .executeTakeFirst();
  if (!project) throw notFound('Project');
  const crawl = await db
    .selectFrom('site_crawls')
    .selectAll()
    .where('workspace_id', '=', workspaceId)
    .where('project_id', '=', projectId)
    .where('status', 'in', [...ACTIVE_CRAWL])
    .orderBy('created_at', 'desc')
    .forUpdate()
    .executeTakeFirst();
  const runtime = await admissionRuntime(db, workspaceId);
  const profile = await db
    .selectFrom('site_health_profiles')
    .selectAll()
    .where('workspace_id', '=', workspaceId)
    .where('project_id', '=', projectId)
    .forUpdate()
    .executeTakeFirst();
  if (!profile) crawlError('Site Health profile not found', 'invalid_selection');
  return { crawl, runtime, profile };
}

export async function replaceMonitoredSet(
  db: Database,
  workspaceId: string,
  projectId: string,
  requestedIds: string[],
  expectedVersion: number,
  scope?: Awaited<ReturnType<typeof lockControlScope>>,
) {
  const { crawl, runtime, profile } = scope ?? (await lockControlScope(db, workspaceId, projectId));
  if (runtime.monitored_url_limit <= 0)
    crawlError(
      'A monitored-URL allowance is required to select monitored URLs',
      'monitoring_not_allowed',
      403,
    );
  if (profile.selection_version !== expectedVersion)
    crawlError(
      'The monitored selection changed since it was loaded',
      'stale_selection_version',
      409,
      { current_selection_version: profile.selection_version },
    );
  const requested = [
    ...new Set(
      requestedIds.map((id) => {
        const parsed = parseUuid(id);
        if (!parsed)
          crawlError('Selection contains an invalid URL identifier', 'invalid_selection');
        return parsed;
      }),
    ),
  ];
  const urls = await db
    .selectFrom('site_urls')
    .selectAll()
    .where('workspace_id', '=', workspaceId)
    .where('project_id', '=', projectId)
    .where('id', '=', sql<string>`any(${requested}::uuid[])`)
    .execute();
  if (urls.length !== requested.length)
    crawlError('Selection contains ids that are not discovered project URLs', 'invalid_selection');
  const members = await db
    .selectFrom('monitored_site_urls')
    .selectAll()
    .where('workspace_id', '=', workspaceId)
    .where('project_id', '=', projectId)
    .forUpdate()
    .execute();
  const others = await db
    .selectFrom('monitored_site_urls')
    .select(sql<number>`count(*)::int`.as('count'))
    .where('workspace_id', '=', workspaceId)
    .where('project_id', '!=', projectId)
    .where('active', '=', true)
    .executeTakeFirstOrThrow();
  if (others.count + requested.length > runtime.monitored_url_limit)
    crawlError(
      'The selection would exceed the workspace monitored-URL limit',
      'site_health_quota_exceeded',
      403,
      {
        limit: runtime.monitored_url_limit,
        currently_used: others.count + members.filter((member) => member.active).length,
      },
    );
  const wanted = new Set(requested);
  const byUrl = new Map(members.map((member) => [member.site_url_id, member]));
  const removed = members
    .filter((member) => member.active && !wanted.has(member.site_url_id))
    .map((member) => member.site_url_id);
  const byId = new Map(urls.map((url) => [url.id, url]));
  const added = requested.map((id) => byId.get(id)!).filter((url) => !byUrl.get(url.id)?.active);
  const now = new Date();
  const version = profile.selection_version + 1;
  await db
    .updateTable('monitored_site_urls')
    .set({ active: false, deselected_at: now })
    .where('workspace_id', '=', workspaceId)
    .where('project_id', '=', projectId)
    .where('site_url_id', '=', sql<string>`any(${removed}::uuid[])`)
    .execute();
  await Promise.all(
    requested.map(async (id) => {
      const prior = byUrl.get(id);
      await db
        .insertInto('monitored_site_urls')
        .values({
          id: randomUUID(),
          workspace_id: workspaceId,
          project_id: projectId,
          profile_id: profile.id,
          site_url_id: id,
          active: true,
          selection_source: 'user',
          selecting_membership_id: version,
          selected_at: now,
          created_at: now,
          updated_at: now,
        })
        .onConflict((conflict) =>
          conflict
            .columns(['project_id', 'site_url_id'])
            .doUpdateSet({
              active: true,
              selection_source: 'user',
              deselected_at: null,
              ...(!prior?.active ? { selected_at: now, selecting_membership_id: version } : {}),
            })
            .where('monitored_site_urls.workspace_id', '=', workspaceId),
        )
        .execute();
    }),
  );
  await db
    .updateTable('site_health_profiles')
    .set({ selection_version: version, updated_at: now })
    .where('id', '=', profile.id)
    .where('workspace_id', '=', workspaceId)
    .execute();
  if (!crawl) return;
  await db
    .updateTable('site_crawl_tasks')
    .set({
      status: 'cancelled',
      completed_at: now,
      updated_at: now,
      lease_owner: null,
      lease_expires_at: null,
      error_code: 'cancelled',
    })
    .where('workspace_id', '=', workspaceId)
    .where('crawl_id', '=', crawl.id)
    .where('task_kind', '=', 'analyze')
    .where('site_url_id', '=', sql<string>`any(${removed}::uuid[])`)
    .where('status', 'in', ['queued', 'retry_wait'])
    .execute();
  await Promise.all(
    added.map(async (url, position) => {
      const previous = await db
        .selectFrom('site_crawl_tasks')
        .select((eb) => eb.fn.max<number>('generation').as('generation'))
        .where('workspace_id', '=', workspaceId)
        .where('crawl_id', '=', crawl.id)
        .where('task_kind', '=', 'analyze')
        .where('url_hash', '=', url.url_hash)
        .executeTakeFirstOrThrow();
      await enqueueCrawlTask(db, crawl, {
        kind: 'analyze',
        url: url.normalized_url,
        siteUrlId: url.id,
        position,
        generation: (previous.generation ?? -1) + 1,
      });
    }),
  );
}

export async function bulkMonitoredSet(
  db: Database,
  workspaceId: string,
  projectId: string,
  input: {
    crawl_id: string;
    mode: 'first_n' | 'all' | 'none';
    count?: number | null;
    query?: string | null;
    expected_selection_version: number;
  },
) {
  await loadProject(db, workspaceId, projectId);
  const crawl = await db
    .selectFrom('site_crawls')
    .selectAll()
    .where('workspace_id', '=', workspaceId)
    .where('project_id', '=', projectId)
    .where('id', '=', input.crawl_id)
    .executeTakeFirst();
  if (!crawl) crawlError('Crawl not found in this project', 'invalid_selection');
  if (input.mode === 'first_n' && (!input.count || input.count < 1))
    crawlError('A positive count is required for first_n bulk selection', 'invalid_selection');
  const scope = await lockControlScope(db, workspaceId, projectId);
  const limit = scope.runtime.monitored_url_limit;
  let query = db
    .selectFrom('site_urls as u')
    .select('u.id')
    .where('u.workspace_id', '=', workspaceId)
    .where('u.project_id', '=', projectId)
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom('site_url_observations as o')
          .select('o.id')
          .whereRef('o.site_url_id', '=', 'u.id')
          .where('o.workspace_id', '=', workspaceId)
          .where('o.project_id', '=', projectId)
          .where('o.crawl_id', 'in', inventoryCrawlIds(crawl)),
      ),
    );
  if (input.query?.trim()) {
    const escapedQuery = input.query.trim().replaceAll(/[\\%_]/gu, String.raw`\$&`);
    const pattern = `%${escapedQuery}%`;
    query = query.where((eb) =>
      eb.or([eb('u.normalized_url', 'ilike', pattern), eb('u.display_url', 'ilike', pattern)]),
    );
  }
  const cap = input.count == null ? limit + 1 : Math.min(input.count, limit + 1);
  const ids =
    input.mode === 'none'
      ? []
      : (
          await query
            // Most valuable pages first (product and pricing before posts), URL order within a tier.
            .orderBy(
              (eb) =>
                eb
                  .selectFrom('site_url_observations as o')
                  .select((inner) => inner.fn.max('o.value_priority').as('value'))
                  .whereRef('o.site_url_id', '=', 'u.id')
                  .where('o.workspace_id', '=', workspaceId)
                  .where('o.crawl_id', 'in', inventoryCrawlIds(crawl)),
              (order) => order.desc().nullsLast(),
            )
            .orderBy('u.normalized_url')
            .orderBy('u.id')
            .limit(Math.max(0, cap))
            .execute()
        ).map((row) => row.id);
  if (limit > 0 && ids.length > limit) {
    const used = await db
      .selectFrom('monitored_site_urls')
      .select(sql<number>`count(*)::int`.as('count'))
      .where('workspace_id', '=', workspaceId)
      .where('active', '=', true)
      .executeTakeFirstOrThrow();
    crawlError(
      'The selection would exceed the workspace monitored-URL limit',
      'site_health_quota_exceeded',
      403,
      { limit, currently_used: used.count },
    );
  }
  await replaceMonitoredSet(
    db,
    workspaceId,
    projectId,
    ids,
    input.expected_selection_version,
    scope,
  );
}

export async function rerunPage(
  db: Database,
  workspaceId: string,
  projectId: string,
  siteUrlId: string,
) {
  const scope = await lockControlScope(db, workspaceId, projectId);
  const member = await db
    .selectFrom('monitored_site_urls')
    .selectAll()
    .where('workspace_id', '=', workspaceId)
    .where('project_id', '=', projectId)
    .where('site_url_id', '=', siteUrlId)
    .where('active', '=', true)
    .executeTakeFirst();
  if (!member)
    crawlError('The URL is not part of the active monitored selection', 'rerun_not_allowed', 409);
  if (scope.runtime.monitored_url_limit <= 0)
    crawlError(
      'Page analysis is disabled: SITE_HEALTH_MONITORED_URL_LIMIT is 0',
      'monitoring_not_allowed',
      403,
    );
  const url = await db
    .selectFrom('site_urls')
    .selectAll()
    .where('workspace_id', '=', workspaceId)
    .where('project_id', '=', projectId)
    .where('id', '=', siteUrlId)
    .executeTakeFirst();
  if (!url) crawlError('Site URL not found in this project', 'invalid_selection');
  let crawl = scope.crawl;
  let taskId: string | null;
  if (crawl) {
    const previous = await db
      .selectFrom('site_crawl_tasks')
      .select((eb) => eb.fn.max<number>('generation').as('generation'))
      .where('workspace_id', '=', workspaceId)
      .where('crawl_id', '=', crawl.id)
      .where('task_kind', '=', 'analyze')
      .where('url_hash', '=', url.url_hash)
      .executeTakeFirstOrThrow();
    taskId = await enqueueCrawlTask(db, crawl, {
      kind: 'analyze',
      url: url.normalized_url,
      siteUrlId,
      generation: (previous.generation ?? -1) + 1,
    });
  } else {
    crawl = await createPageRerunCrawl(
      db,
      workspaceId,
      projectId,
      scope.profile,
      url,
      scope.runtime,
    );
    const task = await db
      .selectFrom('site_crawl_tasks')
      .select('id')
      .where('workspace_id', '=', workspaceId)
      .where('crawl_id', '=', crawl.id)
      .where('site_url_id', '=', siteUrlId)
      .where('task_kind', '=', 'analyze')
      .executeTakeFirstOrThrow();
    taskId = task.id;
  }
  if (!taskId) throw new Error('Rerun task was not admitted');
  return {
    crawl_id: crawl.id,
    site_url_id: siteUrlId,
    task_id: taskId,
    created_new_crawl: !scope.crawl,
    analysis_status: crawl.analysis_status,
  };
}
