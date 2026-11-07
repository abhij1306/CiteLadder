/**
 * Actions endpoints + query/mutation options.
 *
 * An Action is the unit of work over the Opportunity store: every live
 * Opportunity sharing one target, plus Agent work on that target. Reads are
 * persisted projections; the writes are the user's workflow decision and
 * the implementation declaration.
 */
import { mutationOptions, queryOptions, type QueryClient } from '@tanstack/react-query';
import type { z } from 'zod';

import { apiClient, type ApiRequestOptions } from './client';
import { queryKeys } from './query-keys';
import type { ProjectScope } from './query-keys/scope';
import {
  actionDeclarationSchema,
  actionDetailSchema,
  actionItemSchema,
  actionStatusSchema,
  actionsPageSchema,
  type ActionDeclarationRequest,
  type ActionUserStatus,
} from '@citeladder/contracts/actions';
import { strictValidate } from '@citeladder/contracts/validation';
import { definedQuery, withQuery } from './shared';
import { AGENT_MENTION_POOL_SIZE } from '@/lib/config/agent';
import { TABLE_DEFAULT_PAGE_SIZE } from '@/lib/config/tables';

export type Action = z.infer<typeof actionItemSchema>;
export type ActionDetail = z.infer<typeof actionDetailSchema>;
export type ActionStatus = z.infer<typeof actionStatusSchema>;
export type ActionDeclaration = z.infer<typeof actionDeclarationSchema>;
export type MeasurementLeg = ActionDeclaration['legs'][number];

export type ActionsParams = {
  cursor?: string;
  limit?: number;
  /** Omitted: the work queue (open and in progress). */
  status?: ActionStatus;
  target_kind?: string;
};

export const actionsApi = {
  list: async (projectId: string, params?: ActionsParams, options?: ApiRequestOptions) =>
    strictValidate(
      actionsPageSchema,
      await apiClient.get(
        withQuery(`/projects/${projectId}/actions`, definedQuery(params)),
        options,
      ),
      'actions.list',
    ),
  get: async (actionId: string, options?: ApiRequestOptions) =>
    strictValidate(
      actionDetailSchema,
      await apiClient.get(`/actions/${actionId}`, options),
      'actions.get',
    ),
  updateStatus: async (actionId: string, status: ActionUserStatus, options?: ApiRequestOptions) =>
    strictValidate(
      actionItemSchema,
      await apiClient.patch(`/actions/${actionId}`, { status }, options),
      'actions.updateStatus',
    ),
  declare: async (
    actionId: string,
    input: ActionDeclarationRequest,
    idempotencyKey: string,
    options?: ApiRequestOptions,
  ) =>
    strictValidate(
      actionDeclarationSchema,
      await apiClient.post(`/actions/${actionId}/declaration`, input, {
        ...options,
        idempotencyKey,
        retryNetworkFailures: true,
      }),
      'actions.declare',
    ),
};

/**
 * One page of Actions. Without a limit it is the Actions table's first page
 * at its default size, so the navigation badge, the Agent's top Actions and
 * the table share one request instead of asking for two page sizes of the
 * same queue.
 */
function actionListQuery(scope: ProjectScope, params?: ActionsParams) {
  const request = { ...params, limit: params?.limit ?? TABLE_DEFAULT_PAGE_SIZE };
  return queryOptions({
    queryKey: queryKeys.actions.list(scope, {
      status: request.status ?? null,
      targetKind: request.target_kind ?? null,
      cursor: request.cursor ?? null,
      limit: request.limit,
    }),
    queryFn: ({ signal }) =>
      actionsApi.list(scope.projectId, request, { signal, workspaceId: scope.workspaceId }),
  });
}

/** Action reads: the work queue, the composer's mention pool and one Action. */
export const actionsQueries = {
  list: actionListQuery,
  /**
   * The Actions the Agent composer's `@` menu can mention: a wider page than
   * the table's, so an Action past the first ten can still be found by name.
   */
  mentionPool: (scope: ProjectScope) => actionListQuery(scope, { limit: AGENT_MENTION_POOL_SIZE }),
  detail: (workspaceId: string | null, actionId: string) =>
    queryOptions({
      queryKey: queryKeys.actions.detail(workspaceId, actionId),
      queryFn: ({ signal }) => actionsApi.get(actionId, { signal, workspaceId }),
    }),
};

/** Every Action read: a status change or a declaration moves the queue, its counts and the detail. */
const refreshActions = (client: QueryClient) =>
  client.invalidateQueries({ queryKey: queryKeys.actions.all });

/**
 * The Site Health internal-links review: declaring selected link
 * recommendations implemented changes which ones it still offers.
 */
const refreshInternalLinkReview = (client: QueryClient, projectId: string) =>
  client.invalidateQueries({
    queryKey: queryKeys.siteHealth.resource(projectId, 'internal-links'),
  });

/** Action writes; each success refreshes every read it changes. */
export const actionsMutations = {
  updateStatus: (workspaceId: string | null) =>
    mutationOptions({
      mutationFn: (vars: { actionId: string; status: ActionUserStatus }) =>
        actionsApi.updateStatus(vars.actionId, vars.status, { workspaceId }),
      // The refresh runs in the background: the control settles on the write.
      onSuccess: (_action, _vars, _result, { client }) => void refreshActions(client),
    }),
  /**
   * A declaration closes the Action's work; one naming internal-link
   * recommendations also changes the internal-links review it came from. The
   * refresh runs in the background, so the dialog closes on the write.
   */
  declare: (workspaceId: string | null) =>
    mutationOptions({
      mutationFn: (vars: {
        actionId: string;
        /** The Action's project, whose internal-links review the declaration may change. */
        projectId: string;
        input: ActionDeclarationRequest;
        idempotencyKey: string;
      }) => actionsApi.declare(vars.actionId, vars.input, vars.idempotencyKey, { workspaceId }),
      onSuccess: (_declaration, vars, _result, { client }) =>
        void Promise.all([
          refreshActions(client),
          vars.input.recommendation_ids
            ? refreshInternalLinkReview(client, vars.projectId)
            : undefined,
        ]),
    }),
};
