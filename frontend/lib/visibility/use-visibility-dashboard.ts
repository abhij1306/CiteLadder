'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/api/query-keys';
import { retainPreviousDataForScope, warmQuery } from '@/lib/api/query-client';
import { useActiveProject, useActiveWorkspaceId } from '@/lib/project/project-context';
import {
  cohortUrlCodec,
  writeStoredCohort,
  type PromptCohort,
} from '@/lib/visibility/prompt-cohort';
import { useDisplayTimeZone } from '@/lib/display-timezone';
import { resolveProjectRequestScope, type ProjectRequestScope } from '@/lib/project/request-scope';
import { runsQueries } from '@/lib/api/runs';
import { useMarketVisibility } from '@/lib/visibility/use-market-visibility';
import { useSurfaceRates } from '@/lib/visibility/use-surface-rates';
import { visibilityApi, visibilityQueries } from '@/lib/api/visibility';
import {
  findActiveRun,
  isEvidenceTab,
  VISIBILITY_TABS,
  toRunOptions,
  type VisibilityTab,
} from '@/lib/visibility/dashboard';
import { shouldPollAudit } from '@/lib/runs/status';
import { ACTIVE_RUN_POLL_MS, EVIDENCE_LIMIT } from '@/lib/config/operational';
import {
  optionalStringUrlCodec,
  setUrlParams,
  stringUrlCodec,
  useUrlState,
} from '@/lib/navigation/url-state';
import {
  rangeToFrom,
  TREND_ENGINES,
  type TrendGranularity,
  type TrendRange,
} from '@/lib/visibility/trends';

export { EVIDENCE_LIMIT } from '@/lib/config/operational';

const pageKeys = [
  'cursor',
  'as_of',
  'source_offset',
  'source_cursor',
  'source_as_of',
  'query_offset',
  'prompt_page',
];
const tabCodec = stringUrlCodec(
  VISIBILITY_TABS.map(({ id }) => id),
  'trends' as VisibilityTab,
);
const engineCodec = stringUrlCodec(['all', ...TREND_ENGINES], 'all');
const rangeCodec = stringUrlCodec<TrendRange>(['all', '30d', '90d', '1y'], '90d');
const granularityCodec = stringUrlCodec<TrendGranularity>(['run', 'day', 'week', 'month'], 'run');

/**
 * Writes the URL directly rather than closing over hook state, so its identity
 * is stable across renders and memoized filter controls do not re-render.
 */
function setRange(value: TrendRange) {
  setUrlParams({
    range: value,
    from: rangeToFrom(value) ?? null,
    // No upper bound: a preset means "up to now", and pinning `to` to the
    // moment the reader picked it froze the window there, so every run that
    // completed afterwards stayed out of the series until they picked the
    // same range again.
    to: null,
    configuration: null,
    ...Object.fromEntries(pageKeys.map((key) => [key, null])),
  });
}

