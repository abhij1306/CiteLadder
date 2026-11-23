import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { retainPreviousDataForScope, warmQuery } from '@/lib/api/query-client';
import { useProjectScope, type ActiveProjectScope } from '@/lib/project/active-project-scope';
import {
  cohortUrlCodec,
  writeStoredCohort,
  type PromptCohort,
} from '@/lib/visibility/prompt-cohort';
import { useDisplayTimeZone } from '@/lib/display-timezone';
import { runsQueries } from '@/lib/api/runs';
import { useMarketVisibility } from '@/lib/visibility/use-market-visibility';
import { useSurfaceRates } from '@/lib/visibility/use-surface-rates';
import { refreshVisibility, visibilityQueries } from '@/lib/api/visibility-queries';
import {
  brandRuns,
  findActiveRun,
  isEvidenceTab,
  VISIBILITY_TABS,
  toRunOptions,
  type RunOption,
  type VisibilityTab,
  type VisibilityView,
} from '@/lib/visibility/dashboard';
import { pollAudits } from '@/lib/runs/status';
import { EVIDENCE_LIMIT } from '@/lib/config/operational';
import {
  optionalStringUrlCodec,
  setUrlParams,
  stringUrlCodec,
  useUrlState,
  type UrlCodec,
} from '@/lib/navigation/url-state';
import { logicalEngineSchema } from '@citeladder/contracts/providers';
import {
  DEFAULT_TREND_RANGE,
  rangeToFrom,
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
const tabCodec = stringUrlCodec<VisibilityTab>(
  VISIBILITY_TABS.map(({ id }) => id),
  'domains',
);
const sourceKeys = [
  'source_cursor',
  'source_offset',
  'source_as_of',
  'source_type',
  'source_standing',
  'source_pick',
  'source_url',
];
const engineCodec = stringUrlCodec(['all', ...logicalEngineSchema.options], 'all');
const rangeCodec = stringUrlCodec<TrendRange>(['all', '30d', '90d', '1y'], DEFAULT_TREND_RANGE);
type SelectionMode = 'run' | 'range';
const chosenSelectionCodec: UrlCodec<SelectionMode | null> = {
  parse: (raw) => (raw === 'run' || raw === 'range' ? raw : null),
  serialize: (value) => value,
};
const granularityCodec = stringUrlCodec<TrendGranularity>(['run', 'day', 'week', 'month'], 'run');

function selectPeriod(value: TrendRange) {
  setUrlParams({
    selection: 'range',
    run: null,
    range: value,
    from: rangeToFrom(value) ?? null,
    to: null,
    configuration: null,
    ...Object.fromEntries(pageKeys.map((key) => [key, null])),
  });
}

export function visibilityRunSourcesHref(runId: string) {
  return `/visibility?${new URLSearchParams({ tab: 'domains', run: runId }).toString()}`;
}

const EVIDENCE_SLICE_KEYS = ['cursor', 'as_of', 'outcome', 'competitor', 'prompt', 'domain', 'url'];

export function visibilityEvidenceHref(
  search: string,
  slice: Readonly<Record<string, string | null>>,
): string {
  const params = new URLSearchParams(search);
  for (const key of [...EVIDENCE_SLICE_KEYS, 'brand', 'metric']) params.delete(key);
  params.set('tab', 'query-fanout');
  for (const [key, value] of Object.entries(slice)) {
    if (value === null) params.delete(key);
    else params.set(key, value);
  }
  return `/visibility?${params.toString()}`;
}

export function measuredSelection({
  chosen,
  namedRun,
  fallback,
  runs,
  from,
  to,
}: Readonly<{
  chosen: SelectionMode | null;
  namedRun: boolean;
  fallback: SelectionMode;
  runs: readonly Pick<RunOption, 'completedAt'>[] | undefined;
  from: string | undefined;
  to: string | undefined;
}>): SelectionMode {
  if (chosen !== null) return chosen;
  if (namedRun) return 'run';
  if (fallback === 'run' || runs === undefined) return fallback;
  const start = from === undefined ? -Infinity : Date.parse(from);
  const end = to === undefined ? Infinity : Date.parse(to);
  const inWindow = (completedAt: string | null) => {
    if (completedAt === null) return false;
    const at = Date.parse(completedAt);
    return at >= start && at <= end;
  };
  return runs.some((run) => inWindow(run.completedAt)) ? 'range' : 'run';
}

export function useVisibilityFilters({
  defaultSelection = 'run',
}: { defaultSelection?: SelectionMode } = {}) {
  const [activeTab, selectTab] = useUrlState('tab', tabCodec, { clearKeys: sourceKeys });
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
  const [chosenSelection] = useUrlState('selection', chosenSelectionCodec);
  const [configuration, setConfiguration] = useUrlState('configuration', optionalStringUrlCodec, {
    clearKeys: pageKeys,
  });
  const [granularity, setGranularity] = useUrlState('granularity', granularityCodec);
  const { projectId } = useProjectScope();
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
  const [market, setMarket] = useUrlState('market', optionalStringUrlCodec, {
    clearKeys: [...pageKeys, 'run', 'baseline', 'configuration'],
  });
  const [outcome, setOutcome] = useUrlState('outcome', optionalStringUrlCodec, {
    clearKeys: pageKeys,
  });
  const [topic, setTopic] = useUrlState('topic', optionalStringUrlCodec, {
    clearKeys: pageKeys,
  });
  const [competitor] = useUrlState('competitor', optionalStringUrlCodec);
  const [domain] = useUrlState('domain', optionalStringUrlCodec);
  const [url] = useUrlState('url', optionalStringUrlCodec);
  const isFiltered =
    engine !== 'all' ||
    topic !== null ||
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
    selectPeriod,
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
    topic,
    setTopic,
    competitor,
    domain,
    url,
    chosenSelection,
    defaultSelection,
    selectionMode: chosenSelection ?? defaultSelection,
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
    clearEvidenceFilters: () =>
      setUrlParams({
        engine: null,
        topic: null,
        prompt: null,
        outcome: null,
        competitor: null,
        domain: null,
        url: null,
        cursor: null,
        as_of: null,
      }),
    openEvidence: (slice: Record<string, string | null>) =>
      setUrlParams({
        tab: 'query-fanout',
        ...Object.fromEntries(EVIDENCE_SLICE_KEYS.map((key) => [key, null])),
        ...slice,
      }),
  };
}

