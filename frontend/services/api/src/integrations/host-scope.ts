import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { normalizeDomain } from '../analysis/domains.ts';

const DOMAIN_PROPERTY_PREFIX = policy.integrations.transport.GSC_DOMAIN_PROPERTY_PREFIX;

function siteDomain(value: string): string {
  const text = value.trim();
  const prefixed = text.toLowerCase().startsWith(DOMAIN_PROPERTY_PREFIX);
  return normalizeDomain(prefixed ? text.slice(DOMAIN_PROPERTY_PREFIX.length) : text);
}

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
  return project
    ? siteDomainsOf(db, {
        id: projectId,
        workspace_id: workspaceId,
        website_url: project.website_url,
      })
    : null;
}

export async function siteDomainsOf(
  db: Database,
  project: { id: string; workspace_id: string; website_url: string },
): Promise<Set<string>> {
  const domains = await db
    .selectFrom('owned_domains')
    .select('domain')
    .where('workspace_id', '=', project.workspace_id)
    .where('project_id', '=', project.id)
    .execute();
  return new Set(
    [project.website_url, ...domains.map((d) => d.domain)].map(siteDomain).filter(Boolean),
  );
}

export function propertyMatchesSite(propertyRef: string, sites: ReadonlySet<string>): boolean {
  const site = siteDomain(propertyRef);
  return site !== '' && sites.has(site);
}

export async function projectHosts(db: Database, workspaceId: string, projectId: string) {
  const sites = await projectSiteDomains(db, workspaceId, projectId);
  if (!sites) throw new Error('The project no longer exists in this workspace');
  return new Set([...sites].flatMap((site) => [site, `www.${site}`]));
}
