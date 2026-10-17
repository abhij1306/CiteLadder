/**
 * Actions endpoints + query/mutation options.
 *
 * An Action is the unit of work over the Opportunity store: every live
 * Opportunity sharing one target, plus Agent work on that target. Reads are
 * persisted projections; the writes are the user's workflow decision and
 * the implementation declaration.
 */
import { mutationOptions, queryOptions } from '@tanstack/react-query';
import type { z } from 'zod';

import { apiClient, type ApiRequestOptions } from './client';
import { queryKeys } from './query-keys';
import {
  actionDeclarationSchema,
  actionDetailSchema,
  actionItemSchema,
  actionStatusSchema,
  actionsPageSchema,
} from '@citeladder/contracts/actions';
import { strictValidate } from '@citeladder/contracts/validation';
import { definedQuery, withQuery } from './shared';

export type Action = z.infer<typeof actionItemSchema>;
export type ActionDetail = z.infer<typeof actionDetailSchema>;
export type ActionStatus = z.infer<typeof actionStatusSchema>;
export type ActionDeclaration = z.infer<typeof actionDeclarationSchema>;
export type MeasurementLeg = ActionDeclaration['legs'][number];
/** Targets and expected checks are server-owned; the user names only these. */
export type ActionDeclarationInput = {
  recommendation_ids?: string[];
  /** The revision shipped, or null for work done outside CiteLadder. */
  output_revision_id: string | null;
  declared_implemented_at: string;
};
/** The statuses a user may store; the rest are derived or declared. */
export type ActionUserStatus = Extract<ActionStatus, 'open' | 'dismissed'>;

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
    input: ActionDeclarationInput,
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

export const actionsQueries = {
  list: (workspaceId: string, projectId: string, params?: ActionsParams) =>
    queryOptions({
      queryKey: queryKeys.actions.list(projectId, {
        status: params?.status ?? null,
        targetKind: params?.target_kind ?? null,
        cursor: params?.cursor ?? null,
        limit: params?.limit ?? null,
      }),
      queryFn: ({ signal }) => actionsApi.list(projectId, params, { signal, workspaceId }),
    }),
  detail: (workspaceId: string, actionId: string) =>
    queryOptions({
      queryKey: queryKeys.actions.detail(actionId),
      queryFn: ({ signal }) => actionsApi.get(actionId, { signal, workspaceId }),
    }),
};

export const actionsMutations = {
  updateStatus: (workspaceId: string) =>
    mutationOptions({
      mutationFn: (vars: { actionId: string; status: ActionUserStatus }) =>
        actionsApi.updateStatus(vars.actionId, vars.status, { workspaceId }),
    }),
  declare: (workspaceId: string) =>
    mutationOptions({
      mutationFn: (vars: {
        actionId: string;
        input: ActionDeclarationInput;
        idempotencyKey: string;
      }) => actionsApi.declare(vars.actionId, vars.input, vars.idempotencyKey, { workspaceId }),
    }),
};
