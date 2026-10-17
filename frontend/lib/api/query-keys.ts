/**
 * React Query key namespaces.
 *
 * All ids are string UUIDs (workspace-scoped contract). One namespace per API
 * domain owner, each defined in its own module under `query-keys/`:
 *   - core.ts          — auth, workspaces, projects, prompts, providers
 *   - runs.ts          — runs (audits + executions), visibility, cited pages
 *   - site-health.ts   — site health (crawls, inventory, monitored, issues)
 *   - integrations.ts  — integrations (connections, sync runs)
 *   - performance.ts   — performance (dashboard, dimension tables, range task)
 *   - demand.ts        — search-demand projections
 *   - ai-traffic.ts  — AI-referral measurements
 *   - opportunities.ts — opportunities (catalog, detail)
 *   - actions.ts       — actions (work queue, detail)
 *   - agent.ts         — agent chats, outputs, skills, instructions
 *   - commerce.ts      — commerce (catalog feed health, agentic product visibility)
 *
 * This facade assembles them under one `queryKeys` entry point.
 */
import { actionKeys } from './query-keys/actions';
import { agentKeys } from './query-keys/agent';
import { aiTrafficKeys } from './query-keys/ai-traffic';
import { brandDiscoveryKeys } from './query-keys/brand-discovery';
import { commerceKeys } from './query-keys/commerce';
import { demandKeys } from './query-keys/demand';
import { searchIntelligenceKeys } from './query-keys/search-intelligence';
import {
  authKeys,
  projectKeys,
  promptKeys,
  providerKeys,
  topicKeys,
  workspaceKeys,
  apiKeyKeys,
} from './query-keys/core';
import { integrationKeys } from './query-keys/integrations';
import { opportunityKeys } from './query-keys/opportunities';
import { runKeys, visibilityKeys } from './query-keys/runs';
import { siteHealthKeys } from './query-keys/site-health';
import { performanceKeys } from './query-keys/performance';

export const queryKeys = {
  auth: authKeys,
  apiKeys: apiKeyKeys,
  brandDiscovery: brandDiscoveryKeys,
  workspaces: workspaceKeys,
  projects: projectKeys,
  prompts: promptKeys,
  topics: topicKeys,
  providers: providerKeys,
  runs: runKeys,
  visibility: visibilityKeys,
  siteHealth: siteHealthKeys,
  integrations: integrationKeys,
  performance: performanceKeys,
  demand: demandKeys,
  searchIntelligence: searchIntelligenceKeys,
  aiTraffic: aiTrafficKeys,
  opportunities: opportunityKeys,
  actions: actionKeys,
  agent: agentKeys,
  commerce: commerceKeys,
} as const;

/**
 * Reads derived from finished audits: a completed or cancelled run
 * invalidates each of them (Visibility, and Commerce's AI Shelf and target
 * Actions).
 */
export const AUDIT_RESULT_QUERY_ROOTS = [queryKeys.visibility.all, queryKeys.commerce.all] as const;
