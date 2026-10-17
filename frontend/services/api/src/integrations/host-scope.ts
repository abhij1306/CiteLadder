import type { Database } from '../db/database.ts';
import { normalizeDomain } from '../analysis/domains.ts';
import { canonicalPage } from '../traffic/normalization.ts';
import { pathIdentity } from '../crawl-logs/identity.ts';

/**
 * The registrable site of a URL, property or bare host: lower-cased, with
 * `sc-domain:` and a leading `www.` removed. Empty when unparseable.
 */
function siteDomain(value: string): string {
  return normalizeDomain(value.trim().replace(/^sc-domain:/iu, ''));
}

/**
 * The project's sites (website plus owned domains), as `siteDomain` values;
 * null when the workspace has no such project. A failed read still throws.
 */
export async function projectSiteDomains(
  db: Database,
  workspaceId: string,
  projectId: string,
): Promise<Set<string> | null> {
  const project = await db
    .selectFrom('projects')
    .select('website_url')
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', projectId)
    .executeTakeFirst();
  return project ? siteDomainsOf(db, { id: projectId, website_url: project.website_url }) : null;
}

/** The sites of a project the caller already read inside its workspace. */
export async function siteDomainsOf(
  db: Database,
  project: { id: string; website_url: string },
): Promise<Set<string>> {
  const domains = await db
    .selectFrom('owned_domains')
    .select('domain')
    .where('project_id', '=', project.id)
    .execute();
  return new Set(
    [project.website_url, ...domains.map((d) => d.domain)].map(siteDomain).filter(Boolean),
  );
}

/** Whether a Search Console or Bing property belongs to one of the project's sites. */
export function propertyMatchesSite(propertyRef: string, sites: ReadonlySet<string>): boolean {
  const site = siteDomain(propertyRef);
  return site !== '' && sites.has(site);
}

/** Hostnames that count as the project's own: each site with and without `www.`. */
export async function projectHosts(db: Database, workspaceId: string, projectId: string) {
  const sites = await projectSiteDomains(db, workspaceId, projectId);
  // Callers hold a run or task for this project; its loss fails that work.
  if (!sites) throw new Error('The project no longer exists in this workspace');
  return new Set([...sites].flatMap((site) => [site, `www.${site}`]));
}
export function landingPage(path: string, host: string, hosts: ReadonlySet<string>) {
  const normalizedHost = host.toLowerCase();
  if (!hosts.has(normalizedHost) || path === '(not set)') return null;
  const origin = `https://${normalizedHost}`;
  const page = canonicalPage(path.split(/[?#]/u)[0]!, origin);
  return page && new URL(page).origin === origin && pathIdentity(page, origin)?.identity === 'exact'
    ? page
    : null;
}
