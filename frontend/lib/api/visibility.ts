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
import { competitorFocusSchema } from '@citeladder/contracts/visibility-competitor';
import {
  accuracyClaimPageSchema,
  accuracyFactListSchema,
  accuracyResponseSchema,
  verdictOverrideSchema,
} from '@citeladder/contracts/fact-checking';
import type { VerdictOverrideRequest } from '@citeladder/contracts/project-requests';
import { visibilityAdsResponseSchema } from '@citeladder/contracts/visibility-ads';
import { visibilityTrendListSchema } from '@citeladder/contracts/visibility-trends';
import { visibilityMatrixSchema } from '@citeladder/contracts/visibility-matrix';
import { visibilityTopicsSchema } from '@citeladder/contracts/visibility-topics';
import { definedQuery, withQuery } from './shared';
import type {
  ObservedCompetitor,
  Competitor,
  PromptHistory,
  PromptMetricItem,
  Visibility,
  VisibilityEvidenceResponse,
  VisibilityTrendPoint,
} from '@citeladder/contracts';

const promptMetricListSchema = z.array(promptMetricItemSchema);
const observedCompetitorListSchema = z.array(observedCompetitorSchema);

export type VisibilityCohortParam = 'core' | 'comparison' | 'all';

type VisibilityTrendParams = {
  market?: string;
  cohort?: VisibilityCohortParam;
  engine?: string;
  topic?: string;
  from?: string;
  to?: string;
  granularity?: string;
};

type VisibilityEvidenceParams = {
  audit_ids?: string[];
  cursor?: string;
  as_of?: string;
  outcome?: string;
  competitor?: string;
  domain?: string;
  url?: string;
  cohort?: VisibilityCohortParam;
  audit_id?: string;
  prompt_id?: string;
  engine?: string;
  topic?: string;
  from?: string;
  to?: string;
  limit?: number;
};

export type ProjectVisibilityParams = {
  audit_id?: string;
  market?: string;
  cohort?: VisibilityCohortParam;
  engine?: string;
  topic?: string;
  baseline_id?: string;
  selection_mode?: string;
  from?: string;
  to?: string;
  configuration_key?: string;
};

export const INITIAL_VISIBILITY_PARAMS: ProjectVisibilityParams = {
  cohort: 'core',
  selection_mode: 'latest',
};