function resolvedSelection(
  data:
    | {
        audit_id?: string | null;
        selection_mode?: string;
        source_audit_ids?: string[];
        from_at?: string | null;
        to_at?: string | null;
      }
    | null
    | undefined,
) {
  const range = data?.selection_mode === 'range';
  return {
    activeRunId: data?.audit_id ?? null,
    selectedRunIds: range ? data.source_audit_ids : undefined,
    selectedPeriod: range ? { from: data.from_at ?? undefined, to: data.to_at ?? undefined } : null,
  };
}

export function useVisibilityQueries(
  filters: ReturnType<typeof useVisibilityFilters>,
  view: VisibilityView,
) {
  const { workspaceId, projectId } = useProjectScope();
  const requestScope = { workspaceId, projectId };
  const insights = view === 'insights';
  const { queryClient, auditsQuery, runOptions, hasRuns, activeRun } = useVisibilityRuns(
    requestScope,
    filters.market,
  );
  const topic = filters.topic ?? undefined;
  const { markets, marketRowsQuery } = useMarketVisibility(
    requestScope,
    { cohort: filters.cohort, topic },
    insights,
  );

  const engine = filters.engine === 'all' ? undefined : filters.engine;
  const from = useMemo(
    () => filters.fromAt ?? rangeToFrom(filters.range),
    [filters.fromAt, filters.range],
  );
  const selectionMode = measuredSelection({
    chosen: filters.chosenSelection,
    namedRun: filters.selectedRunId !== null,
    fallback: filters.defaultSelection,
    runs: auditsQuery.isSuccess ? runOptions : undefined,
    from,
    to: filters.toAt ?? undefined,
  });
  const selectedParams = selectionParams(filters, { mode: selectionMode, from, engine });
  const projectionOptions = visibilityQueries.project(requestScope, selectedParams);
  const visibilityQuery = useQuery({
    ...projectionOptions,
    placeholderData: (data, query) => retainPreviousDataForScope(projectId, data, query),
  });
  const { activeRunId, selectedRunIds, selectedPeriod } = resolvedSelection(visibilityQuery.data);
  const trendParams = {
    market: filters.market ?? undefined,
    engine,
    topic,
    from,
    to: filters.toAt ?? undefined,
    granularity: filters.granularity,
    cohort: filters.cohort,
  };
  const { topic: _topic, baseline_id: _baseline, ...topicParams } = selectedParams;
  const topicsQuery = useQuery({
    ...visibilityQueries.topics(requestScope, topicParams),
    enabled: insights,
    placeholderData: (data, query) => retainPreviousDataForScope(projectId, data, query),
  });
  const { baseline_id: _matrixBaseline, ...matrixParams } = selectedParams;
  const matrixQuery = useQuery({
    ...visibilityQueries.matrix(requestScope, matrixParams),
    enabled: insights,
    placeholderData: (data, query) => retainPreviousDataForScope(projectId, data, query),
  });
  const trendOptions = visibilityQueries.trends(requestScope, trendParams);
  const trendQuery = useQuery({
    ...trendOptions,
    enabled: insights || view === 'competitor',
    placeholderData: (data, query) => retainPreviousDataForScope(projectId, data, query),
  });
  const { surfaceEngine, surfaceRatesQuery } = useSurfaceRates({
    requestScope,
    engine,
    cohort: filters.cohort,
    onInsights: insights,
    activeRunId,
    selectedRunIds,
  });
  const hasEvidenceScope = Boolean(activeRunId) && selectedRunIds?.length !== 0;
  const evidenceParams = evidenceSelectionParams(filters, activeRunId, selectedRunIds, engine);
  const evidenceOptions = {
    ...visibilityQueries.evidence(requestScope, evidenceParams),
  };
  const evidenceQuery = useQuery({
    ...evidenceOptions,
    placeholderData: (data, query) => retainPreviousDataForScope(projectId, data, query),
    enabled: hasEvidenceScope && isEvidenceTab(view),
  });
  const prefetchTab = (tab: VisibilityTab) => {
    if (isEvidenceTab(tab) && hasEvidenceScope) {
      warmQuery(queryClient, evidenceOptions);
    }
  };
  return {
    selectionMode,
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
    selectedPeriod,
    visibilityQuery,
    trendQuery,
    topicsQuery,
    matrixQuery,
    topic,
    evidenceQuery,
    surfaceRatesQuery,
    surfaceEngine,
    evidenceScope: {
      audit_id: evidenceParams.audit_id,
      audit_ids: evidenceParams.audit_ids,
      engine: evidenceParams.engine,
      topic: evidenceParams.topic,
      cohort: evidenceParams.cohort,
      prompt_id: evidenceParams.prompt_id,
      outcome: evidenceParams.outcome,
      competitor: evidenceParams.competitor,
      domain: evidenceParams.domain,
      url: evidenceParams.url,
    },
    hasEvidenceScope,
    promptOptions: evidenceQuery.data?.prompt_options ?? [],
    prefetchTab,
  };
}

