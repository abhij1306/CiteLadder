/**
 * Visibility domain endpoint: the selected-run dashboard projection —
 * Visibility Score, per-engine comparison, and the brand-vs-competitor rankings
 * table. `avg_position` is present but nullable. Defaults
 * to the project's latest completed audit when `audit_id` is omitted. Response
 * passes through `strictValidate`.
 *
 * `getVisibilityTrends` is the additive cross-run trend projection
 * (`/projects/{id}/visibility/trends`): an ordered series of
 * `VisibilityTrendPoint`s over persisted `MetricSnapshot` rows, filtered by
 * engine/date and bucketed by run/week/month. Same-origin `/api/v1` only.
 */
import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import {
  visibilityEvidenceResponseSchema,
  visibilityFanoutSummarySchema,
  visibilitySourceMoversSchema,
  visibilitySourceNearMissesSchema,
  visibilitySourceSeriesSchema,
  visibilitySourceUrlSchema,
  visibilitySourcesSchema,
} from '@citeladder/contracts/visibility-evidence';

import { apiClient, type ApiRequestOptions } from './client';
import { queryKeys } from './query-keys';
import { competitorSchema } from '@citeladder/contracts/project';
import { strictValidate } from '@citeladder/contracts/validation';
import {
  observedCompetitorSchema,
  promptHistorySchema,
  promptMetricItemSchema,
  visibilityMarketsSchema,
  visibilitySchema,
} from '@citeladder/contracts/visibility';
import { surfaceRatesSchema } from '@citeladder/contracts/audits';
import { perceptionResponseSchema } from '@citeladder/contracts/visibility-perception';
import { accuracyResponseSchema } from '@citeladder/contracts/fact-checking';
import { visibilityAdsResponseSchema } from '@citeladder/contracts/visibility-ads';
import { visibilityTrendListSchema } from '@citeladder/contracts/visibility-trends';
import { definedQuery, withQuery } from './shared';
import type {
  ObservedCompetitor,
  Competitor,
  PromptHistory,
  PromptMetricItem,
  Visibility,
  VisibilityEvidenceResponse,
  VisibilityTrendPoint,
} from './types';

const promptMetricListSchema = z.array(promptMetricItemSchema);
const observedCompetitorListSchema = z.array(observedCompetitorSchema);

/** Which prompts a Visibility read counts: unbranded, branded, or all of them. */
export type VisibilityCohortParam = 'core' | 'comparison' | 'all';

/** Filters for the cross-run trend request (all optional; same-origin only). */
type VisibilityTrendParams = {
  /** A non-default market's id; omitted reads the project default. */
  market?: string;
  cohort?: VisibilityCohortParam;
  /** Logical engine slice (`chatgpt` | `gemini` | `claude`); omit for all. */
  engine?: string;
  /** Inclusive UTC lower bound (ISO 8601) for the completion window. */
  from?: string;
  /** Inclusive UTC upper bound (ISO 8601) for the completion window. */
  to?: string;
  /** Bucketing: `run` (default) | `week` | `month`. */
  granularity?: string;
};

/**
 * Filters for the shared execution-evidence request (all optional). When both
 * `audit_id` and a date bound are set the backend intersects them (the selected
 * audit must fall inside the inclusive window). Same-origin only.
 */
type VisibilityEvidenceParams = {
  audit_ids?: string[];
  cursor?: string;
  as_of?: string;
  outcome?: string;
  competitor?: string;
  domain?: string;
  url?: string;
  cohort?: VisibilityCohortParam;
  /** Restrict to one audit in the authorized project. */
  audit_id?: string;
  /** Restrict by the source prompt frozen on `AuditPromptSnapshot.prompt_id`. */
  prompt_id?: string;
  /** Logical engine slice (`chatgpt` | `gemini` | `claude`); omit for all. */
  engine?: string;
  /** Inclusive UTC lower bound (ISO 8601) for the completion window. */
  from?: string;
  /** Inclusive UTC upper bound (ISO 8601) for the completion window. */
  to?: string;
  /** Newest-window size (default 100, max 500). */
  limit?: number;
};

