/**
 * AI Traffic queries bind workspace, project, view and selected filters.
 * The retained referrals dashboard keeps its window and granularity in the key.
 */
import type { ListFilters } from './shared';

export const aiTrafficKeys = {
  all: ['ai-traffic'] as const,
  view: (workspaceId: string, projectId: string, view: string, filters: ListFilters = {}) =>
    ['ai-traffic', workspaceId, projectId, view, filters] as const,
  dashboard: (workspaceId: string, projectId: string, filters: ListFilters = {}) =>
    ['ai-traffic', 'dashboard', projectId, workspaceId, filters] as const,
};
