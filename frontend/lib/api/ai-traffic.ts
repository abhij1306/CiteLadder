import { mutationOptions, queryOptions, skipToken, type QueryClient } from '@tanstack/react-query';
import type { z } from 'zod';

import { apiClient, type ApiRequestOptions } from './client';
import { retainPreviousDataForScope } from './query-client';
import { queryKeys } from './query-keys';
import type { ProjectScope } from './query-keys/scope';
import {
  aiReferralsSchema,
  aiSourceSchema,
  aiTrafficOverviewSchema,
  botCrawlersResponseSchema,
  botActivityResponseSchema,
  crawlCoverageResponseSchema,
  crawlSourceListSchema,
  crawlTokenSchema,
  crawlVerificationSchema,
  crawlSourceIdSchema,
  crawlCatalogSchema,
  crawlUploadSchema,
  crawlReceiptSchema,
  aiTrafficPagesSchema,
  aiTrafficUrlSchema,
  aiTrafficInsightsSchema,
} from '@citeladder/contracts/ai-traffic';
import { type snapshotGranularitySchema } from '@citeladder/contracts/analytics';
import type {
  CrawlSourceCreateRequest,
  CrawlUploadBatchRequest,
  CrawlUploadCompleteRequest,
  CrawlUploadCreateRequest,
} from '@citeladder/contracts/crawl-log-requests';
import { strictValidate } from '@citeladder/contracts/validation';
import { definedQuery, withQuery } from './shared';

type SnapshotGranularity = z.infer<typeof snapshotGranularitySchema>;
export type AiReferrals = z.infer<typeof aiReferralsSchema>;
export type AiSource = z.infer<typeof aiSourceSchema>;

type AiReferralsWindow = { from: string; to: string } | { from?: never; to?: never };

export type AiReferralsRangeParams =
  | { range: string; from?: never; to?: never }
  | { range?: never };

export type AiReferralsWindowParams = (AiReferralsWindow | AiReferralsRangeParams) & {
  granularity?: SnapshotGranularity;
};

