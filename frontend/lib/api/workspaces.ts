/**
 * Workspace reads: the person's memberships. This build has one local
 * workspace, so there are no member, invitation or Terms endpoints.
 */
import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { getBootstrapReadTimeoutMs } from '@/lib/config/operational';
import { apiClient, type ApiRequestOptions } from './client';
import { queryKeys } from './query-keys';
import { workspaceSchema } from '@citeladder/contracts/auth';
import { strictValidate } from '@citeladder/contracts/validation';
import type { Workspace } from '@citeladder/contracts';

const workspaceListSchema = z.array(workspaceSchema);

export const workspacesApi = {
  /**
   * The person's memberships. Deliberately not workspace-scoped: it is what
   * decides which workspaces exist.
   */
  list: async (options?: ApiRequestOptions) => {
    const res = await apiClient.get<Workspace[]>('/workspaces', { ...options, workspaceId: null });
    return strictValidate(workspaceListSchema, res, 'workspaces.list');
  },
};

/**
 * Workspace reads. The membership list is a bootstrap read: it carries the
 * bounded bootstrap timeout, so a stall reaches the gate's retry notice in
 * seconds.
 */
export const workspaceQueries = {
  list: () =>
    queryOptions({
      queryKey: queryKeys.workspaces.list(),
      queryFn: ({ signal }) =>
        workspacesApi.list({ signal, timeoutMs: getBootstrapReadTimeoutMs() }),
    }),
};

/** Every workspace read. */
export const refreshWorkspaces = (client: QueryClient) =>
  client.invalidateQueries({ queryKey: queryKeys.workspaces.all });