export function useVisibilityFilters() {
  const [activeTab, selectTab] = useUrlState('tab', tabCodec);
  const [selectedRunId, setSelectedRunId] = useUrlState('run', optionalStringUrlCodec, {
    clearKeys: pageKeys,
  });
  const [engine, setEngine] = useUrlState('engine', engineCodec, {
    clearKeys: pageKeys,
  });
  const [promptId, setPromptId] = useUrlState('prompt', optionalStringUrlCodec, {
    clearKeys: pageKeys,
  });
  const [range] = useUrlState('range', rangeCodec);
  const [fromAt] = useUrlState('from', optionalStringUrlCodec);
  const [toAt] = useUrlState('to', optionalStringUrlCodec);
  const [selectionMode, setSelectionMode] = useUrlState(
    'selection',
    stringUrlCodec(['run', 'range'] as const, 'run'),
    { clearKeys: [...pageKeys, 'run', 'configuration'] },
  );
  const [configuration, setConfiguration] = useUrlState('configuration', optionalStringUrlCodec, {
    clearKeys: pageKeys,
  });
  const [granularity, setGranularity] = useUrlState('granularity', granularityCodec);
  // Without `cohort` in the URL the project's remembered choice applies.
  const projectId = useActiveProject()?.id ?? null;
  const cohortCodec = useMemo(() => cohortUrlCodec(projectId), [projectId]);
  const [cohort, setCohortUrl] = useUrlState('cohort', cohortCodec, {
    clearKeys: pageKeys,
  });
  const setCohort = useCallback(
    (next: PromptCohort) => {
      writeStoredCohort(projectId, next);
      setCohortUrl(next);
    },
    [projectId, setCohortUrl],
  );
  const [baselineId, setBaselineId] = useUrlState('baseline', optionalStringUrlCodec);
  // A non-default market's id; absent is the project default. Runs, baselines
  // and pooled configurations belong to one market, so a switch drops them.
  const [market, setMarket] = useUrlState('market', optionalStringUrlCodec, {
    clearKeys: [...pageKeys, 'run', 'baseline', 'configuration'],
  });
  const [outcome, setOutcome] = useUrlState('outcome', optionalStringUrlCodec, {
    clearKeys: pageKeys,
  });
  const [competitor] = useUrlState('competitor', optionalStringUrlCodec);
  const [domain] = useUrlState('domain', optionalStringUrlCodec);
  const [url] = useUrlState('url', optionalStringUrlCodec);
  const isFiltered =
    engine !== 'all' ||
    promptId !== null ||
    cohort !== 'core' ||
    outcome !== null ||
    competitor !== null ||
    domain !== null ||
    url !== null;
  return {
    activeTab,
    selectTab,
    selectedRunId,
    setSelectedRunId,
    engine,
    setEngine,
    promptId,
    setPromptId,
    range,
    setRange,
    granularity,
    setGranularity,
    cohort,
    setCohort,
    baselineId,
    setBaselineId,
    market,
    setMarket,
    outcome,
    setOutcome,
    competitor,
    domain,
    url,
    selectionMode,
    setSelectionMode,
    // One write, so selecting a run from range mode cannot leave
    // `selection=range` behind on a stale URL and ignore the run.
    selectMeasurement: (runId: string | null) =>
      setUrlParams({
        selection: 'run',
        run: runId,
        configuration: null,
        ...Object.fromEntries(pageKeys.map((key) => [key, null])),
      }),
    configuration,
    setConfiguration,
    fromAt,
    toAt,
    isFiltered,
    isTrendFiltered: engine !== 'all' || range !== 'all' || cohort !== 'core',
    clearEvidenceFilters: () =>
      setUrlParams({
        engine: null,
        prompt: null,
        outcome: null,
        competitor: null,
        domain: null,
        url: null,
        cursor: null,
        as_of: null,
      }),
    // The answers themselves live on Query fanouts now: it is the tab that
    // renders execution evidence, and sending a reader to Sources would hand
    // them an inventory when they asked to see what was said.
    openEvidence: (slice: Record<string, string | null>) =>
      setUrlParams({
        tab: 'query-fanout',
        cursor: null,
        as_of: null,
        outcome: null,
        competitor: null,
        prompt: null,
        domain: null,
        url: null,
        ...slice,
      }),
  };
}

/**
 * Which runs the projection actually resolved to.
 *
 * A range answers with the set it pooled; a single run answers with itself and
 * no set at all. The difference decides how every dependent read is scoped, so
 * it is read off the response once rather than re-derived at each call site.
 */
function resolvedSelection(
  data:
    | {
        audit_id?: string | null;
        selection_mode?: string;
        source_audit_ids?: string[];
      }
    | undefined,
) {
  return {
    activeRunId: data?.audit_id ?? null,
    selectedRunIds: data?.selection_mode === 'range' ? data.source_audit_ids : undefined,
  };
}

