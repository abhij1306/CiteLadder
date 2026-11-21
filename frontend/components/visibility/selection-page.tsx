import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import type { FilterDefinition } from '@/components/ui/all-filters';
import { FilterBar } from '@/components/ui/filter-bar';
import { readErrorProps } from '@/components/ui/notice';
import { SectionStack } from '@/components/ui/section';
import { StateBlock } from '@/components/ui/state-block';
import { VisibilityEmptyState } from '@/components/visibility/empty-state';
import { useVisibilityFilterMenu } from '@/components/visibility/visibility-toolbar';
import { topicsQueries } from '@/lib/api/topics';
import type { VisibilityView } from '@/lib/visibility/dashboard';
import type {
  useVisibilityFilters,
  useVisibilityQueries,
} from '@/lib/visibility/use-visibility-dashboard';

type Filters = ReturnType<typeof useVisibilityFilters>;
type Queries = ReturnType<typeof useVisibilityQueries>;

export type SelectionPageState = 'loading' | 'error' | 'empty' | null;

export function selectionPageFilterBar(
  state: SelectionPageState,
  filters: readonly FilterDefinition[],
): ReactNode {
  if (state !== null && state !== 'loading') return undefined;
  return <FilterBar filters={filters} />;
}

export function selectionPageState(queries: Queries): SelectionPageState {
  if (queries.auditsQuery.isLoading) return 'loading';
  if (queries.hasRuns) return null;
  return queries.auditsQuery.isError ? 'error' : 'empty';
}

export function SelectionPageStateBlock({
  state,
  queries,
}: Readonly<{ state: Exclude<SelectionPageState, null>; queries: Queries }>) {
  if (state === 'empty') return <VisibilityEmptyState activeRun={queries.activeRun ?? null} />;
  if (state === 'loading')
    return (
      <SectionStack aria-busy>
        <StateBlock kind="loading" label="Loading visibility…" shape={{ kind: 'figures' }} />
        <StateBlock kind="loading" label="Loading the trend…" shape={{ kind: 'chart' }} />
        <StateBlock kind="loading" label="Loading the evidence…" shape={{ kind: 'table' }} />
      </SectionStack>
    );
  return (
    <StateBlock
      kind="error"
      {...readErrorProps(queries.auditsQuery)}
      title="Couldn't load this project's runs"
      fallback="Check your connection and try again."
    />
  );
}

export function useSelectionPageFilters({
  view,
  filters,
  queries,
}: Readonly<{
  view: VisibilityView;
  filters: Filters;
  queries: Queries;
}>): readonly FilterDefinition[] {
  const topicsQuery = useQuery(
    topicsQueries.list({ workspaceId: queries.workspaceId, projectId: queries.projectId }),
  );
  return useVisibilityFilterMenu({
    view,
    runs: queries.runOptions,
    selectedRunId: filters.selectedRunId,
    onSelectMeasurement: filters.selectMeasurement,
    engine: filters.engine,
    onChangeEngine: filters.setEngine,
    promptOptions: queries.promptOptions,
    promptId: filters.promptId,
    onChangePrompt: filters.setPromptId,
    range: filters.range,
    onSelectPeriod: filters.selectPeriod,
    granularity: filters.granularity,
    onChangeGranularity: filters.setGranularity,
    cohort: filters.cohort,
    onChangeCohort: filters.setCohort,
    selectionMode: filters.selectionMode,
    outcome: filters.outcome,
    onChangeOutcome: filters.setOutcome,
    markets: queries.markets,
    market: filters.market,
    onChangeMarket: filters.setMarket,
    topics: topicsQuery.data ?? [],
    topic: filters.topic,
    onChangeTopic: filters.setTopic,
  });
}
