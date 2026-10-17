/** Strict client for the persisted AI-referral projection. */
import type { z } from 'zod';

import { apiClient, type ApiRequestOptions } from './client';
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
import { strictValidate } from '@citeladder/contracts/validation';
import { definedQuery, withQuery } from './shared';

type SnapshotGranularity = z.infer<typeof snapshotGranularitySchema>;
export type AiReferrals = z.infer<typeof aiReferralsSchema>;
export type AiSource = z.infer<typeof aiSourceSchema>;

/** An exact persisted window. Composed into `AiReferralsWindowParams` below. */
type AiReferralsWindow = { from: string; to: string } | { from?: never; to?: never };

/**
 * How a caller names the window it wants: an explicit persisted `from`/`to`,
 * or a `range` preset the SERVER resolves against persisted evidence. The
 * two are mutually exclusive — a preset carries no client-computed dates,
 * which is what keeps a lagging provider's window from being missed.
 */
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
  createSource: (projectId: string, input: Record<string, unknown>, options?: ApiRequestOptions) =>
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
  /** Check a Google Cloud source's subscription now; it activates on a pass. */
  verifySource: (projectId: string, sourceId: string, options?: ApiRequestOptions) =>
    write(
      projectId,
      'crawl-logs/sources/' + sourceId + '/verify',
      {},
      crawlVerificationSchema,
      options,
    ),
  /** The customer installed the sink filter for the current crawler catalog. */
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
      { filename, size_bytes: size },
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
      { seq, lines },
      crawlReceiptSchema,
      options,
    ),
  completeUpload: (
    projectId: string,
    sourceId: string,
    uploadId: string,
    input: Record<string, unknown>,
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