export const aiTrafficApi = {
  pages: (projectId: string, filters: TrafficFilters = {}, options?: ApiRequestOptions) =>
    read(projectId, 'ai-traffic/pages', aiTrafficPagesSchema, filters, options),
  url: (
    projectId: string,
    urlHash: string,
    filters: TrafficFilters = {},
    options?: ApiRequestOptions,
  ) => read(projectId, 'ai-traffic/pages/' + urlHash, aiTrafficUrlSchema, filters, options),
  insights: (projectId: string, filters: TrafficFilters = {}, options?: ApiRequestOptions) =>
    read(projectId, 'ai-traffic/insights', aiTrafficInsightsSchema, filters, options),
  overview: (projectId: string, filters: TrafficFilters = {}, options?: ApiRequestOptions) =>
    read(projectId, 'ai-traffic/overview', aiTrafficOverviewSchema, filters, options),
  crawlers: (projectId: string, filters: TrafficFilters = {}, options?: ApiRequestOptions) =>
    read(projectId, 'ai-traffic/crawlers', botCrawlersResponseSchema, filters, options),
  activity: (projectId: string, filters: TrafficFilters = {}, options?: ApiRequestOptions) =>
    read(projectId, 'ai-traffic/activity', botActivityResponseSchema, filters, options),
  coverage: (projectId: string, filters: TrafficFilters = {}, options?: ApiRequestOptions) =>
    read(projectId, 'ai-traffic/coverage', crawlCoverageResponseSchema, filters, options),
  sources: (projectId: string, options?: ApiRequestOptions) =>
    read(projectId, 'crawl-logs/sources', crawlSourceListSchema, {}, options),
  catalog: (projectId: string, options?: ApiRequestOptions) =>
    read(projectId, 'crawl-logs/catalog', crawlCatalogSchema, {}, options),
  createSource: (projectId: string, input: CrawlSourceCreateRequest, options?: ApiRequestOptions) =>
    write(projectId, 'crawl-logs/sources', input, crawlTokenSchema, options),
  mutateSource: (
    projectId: string,
    sourceId: string,
    action: 'rotate' | 'revoke',
    options?: ApiRequestOptions,
  ) =>
    write(
      projectId,
      'crawl-logs/sources/' + sourceId + '/' + action,
      {},
      crawlTokenSchema,
      options,
    ),
  verifySource: (projectId: string, sourceId: string, options?: ApiRequestOptions) =>
    write(
      projectId,
      'crawl-logs/sources/' + sourceId + '/verify',
      {},
      crawlVerificationSchema,
      options,
    ),
  confirmSinkFilter: (projectId: string, sourceId: string, options?: ApiRequestOptions) =>
    write(
      projectId,
      'crawl-logs/sources/' + sourceId + '/filter-confirmation',
      {},
      crawlSourceIdSchema,
      options,
    ),
  createUpload: (
    projectId: string,
    sourceId: string,
    filename: string,
    size: number,
    options?: ApiRequestOptions,
  ) =>
    write(
      projectId,
      'crawl-logs/sources/' + sourceId + '/uploads',
      { filename, size_bytes: size } satisfies CrawlUploadCreateRequest,
      crawlUploadSchema,
      options,
    ),
  uploadStatus: (
    projectId: string,
    sourceId: string,
    uploadId: string,
    options?: ApiRequestOptions,
  ) =>
    read(
      projectId,
      'crawl-logs/sources/' + sourceId + '/uploads/' + uploadId,
      crawlUploadSchema,
      {},
      options,
    ),
  uploadBatch: (
    projectId: string,
    sourceId: string,
    uploadId: string,
    seq: number,
    lines: string[],
    options?: ApiRequestOptions,
  ) =>
    write(
      projectId,
      'crawl-logs/sources/' + sourceId + '/uploads/' + uploadId + '/batches',
      { seq, lines } satisfies CrawlUploadBatchRequest,
      crawlReceiptSchema,
      options,
    ),
  completeUpload: (
    projectId: string,
    sourceId: string,
    uploadId: string,
    input: CrawlUploadCompleteRequest,
    options?: ApiRequestOptions,
  ) =>
    write(
      projectId,
      'crawl-logs/sources/' + sourceId + '/uploads/' + uploadId + '/complete',
      input,
      crawlUploadSchema,
      options,
    ),
  export: (
    projectId: string,
    view: 'crawlers' | 'activity' | 'pages',
    filters: TrafficFilters = {},
    options?: ApiRequestOptions,
  ) =>
    apiClient.getBlob(
      withQuery(
        '/projects/' + projectId + '/ai-traffic/' + view + '/export',
        definedQuery(filters),
      ),
      options,
    ),
  getDashboard: async (
    projectId: string,
    params?: AiReferralsWindowParams,
    options?: ApiRequestOptions,
  ) => {
    const path = withQuery(`/projects/${projectId}/ai-traffic/referrals`, definedQuery(params));
    const response = await apiClient.get<AiReferrals>(path, options);
    return strictValidate(aiReferralsSchema, response, 'aiReferrals.getDashboard');
  },
};
export type TrafficFilters = Record<string, string | number | undefined | null>;
export type TrafficTableScope = Readonly<{
  workspaceId: string;
  projectId: string;
  filters: TrafficFilters;
}>;

const scoped = (scope: ProjectScope, signal?: AbortSignal) => ({
  signal,
  workspaceId: scope.workspaceId,
});