export const visibilityApi = {
  getPerception: async (
    projectId: string,
    params: {
      audit_id?: string;
      market?: string;
      engine?: string;
      cohort?: string;
      from?: string;
      to?: string;
    },
    options?: ApiRequestOptions,
  ) => {
    const result = await apiClient.get(
      withQuery(`/projects/${projectId}/visibility/perception`, definedQuery(params)),
      options,
    );
    return strictValidate(perceptionResponseSchema, result, 'visibility.getPerception');
  },
  getCompetitorFocus: async (
    projectId: string,
    params: {
      name: string;
      audit_id?: string;
      audit_ids?: string[];
      engine?: string;
      topic?: string;
      cohort?: string;
    },
    options?: ApiRequestOptions,
  ) => {
    const { name, ...selection } = params;
    const result = await apiClient.get(
      withQuery(
        `/projects/${projectId}/visibility/competitors/${encodeURIComponent(name)}`,
        definedQuery(selection),
      ),
      options,
    );
    return strictValidate(competitorFocusSchema, result, 'visibility.getCompetitorFocus');
  },
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
  getAccuracyFacts: async (
    projectId: string,
    params: { audit_id?: string; audit_ids?: string[]; engine?: string; cohort?: string },
    options?: ApiRequestOptions,
  ) => {
    const result = await apiClient.get(
      withQuery(`/projects/${projectId}/visibility/accuracy/facts`, definedQuery(params)),
      options,
    );
    return strictValidate(accuracyFactListSchema, result, 'visibility.getAccuracyFacts');
  },
  getAccuracyClaims: async (
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
      withQuery(`/projects/${projectId}/visibility/accuracy/claims`, definedQuery(params)),
      options,
    );
    return strictValidate(accuracyClaimPageSchema, result, 'visibility.getAccuracyClaims');
  },
  overrideVerdict: async (
    projectId: string,
    verdictId: string,
    input: VerdictOverrideRequest,
    options?: ApiRequestOptions,
  ) => {
    const result = await apiClient.post(
      `/projects/${projectId}/claim-verdicts/${verdictId}/overrides`,
      input,
      options,
    );
    return strictValidate(verdictOverrideSchema, result, 'visibility.overrideVerdict');
  },
  exportAccuracyClaims: (
    projectId: string,
    params: { audit_id?: string; audit_ids?: string[]; engine?: string; cohort?: string },
    options?: ApiRequestOptions,
  ) =>
    apiClient.getBlob(
      withQuery(`/projects/${projectId}/visibility/accuracy/claims/export`, definedQuery(params)),
      options,
    ),
  getAds: async (
    projectId: string,
    params: {
      audit_id?: string;
      audit_ids?: string[];
      engine?: string;
      topic?: string;
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
      topic?: string;
      cohort?: string;
      prompt_id?: string;
      outcome?: string;
      competitor?: string;
      domain?: string;
      url?: string;
      search?: string;
      order?: 'top' | 'rising' | 'falling';
      limit?: number;
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
      topic?: string;
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
      topic?: string;
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
      topic?: string;
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
      topic?: string;
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
      topic?: string;
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
  getMarketVisibility: async (
    projectId: string,
    params: { cohort?: string; topic?: string },
    options?: ApiRequestOptions,
  ) => {
    const result = await apiClient.get(
      withQuery(`/projects/${projectId}/visibility/markets`, definedQuery(params)),
      options,
    );
    return strictValidate(visibilityMarketsSchema, result, 'visibility.getMarketVisibility');
  },
  getVisibilityTopics: async (
    projectId: string,
    params: Omit<ProjectVisibilityParams, 'baseline_id' | 'topic'>,
    options?: ApiRequestOptions,
  ) => {
    const path = withQuery(`/projects/${projectId}/visibility/topics`, definedQuery(params));
    const res = await apiClient.get(path, options);
    return strictValidate(visibilityTopicsSchema, res, 'visibility.getVisibilityTopics');
  },
  getVisibilityMatrix: async (
    projectId: string,
    params: Omit<ProjectVisibilityParams, 'baseline_id'>,
    options?: ApiRequestOptions,
  ) => {
    const path = withQuery(`/projects/${projectId}/visibility/matrix`, definedQuery(params));
    const res = await apiClient.get(path, options);
    return strictValidate(visibilityMatrixSchema, res, 'visibility.getVisibilityMatrix');
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

  getVisibilityTrends: async (
    projectId: string,
    params?: VisibilityTrendParams,
    options?: ApiRequestOptions,
  ): Promise<VisibilityTrendPoint[]> => {
    const path = withQuery(`/projects/${projectId}/visibility/trends`, definedQuery(params));
    const res = await apiClient.get<VisibilityTrendPoint[]>(path, options);
    return strictValidate(visibilityTrendListSchema, res, 'visibility.getVisibilityTrends');
  },

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
      latest?: 'run' | 'prompt';
    },
  ): Promise<PromptMetricItem[]> => {
    const path = withQuery(
      `/projects/${projectId}/visibility/prompts`,
      definedQuery({ audit_id: auditId, ...filters }),
    );
    const res = await apiClient.get<PromptMetricItem[]>(path, options);
    return strictValidate(promptMetricListSchema, res, 'visibility.getPromptMetrics');
  },
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
  rejectCompetitorSuggestion: async (
    projectId: string,
    candidateId: string,
    options?: ApiRequestOptions,
  ): Promise<ObservedCompetitor> => {
    const res = await apiClient.post<ObservedCompetitor>(
      `/projects/${projectId}/competitor-suggestions/${candidateId}/reject`,
      undefined,
      options,
    );
    return strictValidate(observedCompetitorSchema, res, 'visibility.rejectCompetitorSuggestion');
  },
};
