import {
  infiniteQueryOptions,
  mutationOptions,
  queryOptions,
  type QueryClient,
} from '@tanstack/react-query';
import type { z } from 'zod';

import { apiClient, type ApiRequestOptions } from './client';
import { queryKeys } from './query-keys';
import type { ProjectScope } from './query-keys/scope';
import {
  ACTION_STATUS_ANY,
  actionAnalyzeResultSchema,
  actionBulkStatusResultSchema,
  actionDeclarationSchema,
  actionDetailSchema,
  actionItemSchema,
  actionStatusSchema,
  actionsPageSchema,
  actionTreeSchema,
  actionUrlsPageSchema,
  analyzablePagesSchema,
  urlActionsSchema,
  type ActionAnalyzeRequest,
  type ActionBulkStatusRequest,
  type ActionDeclarationRequest,
  type ActionPriorityBand,
  type ActionTreeGroupBy,
  type ActionUserStatus,
} from '@citeladder/contracts/actions';
import { strictValidate } from '@citeladder/contracts/validation';
import { definedQuery, withQuery } from './shared';
import { ACTIONS_GROUPING_PAGE_SIZE, AGENT_MENTION_SEARCH_LIMIT } from '@/lib/config/agent';
import { TABLE_DEFAULT_PAGE_SIZE } from '@/lib/config/tables';

export type Action = z.infer<typeof actionItemSchema>;
export type ActionsPage = z.infer<typeof actionsPageSchema>;
export type ActionDetail = z.infer<typeof actionDetailSchema>;
export type ActionStatus = z.infer<typeof actionStatusSchema>;
export type {
  ActionPriorityBand,
  ActionTree,
  ActionTreeGroupBy,
} from '@citeladder/contracts/actions';
export type ActionDeclaration = z.infer<typeof actionDeclarationSchema>;
export type MeasurementLeg = ActionDeclaration['legs'][number];
export type AnalyzablePage = z.infer<typeof analyzablePagesSchema>['items'][number];

export type ActionTreeFilters = Readonly<{ priority?: ActionPriorityBand; family?: string }>;

export type ActionTreeParams = ActionTreeFilters &
  Readonly<{ status: ActionStatus; group_by: ActionTreeGroupBy }>;

export const DEFAULT_ACTION_TREE = {
  status: 'open',
  group_by: 'goal',
} as const satisfies ActionTreeParams;

export type ActionGroupingParams = Readonly<{
  status: ActionStatus;
  grouping: string;
  priority?: string;
  family?: string;
  approach?: string;
  ownership?: string;
  topic?: string;
}>;

export type ActionsParams = {
  cursor?: string;
  limit?: number;
  status?: ActionStatus | typeof ACTION_STATUS_ANY;
  q?: string;
  target_kind?: string;
  approach?: string;
  priority?: ActionPriorityBand;
  family?: string;
};

type Query = Readonly<Record<string, string | undefined>>;

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
  page: async (projectId: string, query: Query, options?: ApiRequestOptions) =>
    strictValidate(
      actionsPageSchema,
      await apiClient.get(
        withQuery(`/projects/${projectId}/actions`, definedQuery(query)),
        options,
      ),
      'actions.page',
    ),
  tree: async (projectId: string, params: ActionTreeParams, options?: ApiRequestOptions) =>
    strictValidate(
      actionTreeSchema,
      await apiClient.get(
        withQuery(`/projects/${projectId}/actions/tree`, definedQuery(params)),
        options,
      ),
      'actions.tree',
    ),
  bulkStatus: async (
    projectId: string,
    body: ActionBulkStatusRequest,
    options?: ApiRequestOptions,
  ) =>
    strictValidate(
      actionBulkStatusResultSchema,
      await apiClient.post(`/projects/${projectId}/actions/status`, body, options),
      'actions.bulkStatus',
    ),
  get: async (actionId: string, options?: ApiRequestOptions) =>
    strictValidate(
      actionDetailSchema,
      await apiClient.get(`/actions/${actionId}`, options),
      'actions.get',
    ),
  urls: async (actionId: string, cursor: string, options?: ApiRequestOptions) =>
    strictValidate(
      actionUrlsPageSchema,
      await apiClient.get(
        withQuery(`/actions/${actionId}/urls`, definedQuery({ cursor })),
        options,
      ),
      'actions.urls',
    ),
  urlActions: async (projectId: string, siteUrlId: string, options?: ApiRequestOptions) =>
    strictValidate(
      urlActionsSchema,
      await apiClient.get(`/projects/${projectId}/urls/${siteUrlId}/actions`, options),
      'actions.urlActions',
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
  analyzablePages: async (projectId: string, search: string, options?: ApiRequestOptions) =>
    strictValidate(
      analyzablePagesSchema,
      await apiClient.get(
        withQuery(
          `/projects/${projectId}/actions/analyze/pages`,
          definedQuery({ q: search.trim() || undefined }),
        ),
        options,
      ),
      'actions.analyzablePages',
    ),
  analyze: async (
    projectId: string,
    input: ActionAnalyzeRequest,
    idempotencyKey: string,
    options?: ApiRequestOptions,
  ) =>
    strictValidate(
      actionAnalyzeResultSchema,
      await apiClient.post(`/projects/${projectId}/actions/analyze`, input, {
        ...options,
        idempotencyKey,
      }),
      'actions.analyze',
    ),
};

