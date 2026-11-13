/**
 * Which page a page chat may fetch (CO6, E3): one of the latest crawl's
 * content pages, or the page its Action targets. Free URL entry is a later
 * paid add-on, so any other URL is refused before anything is committed.
 */
import { AgentError } from '../agent/contracts.ts';
import { contentPageAnalyses } from '../content-gaps/load.ts';
import type { Database } from '../db/database.ts';
import { resolveCrawlId } from '../opportunities/sources.ts';
import { actionPageUrl } from '../opportunities/targets/registry.ts';
import { canonicalIdentity, canonicalUrl, hostTwinHash } from '../site-health/url-identity.ts';

type Scope = { workspaceId: string; projectId: string };
/** The page a chat fetches: its URL, and its crawl row when the crawl has one. */
export type PageTarget = { url: string; siteUrlId: string | null };

function identity(url: string) {
  try {
    return canonicalIdentity(url);
  } catch {
    return null;
  }
}

/** The URL as one of the latest crawl's content pages, or null. */
async function crawlContentPage(db: Database, scope: Scope, hashes: string[]) {
  const crawlId = await resolveCrawlId(db, scope);
  if (crawlId === null) return null;
  const row = await contentPageAnalyses(db, scope, crawlId)
    .select(['url.id', 'url.normalized_url'])
    .where('url.url_hash', 'in', hashes)
    .orderBy('url.id')
    .limit(1)
    .executeTakeFirst();
  return row ? { url: row.normalized_url, siteUrlId: row.id } : null;
}

/**
 * Whether a URL (or its `www.` twin) is one of the latest crawl's content
 * pages (CO15): the pages whose Actions open the page workspace (E3).
 */
export async function isContentPage(db: Database, scope: Scope, url: string): Promise<boolean> {
  const requested = identity(url.trim());
  if (!requested) return false;
  const twin = hostTwinHash(requested.url);
  return (
    (await crawlContentPage(db, scope, twin ? [requested.hash, twin] : [requested.hash])) !== null
  );
}

/** The Action's own page target, when it is this URL. */
async function actionPage(
  db: Database,
  scope: Scope,
  actionId: string,
  canonical: string,
  hashes: string[],
) {
  const action = await db
    .selectFrom('actions')
    .select(['target_kind', 'target_url'])
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('id', '=', actionId)
    .executeTakeFirst();
  if (!action || canonicalUrl(actionPageUrl(action)) !== canonical) return null;
  const known = await db
    .selectFrom('site_urls')
    .select('id')
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('url_hash', 'in', hashes)
    .orderBy('id')
    .limit(1)
    .executeTakeFirst();
  return { url: canonical, siteUrlId: known?.id ?? null };
}

/**
 * The page a page chat fetches, or `agent_page_unavailable`. The Action's
 * target counts only when the chat is started on that Action.
 */
export async function resolvePageTarget(
  db: Database,
  scope: Scope,
  input: { url: string; actionId: string | null },
): Promise<PageTarget> {
  const requested = identity(input.url.trim());
  if (!requested) throw new AgentError('agent_page_unavailable');
  const twin = hostTwinHash(requested.url);
  const hashes = twin ? [requested.hash, twin] : [requested.hash];
  const page =
    (await crawlContentPage(db, scope, hashes)) ??
    (input.actionId ? await actionPage(db, scope, input.actionId, requested.url, hashes) : null);
  if (!page) throw new AgentError('agent_page_unavailable');
  return page;
}
