import { analyticsAppPath } from '@citeladder/contracts/mcp-app';
import type { Database } from '../db/database.ts';
import { listMarkets } from '../projects/markets.ts';
import { currentInstructions } from '../agent/instructions.ts';
import { readBrandMemory } from '../projects/brand-profile.ts';
import { readBusinessMap } from '../projects/business-map.ts';
import { listThemes } from '../projects/themes.ts';
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
import { projectExport } from './views-exports.ts';
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

export const overviewSections: [string, ...string[]] = ['profile', ...Object.keys(sections)];

async function brandProfile({ db, scope }: ProjectRead) {
  const [memory, themes, instructions] = await Promise.all([
    readBrandMemory(db, scope),
    listThemes(db, scope),
    currentInstructions(db, scope),
  ]);
  return {
    profile: memory
      ? { ...memory, business_map: await readBusinessMap(db, scope) }
      : unavailable('no_brand_profile'),
    themes: themes.map(({ id, name }) => ({ id, name })),
    agent_instructions: instructions,
  };
}

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
    wanted.has('profile') ? brandProfile(read) : null,
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
      markets: markets.map(({ id, label, country_code, language_code, is_default }) => ({
        id,
        label,
        country_code,
        language_code,
        is_default,
      })),
      link: appLink(origin, analyticsAppPath('overview'), project.id),
      report_pdf: projectExport(read, '/overview/report.pdf'),
    },
    ...(wanted.has('profile') ? { ...profile, ...entities } : {}),
    ...Object.fromEntries(results),
  };
}