function actionListQuery(scope: ProjectScope, params?: ActionsParams) {
  const request = { ...params, limit: params?.limit ?? TABLE_DEFAULT_PAGE_SIZE };
  return queryOptions({
    queryKey: queryKeys.actions.list(scope, {
      status: request.status ?? null,
      q: request.q ?? null,
      targetKind: request.target_kind ?? null,
      approach: request.approach ?? null,
      priority: request.priority ?? null,
      family: request.family ?? null,
      cursor: request.cursor ?? null,
      limit: request.limit,
    }),
    queryFn: ({ signal }) =>
      actionsApi.list(scope.projectId, request, { signal, workspaceId: scope.workspaceId }),
  });
}

export const actionsQueries = {
  list: actionListQuery,
  tree: (scope: ProjectScope, params: ActionTreeParams) =>
    queryOptions({
      queryKey: queryKeys.actions.tree(scope, params),
      queryFn: ({ signal }) =>
        actionsApi.tree(scope.projectId, params, { signal, workspaceId: scope.workspaceId }),
    }),
  groupingRows: (scope: ProjectScope, params: ActionGroupingParams, cursor: string) =>
    infiniteQueryOptions({
      queryKey: queryKeys.actions.groupingRows(scope, params, cursor),
      initialPageParam: cursor,
      queryFn: ({ signal, pageParam }) =>
        actionsApi.page(
          scope.projectId,
          { ...params, cursor: pageParam, limit: String(ACTIONS_GROUPING_PAGE_SIZE) },
          { signal, workspaceId: scope.workspaceId },
        ),
      getNextPageParam: (page) => page.next_cursor ?? undefined,
    }),
  mentionSearch: (scope: ProjectScope, search: string) =>
    actionListQuery(scope, {
      status: ACTION_STATUS_ANY,
      q: search.trim() || undefined,
      limit: AGENT_MENTION_SEARCH_LIMIT,
    }),
  detail: (workspaceId: string | null, actionId: string) =>
    queryOptions({
      queryKey: queryKeys.actions.detail(workspaceId, actionId),
      queryFn: ({ signal }) => actionsApi.get(actionId, { signal, workspaceId }),
    }),
  urls: (workspaceId: string | null, actionId: string, cursor: string) =>
    infiniteQueryOptions({
      queryKey: queryKeys.actions.urls(workspaceId, actionId, cursor),
      initialPageParam: cursor,
      queryFn: ({ signal, pageParam }) =>
        actionsApi.urls(actionId, pageParam, { signal, workspaceId }),
      getNextPageParam: (page) => page.next_cursor ?? undefined,
    }),
  urlActions: (scope: ProjectScope, siteUrlId: string) =>
    queryOptions({
      queryKey: queryKeys.actions.urlActions(scope, siteUrlId),
      queryFn: ({ signal }) =>
        actionsApi.urlActions(scope.projectId, siteUrlId, {
          signal,
          workspaceId: scope.workspaceId,
        }),
    }),
  analyzablePages: (scope: ProjectScope, search: string) =>
    queryOptions({
      queryKey: queryKeys.actions.analyzePages(scope, search.trim()),
      queryFn: ({ signal }) =>
        actionsApi.analyzablePages(scope.projectId, search, {
          signal,
          workspaceId: scope.workspaceId,
        }),
    }),
};

const refreshActions = (client: QueryClient) =>
  client.invalidateQueries({ queryKey: queryKeys.actions.all });

const refreshInternalLinkReview = (client: QueryClient, projectId: string) =>
  client.invalidateQueries({
    queryKey: queryKeys.siteHealth.resource(projectId, 'internal-links'),
  });

export const actionsMutations = {
  updateStatus: (workspaceId: string | null) =>
    mutationOptions({
      mutationFn: (vars: { actionId: string; status: ActionUserStatus }) =>
        actionsApi.updateStatus(vars.actionId, vars.status, { workspaceId }),
      onSuccess: (_action, _vars, _result, { client }) => void refreshActions(client),
    }),
  bulkStatus: (scope: ProjectScope) =>
    mutationOptions({
      mutationFn: (body: ActionBulkStatusRequest) =>
        actionsApi.bulkStatus(scope.projectId, body, { workspaceId: scope.workspaceId }),
      onSettled: (_result, _error, _body, _context, { client }) => void refreshActions(client),
    }),
  declare: (workspaceId: string | null) =>
    mutationOptions({
      mutationFn: (vars: {
        actionId: string;
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
  analyze: (scope: ProjectScope) =>
    mutationOptions({
      mutationFn: (vars: { input: ActionAnalyzeRequest; idempotencyKey: string }) =>
        actionsApi.analyze(scope.projectId, vars.input, vars.idempotencyKey, {
          workspaceId: scope.workspaceId,
        }),
      onSuccess: (_started, _vars, _result, { client }) =>
        void Promise.all([
          refreshActions(client),
          client.invalidateQueries({ queryKey: queryKeys.agent.chatLists(scope.projectId) }),
        ]),
    }),
};
