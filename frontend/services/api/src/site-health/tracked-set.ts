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
import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { record } from '../db/json.ts';
import { compareText } from '../text-order.ts';
import { joinTrackedSet, upsertSiteUrls } from './admission-writes.ts';
import type { Candidate } from './frontier.ts';
import type { Crawl } from './site-task.ts';
import { hostTwinHash } from './url-identity.ts';

/**
 * The project's stable order: value tier first (the root's is the highest),
 * then the URL's identity hash, the SHA-256 of its canonical form. Every crawl
 * orders the same URLs the same way, and the order within a tier never
 * favours header or footer links.
 */
export const trackedOrder = (a: Pick<Candidate, 'priority' | 'hash'>, b: typeof a) =>
  b.priority - a.priority || compareText(a.hash, b.hash);

/** One candidate per URL, and one of each www/apex twin pair, in the stable order. */
export function orderedUnique(candidates: Candidate[]) {
  const unique = new Map<string, Candidate>();
  for (const item of candidates.toSorted(trackedOrder)) {
    const twin = hostTwinHash(item.url);
    if (!unique.has(item.hash) && !(twin && unique.has(twin))) unique.set(item.hash, item);
  }
  return [...unique.values()];
}

/**
 * Lock the project's memberships, after the runtime and before the crawl and
 * profile in the Site Health lock order, so admission and re-audits never fit,
 * fill or read the set while another writer changes it.
 */
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

/** Every page the project ever tracked, by URL hash, and how many are active now. */
async function trackedPages(trx: Database, crawl: Crawl) {
  const rows = await trx
    .selectFrom('monitored_site_urls as m')
    .innerJoin('site_urls as u', (join) =>
      join
        .onRef('u.id', '=', 'm.site_url_id')
        .onRef('u.workspace_id', '=', 'm.workspace_id')
        .onRef('u.project_id', '=', 'm.project_id'),
    )
    .select(['u.url_hash', 'm.active'])
    .where('m.workspace_id', '=', crawl.workspace_id)
    .where('m.project_id', '=', crawl.project_id)
    .where('m.fill_order', 'is not', null)
    .execute();
  return {
    hashes: new Set(rows.map((row) => row.url_hash)),
    active: rows.filter((row) => row.active).length,
  };
}

/**
 * Fill the tracked set's free slots from `candidates` in the stable order,
 * skipping every page tracked before and every document (a PDF is inventory,
 * never an audited page). Returns the joined pages with their site URL ids.
 * The caller holds the workspace runtime lock.
 */
export async function fillTrackedSet(trx: Database, crawl: Crawl, candidates: Candidate[]) {
  const tracked = await trackedPages(trx, crawl);
  const room = trackedTarget(crawl) - tracked.active;
  if (room <= 0) return [];
  const picked = orderedUnique(candidates)
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

/**
 * A walked page's discovery showed a page: track it while the set has room.
 * The caller holds the workspace runtime lock, so walks fill in turn.
 */
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