/** The selection one Visibility request resolves to. */
export type ProjectVisibilityParams = {
  audit_id?: string;
  /** A non-default market's id; omitted reads the project default. */
  market?: string;
  cohort?: VisibilityCohortParam;
  engine?: string;
  baseline_id?: string;
  selection_mode?: string;
  from?: string;
  to?: string;
  configuration_key?: string;
};

/**
 * The landing selection: the latest run, the core cohort, no baseline and no
 * frozen configuration pinned. Navigation intent warms exactly this, so a
 * hovered link and the screen it opens share ONE cache entry.
 */
export const INITIAL_VISIBILITY_PARAMS: ProjectVisibilityParams = {
  cohort: 'core',
  selection_mode: 'latest',
};

export const visibilityApi = {
  /** Answer perception for the selected runs: net sentiment with its coverage, themes and quotes. */
  getPerception: async (
    projectId: string,
    params: { audit_id?: string; audit_ids?: string[]; engine?: string; cohort?: string },
    options?: ApiRequestOptions,
  ) => {
    const result = await apiClient.get(
      withQuery(`/projects/${projectId}/visibility/perception`, definedQuery(params)),
      options,
    );
    return strictValidate(perceptionResponseSchema, result, 'visibility.getPerception');
  },
  /** Fact-check accuracy for the selected runs: verdicts on the brand's claims with their coverage. */
  getAccuracy: async (
    projectId: string,
    params: { audit_id?: string; audit_ids?: string[]; engine?: string; cohort?: string },
    options?: ApiRequestOptions,
  ) => {
    const result = await apiClient.get(
      withQuery(`/projects/${projectId}/visibility/accuracy`, definedQuery(params)),
      options,
    );
    return strictValidate(accuracyResponseSchema, result, 'visibility.getAccuracy');
  },
  /** Ads in ChatGPT Search answers for the selected runs: presence, advertisers and creatives. */
  getAds: async (
    projectId: string,
    params: {
      audit_id?: string;
      audit_ids?: string[];
      engine?: string;
      cohort?: string;
      cursor?: string;
    },
    options?: ApiRequestOptions,
  ) => {
    const result = await apiClient.get(
      withQuery(`/projects/${projectId}/visibility/ads`, definedQuery(params)),
      options,
    );
    return strictValidate(visibilityAdsResponseSchema, result, 'visibility.getAds');
  },
  getFanoutSummary: async (
    projectId: string,
    params: {
      audit_id?: string;
      audit_ids?: string[];
      engine?: string;
      cohort?: string;
      cursor?: string;
      query?: string;
    },
    options?: ApiRequestOptions,
  ) => {
    const result = await apiClient.get(
      withQuery(`/projects/${projectId}/visibility/fanout`, definedQuery(params)),
      options,
    );
    return strictValidate(visibilityFanoutSummarySchema, result, 'visibility.getFanoutSummary');
  },
  getSources: async (
    projectId: string,
    params: {
      audit_id?: string;
      audit_ids?: string[];
      baseline_audit_ids?: string[];
      engine?: string;
      cohort?: string;
      domain?: string;
      source_type?: string;
      standing?: 'gap';
      dimension?: 'domain' | 'url';
      cursor?: string;
      as_of?: string;
      limit?: number;
    },
    options?: ApiRequestOptions,
  ) => {
    const result = await apiClient.get(
      withQuery(`/projects/${projectId}/visibility/sources`, definedQuery(params)),
      options,
    );
    return strictValidate(visibilitySourcesSchema, result, 'visibility.getSources');
  },
  /**
   * The five AI Overview rates for one selection.
   *
   * `engine` is required: the rates belong to an observed surface, and asking
   * for them without naming one would answer a question nobody asked.
   */
  getSurfaceRates: async (
    projectId: string,
    params: {
      engine: string;
      audit_id?: string;
      audit_ids?: string[];
      cohort?: string;
    },
    options?: ApiRequestOptions,
  ) => {
    const result = await apiClient.get(
      withQuery(`/projects/${projectId}/visibility/surface-rates`, definedQuery(params)),
      options,
    );
    return strictValidate(surfaceRatesSchema, result, 'visibility.getSurfaceRates');
  },
  getSourceSeries: async (
    projectId: string,
    params: {
      dimension?: 'domain' | 'url';
      granularity?: string;
      audit_id?: string;
      audit_ids?: string[];
      engine?: string;
      cohort?: string;
      domain?: string;
      url?: string;
      source_type?: string;
      limit?: number;
    },
    options?: ApiRequestOptions,
  ) => {
    const result = await apiClient.get(
      withQuery(`/projects/${projectId}/visibility/sources/series`, definedQuery(params)),
      options,
    );
    return strictValidate(visibilitySourceSeriesSchema, result, 'visibility.getSourceSeries');
  },
  getSourceNearMisses: async (
    projectId: string,
    params: {
      audit_id?: string;
      audit_ids?: string[];
      engine?: string;
      cohort?: string;
      limit?: number;
    },
    options?: ApiRequestOptions,
  ) => {
    const result = await apiClient.get(
      withQuery(`/projects/${projectId}/visibility/sources/near-misses`, definedQuery(params)),
      options,
    );
    return strictValidate(
      visibilitySourceNearMissesSchema,
      result,
      'visibility.getSourceNearMisses',
    );
  },
  getSourceMovers: async (
    projectId: string,
    params: {
      audit_id?: string;
      audit_ids?: string[];
      baseline_audit_ids?: string[];
      engine?: string;
      cohort?: string;
      dimension?: 'domain' | 'url';
      limit?: number;
    },
    options?: ApiRequestOptions,
  ) => {
    const result = await apiClient.get(
      withQuery(`/projects/${projectId}/visibility/sources/movers`, definedQuery(params)),
      options,
    );
    return strictValidate(visibilitySourceMoversSchema, result, 'visibility.getSourceMovers');
  },
  getSourceUrl: async (
    projectId: string,
    params: {
      url: string;
      audit_id?: string;
      audit_ids?: string[];
      engine?: string;
      cohort?: string;
    },
    options?: ApiRequestOptions,
  ) => {
    const result = await apiClient.get(
      withQuery(`/projects/${projectId}/visibility/sources/url`, definedQuery(params)),
      options,
    );
    return strictValidate(visibilitySourceUrlSchema, result, 'visibility.getSourceUrl');
  },
  /** Each market's latest run side by side (Visibility → By market). */
  getMarketVisibility: async (
    projectId: string,
    params: { cohort?: string },
    options?: ApiRequestOptions,
  ) => {
    const result = await apiClient.get(
      withQuery(`/projects/${projectId}/visibility/markets`, definedQuery(params)),
      options,
    );
    return strictValidate(visibilityMarketsSchema, result, 'visibility.getMarketVisibility');
  },
  getProjectVisibility: async (
    projectId: string,
    params?: ProjectVisibilityParams,
    options?: ApiRequestOptions,
  ) => {
    const path = withQuery(`/projects/${projectId}/visibility`, definedQuery(params));
    const res = await apiClient.get<Visibility>(path, options);
    return strictValidate(visibilitySchema, res, 'visibility.getProjectVisibility');
  },

  /**
   * Cross-run Visibility trend projection for a project (roadmap surface, now
   * live). An ordered series of `VisibilityTrendPoint`s over the project's
   * persisted dashboard-ready `MetricSnapshot` rows — optionally filtered by
   * `engine` and an inclusive UTC `from`/`to` window, and bucketed by
   * `granularity`. Same-origin relative path only; response is strictly
   * validated (backend is the source of truth).
   */
  getVisibilityTrends: async (
    projectId: string,
    params?: VisibilityTrendParams,
    options?: ApiRequestOptions,
  ): Promise<VisibilityTrendPoint[]> => {
    const path = withQuery(`/projects/${projectId}/visibility/trends`, definedQuery(params));
    const res = await apiClient.get<VisibilityTrendPoint[]>(path, options);
    return strictValidate(visibilityTrendListSchema, res, 'visibility.getVisibilityTrends');
  },

  /**
   * Shared persisted execution-evidence dataset for Query fanouts and the
   * Sources drill-downs (`/projects/{id}/visibility/evidence`). Returns a
   * bounded newest-first window of `VisibilityExecutionEvidence` plus a
   * `truncated` flag — no provider is called and no evidence is inferred at read
   * time. Same-origin relative path only; response is strictly validated.
   */
  getVisibilityEvidence: async (
    projectId: string,
    params?: VisibilityEvidenceParams,
    options?: ApiRequestOptions,
  ): Promise<VisibilityEvidenceResponse> => {
    const path = withQuery(`/projects/${projectId}/visibility/evidence`, definedQuery(params));
    const res = await apiClient.get<VisibilityEvidenceResponse>(path, options);
    return strictValidate(
      visibilityEvidenceResponseSchema,
      res,
      'visibility.getVisibilityEvidence',
    );
  },
  getPromptMetrics: async (
    projectId: string,
    auditId?: string,
    options?: ApiRequestOptions,
    filters?: {
      engine?: string;
      cohort?: string;
      baseline_id?: string;
      audit_ids?: string[];
      baseline_audit_ids?: string[];
    },
  ): Promise<PromptMetricItem[]> => {
    const path = withQuery(
      `/projects/${projectId}/visibility/prompts`,
      definedQuery({ audit_id: auditId, ...filters }),
    );
    const res = await apiClient.get<PromptMetricItem[]>(path, options);
    return strictValidate(promptMetricListSchema, res, 'visibility.getPromptMetrics');
  },
  /**
   * One prompt's mention and owned-citation rates per run in a market, the
   * Actions declared on it, and its latest per-engine outcomes.
   */
  getPromptHistory: async (
    projectId: string,
    promptId: string,
    params: { market?: string; engine?: string },
    options?: ApiRequestOptions,
  ): Promise<PromptHistory> => {
    const path = withQuery(
      `/projects/${projectId}/visibility/prompts/${promptId}/history`,
      definedQuery(params),
    );
    const res = await apiClient.get<PromptHistory>(path, options);
    return strictValidate(promptHistorySchema, res, 'visibility.getPromptHistory');
  },
  listCompetitorSuggestions: async (
    projectId: string,
    options?: ApiRequestOptions,
  ): Promise<ObservedCompetitor[]> => {
    const res = await apiClient.get<ObservedCompetitor[]>(
      `/projects/${projectId}/competitor-suggestions`,
      options,
    );
    return strictValidate(
      observedCompetitorListSchema,
      res,
      'visibility.listCompetitorSuggestions',
    );
  },
  acceptCompetitorSuggestion: async (
    projectId: string,
    candidateId: string,
    options?: ApiRequestOptions,
  ): Promise<Competitor> => {
    const res = await apiClient.post<Competitor>(
      `/projects/${projectId}/competitor-suggestions/${candidateId}/accept`,
      undefined,
      options,
    );
    return strictValidate(competitorSchema, res, 'visibility.acceptCompetitorSuggestion');
  },
};

/**
 * Project projection read options, so the screen and navigation intent request
 * the SAME key from one definition instead of each assembling its own.
 */
export const visibilityQueries = {
  project: (workspaceId: string, projectId: string, params: ProjectVisibilityParams) =>
    queryOptions({
      queryKey: queryKeys.visibility.project(projectId, params.audit_id, params),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        visibilityApi.getProjectVisibility(projectId, params, { signal, workspaceId }),
    }),
};
