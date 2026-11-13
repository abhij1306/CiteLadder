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
import { clientErrorRoutes } from './client-errors.ts';

/**
 * The route modules, keyed by their path below `src/`, in registration order.
 * The route-ownership gate reads this to refuse a family served by two modules.
 */
export const ROUTE_MODULES: Readonly<Record<string, readonly ProductRoute[]>> = {
  'routes/agent.ts': agentRoutes,
  'routes/providers.ts': providerRoutes,
  'routes/api-keys.ts': API_KEY_ROUTES,
  'routes/projects.ts': projectRoutes,
  'routes/brand-discoveries.ts': brandDiscoveryRoutes,
  'routes/auth.ts': authRoutes,
  'routes/client-errors.ts': clientErrorRoutes,
  'routes/workspaces.ts': workspaceRoutes,
  'routes/overview.ts': overviewRoutes,
  'routes/internal-links.ts': internalLinkRoutes,
  'routes/site-health.ts': siteHealthRoutes,
  'routes/site-health-crawls.ts': siteHealthCrawlRoutes,
  'routes/executions.ts': executionRoutes,
  'routes/ai-traffic.ts': aiTrafficRoutes,
  'routes/crawl-logs.ts': crawlLogRoutes,
  'routes/visibility.ts': visibilityRoutes,
  'routes/performance.ts': performanceRoutes,
  'routes/demand.ts': demandRoutes,
  'routes/opportunities.ts': opportunityRoutes,
  'routes/actions.ts': actionRoutes,
  'routes/search-intelligence.ts': searchIntelligenceRoutes,
  'routes/commerce.ts': commerceRoutes,
  'routes/brand-identity.ts': brandIdentityRoutes,
  'routes/prompts.ts': promptRoutes,
  'routes/integrations.ts': integrationRoutes,
  'routes/audit-schedules.ts': auditScheduleRoutes,
  'routes/audits.ts': auditRoutes,
  'public-api/routes.ts': publicApiRoutes,
};

export const PRODUCT_ROUTES: readonly ProductRoute[] = Object.values(ROUTE_MODULES).flat();