function useVisibilityRuns(
  requestScope: Pick<ActiveProjectScope, 'workspaceId' | 'projectId'>,
  market: string | null,
) {
  const { workspaceId, projectId } = requestScope;
  const timeZone = useDisplayTimeZone();
  const queryClient = useQueryClient();
  const auditsQuery = useQuery({
    ...runsQueries.list({ workspaceId, projectId }),
    refetchInterval: (query) =>
      pollAudits(brandRuns(query.state.data).map((audit) => audit.status)),
  });
  const audits = useMemo(() => brandRuns(auditsQuery.data), [auditsQuery.data]);
  const runOptions = useMemo(
    () =>
      toRunOptions(
        audits.filter((audit) => audit.market.id === market),
        timeZone,
      ),
    [audits, market, timeZone],
  );
  const allRuns = useMemo(() => toRunOptions(audits, timeZone), [audits, timeZone]);
  const hasRuns = allRuns.length > 0;
  const activeRun = useMemo(() => findActiveRun(audits), [audits]);
  const runSignal = `${allRuns[0]?.id ?? ''}:${activeRun?.id ?? 'idle'}`;
  const previousSignal = useRef<string | undefined>(undefined);
  const auditsLoaded = auditsQuery.isSuccess;
  useEffect(() => {
    if (!auditsLoaded) return;
    const previous = previousSignal.current;
    previousSignal.current = runSignal;
    if (previous !== undefined && previous !== runSignal) {
      void refreshVisibility(queryClient, projectId);
    }
  }, [auditsLoaded, runSignal, queryClient, projectId]);

  return { queryClient, auditsQuery, runOptions, hasRuns, activeRun };
}

function selectionParams(
  filters: ReturnType<typeof useVisibilityFilters>,
  { mode, from, engine }: Readonly<{ mode: SelectionMode; from?: string; engine?: string }>,
) {
  const range = mode === 'range';
  return {
    audit_id: filters.selectedRunId ?? undefined,
    market: filters.market ?? undefined,
    cohort: filters.cohort,
    engine,
    topic: filters.topic ?? undefined,
    baseline_id: filters.baselineId ?? undefined,
    selection_mode: range ? 'range' : filters.selectedRunId ? 'run' : 'latest',
    from: range ? from : undefined,
    to: range ? (filters.toAt ?? undefined) : undefined,
    configuration_key: filters.configuration ?? undefined,
  };
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
    topic: filters.topic ?? undefined,
    cohort: filters.cohort,
    prompt_id: filters.promptId ?? undefined,
    limit: EVIDENCE_LIMIT,
    outcome: filters.outcome ?? undefined,
    competitor: filters.competitor ?? undefined,
    domain: filters.domain ?? undefined,
    url: filters.url ?? undefined,
  };
}
