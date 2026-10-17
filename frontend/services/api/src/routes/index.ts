/** Every product route the TypeScript service serves, by family. */
import { aiTrafficRoutes } from './ai-traffic.ts';
import { crawlLogRoutes } from './crawl-logs.ts';
import type { ProductRoute } from './define.ts';
import { executionRoutes } from './executions.ts';
import { visibilityRoutes } from './visibility.ts';
import { performanceRoutes } from './performance.ts';
import { demandRoutes } from './demand.ts';
import { opportunityRoutes } from './opportunities.ts';
import { actionRoutes } from './actions.ts';
import { searchIntelligenceRoutes } from './search-intelligence.ts';
import { commerceRoutes } from './commerce.ts';
import { brandIdentityRoutes } from './brand-identity.ts';
import { promptRoutes } from './prompts.ts';
import { internalLinkRoutes } from './internal-links.ts';
import { siteHealthRoutes } from './site-health.ts';
import { siteHealthCrawlRoutes } from './site-health-crawls.ts';
import { projectRoutes } from './projects.ts';
import { brandDiscoveryRoutes } from './brand-discoveries.ts';
import { integrationRoutes } from './integrations.ts';
import { authRoutes } from './auth.ts';
import { workspaceRoutes } from './workspaces.ts';
import { API_KEY_ROUTES } from './api-keys.ts';
import { publicApiRoutes } from '../public-api/routes.ts';
import { overviewRoutes } from './overview.ts';
import { auditScheduleRoutes } from './audit-schedules.ts';
import { auditRoutes } from './audits.ts';
import { providerRoutes } from './providers.ts';
import { agentRoutes } from './agent.ts';

export const PRODUCT_ROUTES: readonly ProductRoute[] = [
  ...agentRoutes,
  ...providerRoutes,
  ...API_KEY_ROUTES,
  ...projectRoutes,
  ...brandDiscoveryRoutes,
  ...authRoutes,
  ...workspaceRoutes,
  ...overviewRoutes,
  ...internalLinkRoutes,
  ...siteHealthRoutes,
  ...siteHealthCrawlRoutes,
  ...executionRoutes,
  ...aiTrafficRoutes,
  ...crawlLogRoutes,
  ...visibilityRoutes,
  ...performanceRoutes,
  ...demandRoutes,
  ...opportunityRoutes,
  ...actionRoutes,
  ...searchIntelligenceRoutes,
  ...commerceRoutes,
  ...brandIdentityRoutes,
  ...promptRoutes,
  ...integrationRoutes,
  ...auditScheduleRoutes,
  ...auditRoutes,
  ...publicApiRoutes,
];
