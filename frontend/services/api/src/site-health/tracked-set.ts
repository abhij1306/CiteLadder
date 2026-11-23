/**
 * The project's tracked pages (SH-B6): the pages every full crawl audits. The
 * system picks them in one stable order (the root first, then value tiers,
 * then the URL's identity hash) and never re-picks them; the person cannot
 * change them. While the set is below the crawl's target, a full crawl fills
 * it from the sitemap, or from the pages its HTML walk fetched when the site
 * has no sitemap. The monitored-URL limit is a window over the fill order:
 * lowering it keeps the first N, raising it extends the set in place
 * (`fitTrackedSet`). Memberships are written by `admission-writes.ts`.
 */
import { sql } from 'kysely';
import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { record } from '../db/json.ts';
import { compareText } from '../text-order.ts';
import { joinTrackedSet, upsertSiteUrls } from './admission-writes.ts';
import type { Candidate } from './frontier.ts';
import type { Crawl } from './site-task.ts';
import { hostTwinHash } from './url-identity.ts';

export const trackedOrder = (a: Pick<Candidate, 'priority' | 'hash'>, b: typeof a) =>
  b.priority - a.priority || compareText(a.hash, b.hash);

export function orderedUnique(candidates: Candidate[]) {
  const unique = new Map<string, Candidate>();
  for (const item of candidates.toSorted(trackedOrder)) {
    const twin = hostTwinHash(item.url);
    if (!unique.has(item.hash) && !(twin && unique.has(twin))) unique.set(item.hash, item);
  }
  return [...unique.values()];
}

export async function lockTrackedSet(db: Database, workspaceId: string, projectId: string) {
  await db
    .selectFrom('monitored_site_urls')
    .select('id')
    .where('workspace_id', '=', workspaceId)
    .where('project_id', '=', projectId)
    .orderBy('id')
    .forUpdate()
    .execute();
}

/** How many pages this crawl may track and audit: its monitored-URL limit. */
function trackedTarget(crawl: Crawl) {
  return (
    Number(record(crawl.configuration)[policy.site_health.crawl.automatic_monitor_limit_key]) || 0
  );
}

async function trackedPages(trx: Database, crawl: Crawl, hashes: string[]) {
  const active = await trx
    .selectFrom('monitored_site_urls')
    .select((eb) => eb.fn.countAll<string>().as('count'))
    .where('workspace_id', '=', crawl.workspace_id)
    .where('project_id', '=', crawl.project_id)
    .where('fill_order', 'is not', null)
    .where('active', '=', true)
    .executeTakeFirstOrThrow();
  if (!hashes.length) return { hashes: new Set<string>(), active: Number(active.count) };
  const rows = await trx
    .selectFrom('site_urls as u')
    .select('u.url_hash')
    .where('u.workspace_id', '=', crawl.workspace_id)
    .where('u.project_id', '=', crawl.project_id)
    .where('u.url_hash', '=', sql<string>`any(${hashes}::text[])`)
    .where(
      sql<boolean>`exists (select 1 from monitored_site_urls m
        where m.project_id = u.project_id and m.site_url_id = u.id
          and m.workspace_id = u.workspace_id and m.fill_order is not null)`,
    )
    .execute();
  return { hashes: new Set(rows.map((row) => row.url_hash)), active: Number(active.count) };
}

export async function fillTrackedSet(trx: Database, crawl: Crawl, candidates: Candidate[]) {
  const ordered = orderedUnique(candidates);
  const tracked = await trackedPages(
    trx,
    crawl,
    ordered.map((item) => item.hash),
  );
  const room = trackedTarget(crawl) - tracked.active;
  if (room <= 0) return [];
  const picked = ordered
    .filter((item) => item.disposition === 'analyze' && !tracked.hashes.has(item.hash))
    .slice(0, room);
  if (!picked.length) return [];
  const ids = await upsertSiteUrls(trx, crawl, picked);
  const joined = new Set(
    await joinTrackedSet(
      trx,
      crawl,
      picked.map((item) => ids.get(item.hash)!),
    ),
  );
  return picked.flatMap((item) => {
    const siteUrlId = ids.get(item.hash)!;
    return joined.has(siteUrlId) ? [{ item, siteUrlId }] : [];
  });
}

export async function trackedRoom(trx: Database, crawl: Crawl) {
  return trackedTarget(crawl) - (await trackedPages(trx, crawl, [])).active;
}

export async function trackWalkedPage(trx: Database, crawl: Crawl, siteUrlId: string) {
  const row = await trx
    .selectFrom('monitored_site_urls')
    .select('fill_order')
    .where('workspace_id', '=', crawl.workspace_id)
    .where('project_id', '=', crawl.project_id)
    .where('site_url_id', '=', siteUrlId)
    .executeTakeFirst();
  if (row?.fill_order != null) return;
  const active = await trx
    .selectFrom('monitored_site_urls')
    .select((eb) => eb.fn.countAll<string>().as('count'))
    .where('workspace_id', '=', crawl.workspace_id)
    .where('project_id', '=', crawl.project_id)
    .where('fill_order', 'is not', null)
    .where('active', '=', true)
    .executeTakeFirstOrThrow();
  if (Number(active.count) < trackedTarget(crawl)) await joinTrackedSet(trx, crawl, [siteUrlId]);
}