export const aiTrafficQueries = {
  sources: (scope: ProjectScope) =>
    queryOptions({
      queryKey: queryKeys.aiTraffic.view(scope, 'sources'),
      queryFn: ({ signal }) => aiTrafficApi.sources(scope.projectId, scoped(scope, signal)),
    }),
  overview: (scope: ProjectScope, filters: TrafficFilters) =>
    queryOptions({
      queryKey: queryKeys.aiTraffic.view(scope, 'overview', filters),
      queryFn: ({ signal }) =>
        aiTrafficApi.overview(scope.projectId, filters, scoped(scope, signal)),
    }),
  insights: (scope: ProjectScope, range: string) =>
    queryOptions({
      queryKey: queryKeys.aiTraffic.view(scope, 'insights', { range }),
      queryFn: ({ signal }) =>
        aiTrafficApi.insights(scope.projectId, { range }, scoped(scope, signal)),
    }),
  catalog: (scope: ProjectScope) =>
    queryOptions({
      queryKey: queryKeys.aiTraffic.view(scope, 'catalog'),
      queryFn: ({ signal }) => aiTrafficApi.catalog(scope.projectId, scoped(scope, signal)),
    }),
  crawlers: (scope: ProjectScope, filters: TrafficFilters) =>
    queryOptions({
      queryKey: queryKeys.aiTraffic.view(scope, 'crawlers', filters),
      queryFn: ({ signal }) =>
        aiTrafficApi.crawlers(scope.projectId, filters, scoped(scope, signal)),
    }),
  activity: (scope: ProjectScope, filters: TrafficFilters) =>
    queryOptions({
      queryKey: queryKeys.aiTraffic.view(scope, 'activity', filters),
      queryFn: ({ signal }) =>
        aiTrafficApi.activity(scope.projectId, filters, scoped(scope, signal)),
    }),
  pages: (scope: ProjectScope, filters: TrafficFilters) =>
    queryOptions({
      queryKey: queryKeys.aiTraffic.view(scope, 'pages', filters),
      queryFn: ({ signal }) => aiTrafficApi.pages(scope.projectId, filters, scoped(scope, signal)),
    }),
  coverage: (scope: ProjectScope, filters: TrafficFilters) =>
    queryOptions({
      queryKey: queryKeys.aiTraffic.view(scope, 'coverage', filters),
      queryFn: ({ signal }) =>
        aiTrafficApi.coverage(scope.projectId, filters, scoped(scope, signal)),
    }),
  url: (scope: ProjectScope, urlHash: string | null, filters: TrafficFilters) =>
    queryOptions({
      queryKey: queryKeys.aiTraffic.view(scope, 'url', { urlHash, ...filters }),
      queryFn: urlHash
        ? ({ signal }) => aiTrafficApi.url(scope.projectId, urlHash, filters, scoped(scope, signal))
        : skipToken,
    }),
  dashboard: (scope: ProjectScope, params: AiReferralsWindowParams) =>
    queryOptions({
      queryKey: queryKeys.aiTraffic.dashboard(scope, params),
      queryFn: ({ signal }) =>
        aiTrafficApi.getDashboard(scope.projectId, params, scoped(scope, signal)),
      placeholderData: (previousData, previousQuery) =>
        previousQuery?.queryKey.includes(scope.workspaceId)
          ? retainPreviousDataForScope(scope.projectId, previousData, previousQuery)
          : undefined,
    }),
};

export const refreshAiTraffic = (client: QueryClient, projectId: string) =>
  client.invalidateQueries({ queryKey: queryKeys.aiTraffic.project(projectId) });

export const refreshCrawlSources = (client: QueryClient, projectId: string) =>
  client.invalidateQueries({ queryKey: queryKeys.aiTraffic.resource(projectId, 'sources') });

export type CrawlSourceAction =
  | Readonly<{ kind: 'create'; input: CrawlSourceCreateRequest }>
  | Readonly<{ kind: 'rotate' | 'revoke'; id: string }>;

export const aiTrafficMutations = {
  source: (scope: ProjectScope) =>
    mutationOptions({
      mutationFn: (action: CrawlSourceAction) =>
        action.kind === 'create'
          ? aiTrafficApi.createSource(scope.projectId, action.input, scoped(scope))
          : aiTrafficApi.mutateSource(scope.projectId, action.id, action.kind, scoped(scope)),
      onSuccess: (_token, _action, _result, { client }) =>
        refreshAiTraffic(client, scope.projectId),
    }),
  verifySource: (scope: ProjectScope) =>
    mutationOptions({
      mutationFn: (sourceId: string) =>
        aiTrafficApi.verifySource(scope.projectId, sourceId, scoped(scope)),
      onSuccess: (_outcome, _sourceId, _result, { client }) =>
        refreshAiTraffic(client, scope.projectId),
    }),
  confirmSinkFilter: (scope: ProjectScope) =>
    mutationOptions({
      mutationFn: (sourceId: string) =>
        aiTrafficApi.confirmSinkFilter(scope.projectId, sourceId, scoped(scope)),
      onSuccess: (_source, _sourceId, _result, { client }) =>
        refreshAiTraffic(client, scope.projectId),
    }),
};

async function read<T>(
  projectId: string,
  path: string,
  schema: z.ZodType<T>,
  filters: TrafficFilters,
  options?: ApiRequestOptions,
): Promise<T> {
  return strictValidate(
    schema,
    await apiClient.get(
      withQuery('/projects/' + projectId + '/' + path, definedQuery(filters)),
      options,
    ),
    path,
  );
}
async function write<T>(
  projectId: string,
  path: string,
  input: Record<string, unknown>,
  schema: z.ZodType<T>,
  options?: ApiRequestOptions,
): Promise<T> {
  return strictValidate(
    schema,
    await apiClient.post('/projects/' + projectId + '/' + path, input, options),
    path,
  );
}
