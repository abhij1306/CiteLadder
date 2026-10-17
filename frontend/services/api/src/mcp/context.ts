/** The project overview: each section is its owner's read, run in parallel. */
import type { Database } from '../db/database.ts';
import { listMarkets } from '../projects/markets.ts';
import { readBrandMemory } from '../projects/brand-profile.ts';
import { authorizeProject, unavailable } from './data.ts';
import {
  actionsRead,
  competitorsAndDomains,
  demandSnapshot,
  integrationStatus,
  promptPortfolio,
  searchIntelligence,
} from './evidence.ts';
import { visibilityOverview } from './evidence-analytics.ts';
import { crawlability, siteSnapshot } from './evidence-site.ts';
import { crawlLogsRead, performanceRead, referrals } from './evidence-traffic.ts';
import { appLink } from './links.ts';
import { mcpPolicy } from './config.ts';
import type { Evidence, EvidencePrincipal, ProjectRead } from './types.ts';

const sections: Record<string, (read: ProjectRead) => Promise<Evidence>> = {
  visibility: (read) => visibilityOverview(read, { cohort: 'core' }),
  actions: (read) => actionsRead(read, { limit: mcpPolicy.overview_action_limit }),
  prompts: (read) =>
    promptPortfolio(read, { active_only: true, limit: mcpPolicy.default_list_limit }),
  site_health: (read) => siteSnapshot(read, {}),
  crawlability: (read) => crawlability(read, {}),
  demand: demandSnapshot,
  performance: (read) => performanceRead(read, {}),
  referrals: (read) => referrals(read, {}),
  crawl_logs: (read) => crawlLogsRead(read, { view: 'summary' }),
  integrations: integrationStatus,
  search_intelligence: searchIntelligence,
};

/** Every section the overview can return; the tool's `sections` argument selects among them. */
export const overviewSections: [string, ...string[]] = ['profile', ...Object.keys(sections)];

export async function businessContext(
  db: Database,
  principal: EvidencePrincipal,
  projectId: string,
  origin: string,
  selected: readonly string[] = overviewSections,
): Promise<Evidence> {
  const project = await authorizeProject(db, principal, projectId);
  const read = { db, origin, scope: { workspaceId: project.workspace_id, projectId: project.id } };
  const wanted = new Set(selected);
  const [markets, profile, entities, ...results] = await Promise.all([
    listMarkets(db, read.scope),
    wanted.has('profile') ? readBrandMemory(db, read.scope) : null,
    wanted.has('profile') ? competitorsAndDomains(read) : null,
    ...Object.entries(sections)
      .filter(([name]) => wanted.has(name))
      .map(async ([name, reader]) => [name, await reader(read)] as const),
  ]);
  return {
    project: {
      id: project.id,
      name: project.name,
      brand_name: project.brand_name,
      website_url: project.website_url,
      industry: project.industry,
      subindustry: project.subindustry,
      primary_market: project.primary_market,
      country_code: project.country_code,
      language_code: project.language_code,
      // Each market is measured separately; visibility reads take its id (null: default).
      markets: markets.map(({ id, label, country_code, language_code, is_default }) => ({
        id,
        label,
        country_code,
        language_code,
        is_default,
      })),
      link: appLink(origin, '/visibility', project.id),
    },
    ...(wanted.has('profile')
      ? { profile: profile ?? unavailable('no_brand_profile'), ...entities }
      : {}),
    ...Object.fromEntries(results),
  };
}
