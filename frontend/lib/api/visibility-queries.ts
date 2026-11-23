import {
  infiniteQueryOptions,
  mutationOptions,
  queryOptions,
  type QueryClient,
} from '@tanstack/react-query';

import { ApiError } from './errors';
import { FIRST_CURSOR } from './query-client';
import { queryKeys } from './query-keys';
import type { ProjectScope } from './query-keys/scope';
import type { Visibility } from '@citeladder/contracts';
import type { VerdictOverrideRequest } from '@citeladder/contracts/project-requests';
import { visibilityApi, type ProjectVisibilityParams } from './visibility';

type Api = typeof visibilityApi;
type ParamsOf<Read extends keyof Api> = Parameters<Api[Read]>[1];

const hasCode = (error: unknown, code: string) => error instanceof ApiError && error.code === code;

export const isMetricsPending = (error: unknown) => hasCode(error, 'visibility_metrics_pending');

const scoped = (scope: ProjectScope, signal?: AbortSignal) => ({
  signal,
  workspaceId: scope.workspaceId,
});

export const visibilityQueries = {
  project: (scope: ProjectScope, params: ProjectVisibilityParams) =>
    queryOptions({
      queryKey: queryKeys.visibility.selection(scope, params),
      queryFn: async ({ signal }): Promise<Visibility | null> => {
        try {
          return await visibilityApi.getProjectVisibility(
            scope.projectId,
            params,
            scoped(scope, signal),
          );
        } catch (error) {
          if (hasCode(error, 'visibility_not_measured')) return null;
          throw error;
        }
      },
    }),
  trends: (scope: ProjectScope, params: ParamsOf<'getVisibilityTrends'>) =>
    queryOptions({
      queryKey: queryKeys.visibility.trends(scope, params),
      queryFn: ({ signal }) =>
        visibilityApi.getVisibilityTrends(scope.projectId, params, scoped(scope, signal)),
    }),
  topics: (scope: ProjectScope, params: ParamsOf<'getVisibilityTopics'>) =>
    queryOptions({
      queryKey: queryKeys.visibility.topics(scope, params),
      queryFn: ({ signal }) =>
        visibilityApi.getVisibilityTopics(scope.projectId, params, scoped(scope, signal)),
    }),
  matrix: (scope: ProjectScope, params: ParamsOf<'getVisibilityMatrix'>) =>
    queryOptions({
      queryKey: queryKeys.visibility.matrix(scope, params),
      queryFn: ({ signal }) =>
        visibilityApi.getVisibilityMatrix(scope.projectId, params, scoped(scope, signal)),
    }),
  sources: (scope: ProjectScope, params: ParamsOf<'getSources'>) =>
    queryOptions({
      queryKey: queryKeys.visibility.sources(scope, params),
      queryFn: ({ signal }) =>
        visibilityApi.getSources(scope.projectId, params, scoped(scope, signal)),
    }),
  sourceSeries: (scope: ProjectScope, params: ParamsOf<'getSourceSeries'>) =>
    queryOptions({
      queryKey: queryKeys.visibility.sourceSeries(scope, params),
      queryFn: ({ signal }) =>
        visibilityApi.getSourceSeries(scope.projectId, params, scoped(scope, signal)),
    }),
  sourceUrl: (scope: ProjectScope, params: ParamsOf<'getSourceUrl'>) =>
    queryOptions({
      queryKey: queryKeys.visibility.sourceUrl(scope, params),
      queryFn: ({ signal }) =>
        visibilityApi.getSourceUrl(scope.projectId, params, scoped(scope, signal)),
    }),
  sourceNearMisses: (scope: ProjectScope, params: ParamsOf<'getSourceNearMisses'>) =>
    queryOptions({
      queryKey: queryKeys.visibility.sourceNearMisses(scope, params),
      queryFn: ({ signal }) =>
        visibilityApi.getSourceNearMisses(scope.projectId, params, scoped(scope, signal)),
    }),
  sourceMovers: (scope: ProjectScope, params: ParamsOf<'getSourceMovers'>) =>
    queryOptions({
      queryKey: queryKeys.visibility.sourceMovers(scope, params),
      queryFn: ({ signal }) =>
        visibilityApi.getSourceMovers(scope.projectId, params, scoped(scope, signal)),
    }),
  fanout: (scope: ProjectScope, params: ParamsOf<'getFanoutSummary'>) =>
    queryOptions({
      queryKey: queryKeys.visibility.fanout(scope, params),
      queryFn: ({ signal }) =>
        visibilityApi.getFanoutSummary(scope.projectId, params, scoped(scope, signal)),
    }),
  perception: (scope: ProjectScope, params: ParamsOf<'getPerception'>) =>
    queryOptions({
      queryKey: queryKeys.visibility.perception(scope, params),
      queryFn: ({ signal }) =>
        visibilityApi.getPerception(scope.projectId, params, scoped(scope, signal)),
    }),
  competitor: (scope: ProjectScope, params: ParamsOf<'getCompetitorFocus'>) =>
    queryOptions({
      queryKey: queryKeys.visibility.competitor(scope, params.name, params),
      queryFn: ({ signal }) =>
        visibilityApi.getCompetitorFocus(scope.projectId, params, scoped(scope, signal)),
    }),
  accuracy: (scope: ProjectScope, params: ParamsOf<'getAccuracy'>) =>
    queryOptions({
      queryKey: queryKeys.visibility.accuracy(scope, params),
      queryFn: ({ signal }) =>
        visibilityApi.getAccuracy(scope.projectId, params, scoped(scope, signal)),
    }),
  accuracyFacts: (scope: ProjectScope, params: ParamsOf<'getAccuracyFacts'>) =>
    queryOptions({
      queryKey: queryKeys.visibility.accuracyFacts(scope, params),
      queryFn: ({ signal }) =>
        visibilityApi.getAccuracyFacts(scope.projectId, params, scoped(scope, signal)),
    }),
  accuracyClaims: (scope: ProjectScope, params: Omit<ParamsOf<'getAccuracyClaims'>, 'cursor'>) =>
    infiniteQueryOptions({
      queryKey: queryKeys.visibility.accuracyClaims(scope, params),
      queryFn: ({ signal, pageParam }) =>
        visibilityApi.getAccuracyClaims(
          scope.projectId,
          { ...params, cursor: pageParam },
          scoped(scope, signal),
        ),
      initialPageParam: FIRST_CURSOR,
      getNextPageParam: (last) => last.next_cursor ?? undefined,
    }),
  ads: (scope: ProjectScope, params: Omit<ParamsOf<'getAds'>, 'cursor'>) =>
    infiniteQueryOptions({
      queryKey: queryKeys.visibility.ads(scope, params),
      queryFn: ({ signal, pageParam }) =>
        visibilityApi.getAds(
          scope.projectId,
          { ...params, cursor: pageParam },
          scoped(scope, signal),
        ),
      initialPageParam: FIRST_CURSOR,
      getNextPageParam: (last) => last.creatives.next_cursor ?? undefined,
    }),
  evidence: (scope: ProjectScope, params: ParamsOf<'getVisibilityEvidence'>) =>
    queryOptions({
      queryKey: queryKeys.visibility.evidence(scope, params),
      queryFn: ({ signal }) =>
        visibilityApi.getVisibilityEvidence(scope.projectId, params, scoped(scope, signal)),
    }),
  surfaceRates: (scope: ProjectScope, params: ParamsOf<'getSurfaceRates'>) =>
    queryOptions({
      queryKey: queryKeys.visibility.surfaceRates(scope, params),
      queryFn: ({ signal }) =>
        visibilityApi.getSurfaceRates(scope.projectId, params, scoped(scope, signal)),
    }),
  markets: (scope: ProjectScope, params: ParamsOf<'getMarketVisibility'>) =>
    queryOptions({
      queryKey: queryKeys.visibility.markets(scope, params),
      queryFn: ({ signal }) =>
        visibilityApi.getMarketVisibility(scope.projectId, params, scoped(scope, signal)),
    }),
  prompts: (scope: ProjectScope, auditId: string | null = null) =>
    queryOptions({
      queryKey: queryKeys.visibility.prompts(scope, auditId),
      queryFn: ({ signal }) =>
        visibilityApi.getPromptMetrics(
          scope.projectId,
          auditId ?? undefined,
          scoped(scope, signal),
        ),
    }),
  latestPerPrompt: (scope: ProjectScope) =>
    queryOptions({
      queryKey: queryKeys.visibility.latestPerPrompt(scope),
      queryFn: ({ signal }) =>
        visibilityApi.getPromptMetrics(scope.projectId, undefined, scoped(scope, signal), {
          latest: 'prompt',
        }),
    }),
  promptHistory: (
    scope: ProjectScope,
    promptId: string,
    params: Parameters<Api['getPromptHistory']>[2],
  ) =>
    queryOptions({
      queryKey: queryKeys.visibility.promptHistory(scope, promptId, params),
      queryFn: ({ signal }) =>
        visibilityApi.getPromptHistory(scope.projectId, promptId, params, scoped(scope, signal)),
    }),
  competitorSuggestions: (scope: ProjectScope) =>
    queryOptions({
      queryKey: queryKeys.visibility.competitorSuggestions(scope),
      queryFn: ({ signal }) =>
        visibilityApi.listCompetitorSuggestions(scope.projectId, scoped(scope, signal)),
    }),
};