export function useVisibilityQueries(
  projectId: string | null,
  filters: ReturnType<typeof useVisibilityFilters>,
) {
  const workspaceId = useActiveWorkspaceId();
  const requestScope = resolveProjectRequestScope(workspaceId, projectId);
  const { queryClient, auditsQuery, runOptions, hasRuns, activeRun } = useVisibilityRuns(
    requestScope,
    filters.market,
  );
  const { markets, marketRowsQuery } = useMarketVisibility(
    requestScope,
    filters.cohort,
    filters.activeTab === 'trends',
  );

  const engine = filters.engine === 'all' ? undefined : filters.engine;
  const from = useMemo(
    () => filters.fromAt ?? rangeToFrom(filters.range),
    [filters.fromAt, filters.range],
  );
  const selectedParams = selectionParams(filters, from, engine);
  const projectionOptions = visibilityQueries.project(
    requestScope.workspaceId,
    requestScope.projectId,
    selectedParams,
  );
  // Every tab resolves the same concrete run before dependent requests.
  const visibilityQuery = useQuery({
    ...projectionOptions,
    enabled: requestScope.enabled,
    placeholderData: (data, query) => retainPreviousDataForScope(projectId!, data, query),
  });
  const { activeRunId, selectedRunIds } = resolvedSelection(visibilityQuery.data);
  const trendParams = {
    market: filters.market ?? undefined,
    engine,
    from,
    to: filters.toAt ?? undefined,
    granularity: filters.granularity,
    cohort: filters.cohort,
  };
  const trendOptions = {
    queryKey: queryKeys.visibility.trends(projectId ?? '', trendParams),
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      visibilityApi.getVisibilityTrends(requestScope.projectId, trendParams, {
        signal,
        workspaceId: requestScope.workspaceId,
      }),
  };
  const trendQuery = useQuery({
    ...trendOptions,
    enabled: requestScope.enabled && filters.activeTab === 'trends',
    placeholderData: (data, query) => retainPreviousDataForScope(projectId!, data, query),
  });
  const { surfaceEngine, surfaceRatesQuery } = useSurfaceRates({
    requestScope,
    projectId,
    engine,
    cohort: filters.cohort,
    onTrendsTab: filters.activeTab === 'trends',
    activeRunId,
    selectedRunIds,
  });
  // A range that resolved to NO runs sends neither `audit_id` nor a usable
  // `audit_ids`, so the request would read the project unscoped and answer a
  // question nobody asked. An empty selection has empty evidence.
  const hasEvidenceScope =
    requestScope.enabled && Boolean(activeRunId) && selectedRunIds?.length !== 0;
  const evidenceParams = evidenceSelectionParams(filters, activeRunId, selectedRunIds, engine);
  const evidenceOptions = {
    queryKey: queryKeys.visibility.evidence(projectId ?? '', evidenceParams),
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      visibilityApi.getVisibilityEvidence(requestScope.projectId, evidenceParams, {
        signal,
        workspaceId: requestScope.workspaceId,
      }),
  };
  const evidenceQuery = useQuery({
    ...evidenceOptions,
    // Every filter and every page is a new key, so without this the populated
    // card was torn down and replaced by a skeleton for each round trip —
    // reading page one and asking for page two blanked what you were reading.
    // Scoped to the project, so a switch still returns to an explicit load
    // rather than relabelling the previous workspace's evidence.
    placeholderData: (data, query) => retainPreviousDataForScope(projectId!, data, query),
    enabled: hasEvidenceScope && isEvidenceTab(filters.activeTab),
  });
  const prefetchTab = (tab: VisibilityTab) => {
    if (!requestScope.enabled) return;
    if (tab === 'trends') {
      warmQuery(queryClient, projectionOptions);
      warmQuery(queryClient, trendOptions);
      return;
    }
    // Competitor analysis reads the project's page inventory, not this run's
    // evidence. Warming the evidence request for it would spend a round trip
    // on a dataset that tab never shows.
    if (isEvidenceTab(tab) && hasEvidenceScope) {
      warmQuery(queryClient, evidenceOptions);
    }
  };
  return {
    auditsQuery,
    runOptions,
    activeRun,
    activeRunId,
    hasRuns,
    markets,
    marketRowsQuery,
    projectId,
    workspaceId,
    selectedRunIds,
    visibilityQuery,
    trendQuery,
    evidenceQuery,
    surfaceRatesQuery,
    // Null unless the surface filter names an observed surface, which is what
    // decides whether the rates panel belongs on the page at all.
    surfaceEngine,
    // The run/engine/cohort scope the evidence was read under. The fanout tab
    // re-uses it to ask the server for SELECTION-wide totals, so its headline
    // figures describe the same population the table is drawn from.
    evidenceScope: {
      audit_id: evidenceParams.audit_id,
      audit_ids: evidenceParams.audit_ids,
      engine: evidenceParams.engine,
      cohort: evidenceParams.cohort,
    },
    evidenceScopeNarrowed: isEvidenceScopeNarrowed(evidenceParams),
    hasEvidenceScope,
    promptOptions: evidenceQuery.data?.prompt_options ?? [],
    prefetchTab,
  };
}

