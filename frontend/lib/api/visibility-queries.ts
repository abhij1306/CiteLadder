/**
 * Visibility query and mutation descriptors, so a screen, an Overview widget
 * and navigation intent request the SAME key from one definition instead of
 * each assembling its own, and a write refreshes every read it changes.
 */
import {
  infiniteQueryOptions,
  mutationOptions,
  queryOptions,
  type QueryClient,
} from '@tanstack/react-query';

import { ApiError } from './errors';
import { queryKeys } from './query-keys';
import type { ProjectScope } from './query-keys/scope';
import type { Visibility } from '@citeladder/contracts';
import { visibilityApi, type ProjectVisibilityParams } from './visibility';

type Api = typeof visibilityApi;
type ParamsOf<Read extends keyof Api> = Parameters<Api[Read]>[1];

const hasCode = (error: unknown, code: string) => error instanceof ApiError && error.code === code;

/**
 * The selection's run exists but its metrics are not written yet: its own
 * state ("still being prepared"), never "nothing measured" and never a failure.
 */
export const isMetricsPending = (error: unknown) => hasCode(error, 'visibility_metrics_pending');

const scoped = (scope: ProjectScope, signal?: AbortSignal) => ({
  signal,
  workspaceId: scope.workspaceId,
});

export const visibilityQueries = {
  /**
   * The selection's projection, or `null` when the server answers
   * `visibility_not_measured` (no completed measured run, or a period that
   * measured nothing). Cached as an error it was always stale, so every mount
   * re-asked for the same answer; a run arriving or finishing invalidates
   * `visibility.all` instead. Metrics still being written
   * (`visibility_metrics_pending`, see `isMetricsPending`), a run that does not
   * exist and every other failure stay errors.
   */
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
  accuracy: (scope: ProjectScope, params: ParamsOf<'getAccuracy'>) =>
    queryOptions({
      queryKey: queryKeys.visibility.accuracy(scope, params),
      queryFn: ({ signal }) =>
        visibilityApi.getAccuracy(scope.projectId, params, scoped(scope, signal)),
    }),
  /** Ad creatives, paged by the read's own cursor. */
  ads: (scope: ProjectScope, params: Omit<ParamsOf<'getAds'>, 'cursor'>) =>
    infiniteQueryOptions({
      queryKey: queryKeys.visibility.ads(scope, params),
      queryFn: ({ signal, pageParam }) =>
        visibilityApi.getAds(
          scope.projectId,
          { ...params, cursor: pageParam },
          scoped(scope, signal),
        ),
      initialPageParam: undefined as string | undefined,
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
  /** One run's prompt rows; `null` reads the latest default-market run (Prompts table, Overview). */
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

/** Visibility writes; each success refreshes every read it changes. */
export const visibilityMutations = {
  /**
   * Accepting an observed competitor adds it to the project (its competitor
   * list), drops it from the suggestions, and re-scores every Visibility read
   * that names competitors.
   */
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
};

/**
 * A run arrived or finished for the project: every Visibility read re-derives
 * from the new set of measured runs.
 */
export const refreshVisibility = (client: QueryClient, projectId: string) =>
  client.invalidateQueries({ queryKey: queryKeys.visibility.project(projectId) });