export const visibilityMutations = {
  acceptCompetitorSuggestion: (scope: ProjectScope) =>
    mutationOptions({
      mutationFn: (candidateId: string) =>
        visibilityApi.acceptCompetitorSuggestion(scope.projectId, candidateId, scoped(scope)),
      onSuccess: (_competitor, _candidateId, _result, { client }) =>
        Promise.all([
          client.invalidateQueries({ queryKey: queryKeys.visibility.project(scope.projectId) }),
          client.invalidateQueries({ queryKey: queryKeys.projects.all }),
        ]),
    }),
  rejectCompetitorSuggestion: (scope: ProjectScope) =>
    mutationOptions({
      mutationFn: (candidateId: string) =>
        visibilityApi.rejectCompetitorSuggestion(scope.projectId, candidateId, scoped(scope)),
      onSuccess: (_suggestion, _candidateId, _result, { client }) =>
        client.invalidateQueries({
          queryKey: queryKeys.visibility.resource(scope.projectId, 'competitor-suggestions'),
        }),
    }),
  overrideVerdict: (scope: ProjectScope) =>
    mutationOptions({
      mutationFn: ({ verdictId, input }: { verdictId: string; input: VerdictOverrideRequest }) =>
        visibilityApi.overrideVerdict(scope.projectId, verdictId, input, scoped(scope)),
      onSuccess: (_override, _input, _result, { client }) =>
        refreshVisibility(client, scope.projectId),
    }),
};

export const refreshVisibility = (client: QueryClient, projectId: string) =>
  client.invalidateQueries({ queryKey: queryKeys.visibility.project(projectId) });