function useVisibilityRuns(requestScope: ProjectRequestScope, market: string | null) {
  const { workspaceId, projectId } = requestScope;
  const timeZone = useDisplayTimeZone();
  const queryClient = useQueryClient();
  const auditsQuery = useQuery({
    ...runsQueries.list(workspaceId, projectId),
    enabled: requestScope.enabled,
    refetchInterval: (query) =>
      query.state.data?.some((audit) => shouldPollAudit(audit.status)) ? ACTIVE_RUN_POLL_MS : false,
  });
  // The run picker offers the selected market's runs only; markets never pool.
  const runOptions = useMemo(
    () =>
      toRunOptions(
        (auditsQuery.data ?? []).filter((audit) => audit.market.id === market),
        timeZone,
      ),
    [auditsQuery.data, market, timeZone],
  );
  const allRuns = useMemo(
    () => toRunOptions(auditsQuery.data ?? [], timeZone),
    [auditsQuery.data, timeZone],
  );
  const hasRuns = allRuns.length > 0;
  const activeRun = useMemo(() => findActiveRun(auditsQuery.data ?? []), [auditsQuery.data]);
  // Both halves matter. Keying on the latest run alone missed a project's FIRST
  // run — it stayed one id from queued to completed, so nothing invalidated and
  // the 404 the projection answered with while the snapshot was still being
  // written stayed on screen until a manual reload. Keying on the active run
  // alone would miss a later run arriving. The pair moves in either case.
  // The ACTIVE run's id, not merely whether one exists: one run finishing as
  // the next begins keeps 'active' true, and a signal that cannot see the
  // swap leaves the finished run's results uninvalidated.
  const runSignal = `${allRuns[0]?.id ?? ''}:${activeRun?.id ?? 'idle'}`;
  const previousSignal = useRef<string | undefined>(undefined);
  const auditsLoaded = auditsQuery.isSuccess;
  useEffect(() => {
    if (!auditsLoaded) return;
    const previous = previousSignal.current;
    previousSignal.current = runSignal;
    // `undefined` is the first resolved list, not a transition to react to.
    if (previous !== undefined && previous !== runSignal) {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.visibility.all,
      });
    }
  }, [auditsLoaded, runSignal, queryClient]);

  return { queryClient, auditsQuery, runOptions, hasRuns, activeRun };
}

/**
 * Three selection modes, and the run id only distinguishes two of them.
 *
 * `range` pools every run in the period; without one, an explicit run id means
 * that run and its absence means whatever is latest.
 */
function selectionModeParam(
  filters: ReturnType<typeof useVisibilityFilters>,
): 'range' | 'run' | 'latest' {
  if (filters.selectionMode === 'range') return 'range';
  return filters.selectedRunId ? 'run' : 'latest';
}

function selectionParams(
  filters: ReturnType<typeof useVisibilityFilters>,
  from: string | undefined,
  engine: string | undefined,
) {
  return {
    audit_id: filters.selectedRunId ?? undefined,
    market: filters.market ?? undefined,
    cohort: filters.cohort,
    engine,
    baseline_id: filters.baselineId ?? undefined,
    selection_mode: selectionModeParam(filters),
    from: filters.selectionMode === 'range' ? from : undefined,
    to: filters.selectionMode === 'range' ? (filters.toAt ?? undefined) : undefined,
    configuration_key: filters.configuration ?? undefined,
  };
}

/**
 * Whether the evidence table is narrowed past what the summary endpoints take.
 *
 * They accept the run/engine/cohort scope and nothing else, while the evidence
 * read also narrows by prompt, outcome, competitor, domain and URL. With one of
 * those active a server-side total describes a LARGER population than the
 * table, so a tab must stop presenting it as the table's own.
 */
function isEvidenceScopeNarrowed(params: ReturnType<typeof evidenceSelectionParams>): boolean {
  return [params.prompt_id, params.outcome, params.competitor, params.domain, params.url].some(
    Boolean,
  );
}

function evidenceSelectionParams(
  filters: ReturnType<typeof useVisibilityFilters>,
  activeRunId: string | null,
  selectedRunIds: string[] | undefined,
  engine: string | undefined,
) {
  return {
    audit_id: selectedRunIds ? undefined : (activeRunId ?? undefined),
    audit_ids: selectedRunIds,
    engine,
    cohort: filters.cohort,
    prompt_id: filters.promptId ?? undefined,
    limit: EVIDENCE_LIMIT,
    outcome: filters.outcome ?? undefined,
    competitor: filters.competitor ?? undefined,
    domain: filters.domain ?? undefined,
    url: filters.url ?? undefined,
  };
}
