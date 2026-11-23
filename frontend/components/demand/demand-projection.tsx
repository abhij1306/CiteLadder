import { useMemo, useState, type ReactNode } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { Button } from '@/components/ui/button';
import { RESERVED_CONTROLS } from '@/components/layout/page-shell';
import { FilterBar } from '@/components/ui/filter-bar';
import { SearchField } from '@/components/ui/search-field';
import { DemandEvidenceDrawer } from '@/components/demand/demand-evidence-drawer';
import { DemandLatentDemand } from '@/components/demand/demand-latent-demand';
import { DemandSignalFilters } from '@/components/demand/demand-signal-filters';
import { DemandSignalTable, SIGNAL_COLUMN_COUNT } from '@/components/demand/demand-signal-table';
import {
  demandMutations,
  demandQueries,
  refreshDemandSnapshot,
  type demandApi,
  type DemandSignal,
  type DemandSnapshot,
} from '@/lib/api/demand';
import type { DemandRecomputeRequest } from '@citeladder/contracts/demand';
import { RefreshCw, Search, Sparkles } from '@/lib/icons';
import { isTransientMutationError, mutationNoticeForError } from '@/lib/api/mutation-notice';
import {
  countByTab,
  FILTER_TABS,
  matchesTab,
  signalTarget,
  type FilterTab,
  type RankedSignal,
} from '@/lib/demand/signals';
import { useProjectScope } from '@/lib/project/active-project-scope';
import { useWorkspaceCapability } from '@/lib/project/project-context';
import { optionalStringUrlCodec, stringUrlCodec, useUrlState } from '@/lib/navigation/url-state';
import { Icon } from '@/components/ui/icon';
import { Stack } from '@/components/ui/layout';
import { DataSourceSetup } from '@/components/integrations/data-source-setup';
import { Notice, readErrorProps } from '@/components/ui/notice';
import { StateBlock } from '@/components/ui/state-block';
import { Section } from '@/components/ui/section';
import { Skeleton } from '@/components/ui/skeleton';

const DEMAND_TAB_CODEC = stringUrlCodec<FilterTab>(
  FILTER_TABS.map(({ tab }) => tab),
  'all',
);

type RecomputeMutation = UseMutationResult<
  Awaited<ReturnType<typeof demandApi.recompute>>,
  Error,
  DemandRecomputeRequest
>;

function RecomputeAction({
  mutation,
  onRecompute,
  onCheck,
}: Readonly<{ mutation: RecomputeMutation; onRecompute: () => void; onCheck: () => void }>) {
  if (mutation.isSuccess)
    return (
      <Button variant="secondary" onClick={onCheck}>
        <Icon icon={RefreshCw} />
        Check for new snapshot
      </Button>
    );
  const retry = mutation.isError && isTransientMutationError(mutation.error);
  return (
    <Button
      variant="secondary"
      onClick={onRecompute}
      pending={mutation.isPending}
      pendingLabel="Queueing…"
    >
      <Icon icon={RefreshCw} />
      {retry ? 'Try again' : 'Recompute signals'}
    </Button>
  );
}

function RecomputeStatus({ mutation }: Readonly<{ mutation: RecomputeMutation }>) {
  if (mutation.isSuccess)
    return (
      <Notice tone="info">
        {mutation.data.status === 'already_queued'
          ? 'A recompute for this window is already queued.'
          : 'Recompute queued.'}
      </Notice>
    );
  return null;
}

function DemandEmpty({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <Section>
      <Stack>{children}</Stack>
    </Section>
  );
}

function RecomputeFailure({ mutation }: Readonly<{ mutation: RecomputeMutation }>) {
  if (!mutation.isError) return null;
  return (
    <Notice
      kind="mutation"
      notice={mutationNoticeForError(mutation.error, {
        action: 'queue the search demand recompute',
      })}
    />
  );
}

export function useDemand() {
  const { workspaceId, projectId } = useProjectScope();
  const queryClient = useQueryClient();
  const latest = useQuery({
    ...demandQueries.latest({ workspaceId, projectId }),
  });
  const [activeTab, setActiveTab] = useUrlState('view', DEMAND_TAB_CODEC, {
    clearKeys: ['signal'],
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSignalId, setSelectedSignalId] = useUrlState('signal', optionalStringUrlCodec);
  const recompute = useMutation(demandMutations.recompute({ workspaceId, projectId }));
  const canRun = useWorkspaceCapability('run');
  const snapshot = latest.data?.coverage.search === 'observed' ? latest.data : null;
  const signals = snapshot?.signals;
  const tabCounts = useMemo(
    () => new Map(FILTER_TABS.map(({ tab }) => [tab, countByTab(signals ?? [], tab)] as const)),
    [signals],
  );
  const filteredSignals = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return (signals ?? []).reduce<RankedSignal[]>((matches, signal, index) => {
      if (!matchesTab(signal, activeTab)) return matches;
      const haystack = [
        signalTarget(signal),
        signal.page_url,
        signal.signal_type.replaceAll('_', ' '),
      ]
        .join(' ')
        .toLowerCase();
      if (!query || haystack.includes(query)) matches.push({ signal, rank: index + 1 });
      return matches;
    }, []);
  }, [signals, activeTab, searchQuery]);
  return {
    latest,
    snapshot,
    recompute,
    canRun,
    refresh: () => refreshDemandSnapshot(queryClient, projectId),
    filter: { activeTab, setActiveTab, searchQuery, setSearchQuery, tabCounts, filteredSignals },
    selection: { selectedSignalId, setSelectedSignalId },
  };
}

type Demand = ReturnType<typeof useDemand>;

export function DemandActions({ demand }: Readonly<{ demand: Demand }>) {
  const { snapshot, recompute, canRun } = demand;
  if (!canRun || !snapshot) return null;
  return (
    <RecomputeAction
      mutation={recompute}
      onRecompute={() =>
        recompute.mutate({ window_start: snapshot.window_start, window_end: snapshot.window_end })
      }
      onCheck={() => {
        recompute.reset();
        void demand.refresh();
      }}
    />
  );
}

export function demandControls(demand: Demand): ReactNode {
  const { snapshot, filter } = demand;
  if (!snapshot) return demand.latest.isLoading ? <FilterBar {...RESERVED_CONTROLS} /> : undefined;
  return (
    <FilterBar
      view={
        <DemandSignalFilters
          activeTab={filter.activeTab}
          onTabChange={filter.setActiveTab}
          tabCounts={filter.tabCounts}
        />
      }
      search={
        <SearchField
          value={filter.searchQuery}
          onValueChange={filter.setSearchQuery}
          placeholder="Filter queries or pages…"
          aria-label="Filter queries or pages"
        />
      }
      status={<DemandLatentDemand snapshot={snapshot} />}
    />
  );
}

export function DemandPanel({ demand }: Readonly<{ demand: Demand }>) {
  const { latest, snapshot } = demand;
  if (!snapshot) return demandFallback(latest);
  return (
    <>
      {latest.error ? (
        <Notice
          kind="read"
          error={latest.error}
          fallback="Demand could not be refreshed."
          title="Demand could not be refreshed"
          onRetry={() => void latest.refetch()}
          pending={latest.isFetching}
        />
      ) : null}
      <RecomputeFailure mutation={demand.recompute} />
      <RecomputeStatus mutation={demand.recompute} />
      <SignalsFeed demand={demand} snapshot={snapshot} />
    </>
  );
}

function SignalsFeed({
  demand: { filter, selection },
  snapshot,
}: Readonly<{ demand: Demand; snapshot: DemandSnapshot }>) {
  const selectedSignal =
    snapshot.signals.find((signal) => signal.id === selection.selectedSignalId) ?? null;
  return (
    <>
      {snapshot.signals.length === 0 ? (
        <DemandEmpty>
          <StateBlock
            kind="empty"
            icon={Sparkles}
            heading="No qualifying search gaps observed"
            headingLevel={2}
          />
        </DemandEmpty>
      ) : (
        <DemandSignalTable
          rows={filter.filteredSignals}
          filterKey={`${filter.activeTab}\u0000${filter.searchQuery.trim().toLowerCase()}`}
          onInspect={(signal: DemandSignal) => selection.setSelectedSignalId(signal.id)}
          onClearFilters={() => {
            filter.setActiveTab('all');
            filter.setSearchQuery('');
          }}
        />
      )}
      <DemandEvidenceDrawer
        signal={selectedSignal}
        policy={snapshot.detector_policy}
        open={selectedSignal !== null}
        onOpenChange={(open) => {
          if (!open) selection.setSelectedSignalId(null);
        }}
      />
    </>
  );
}

function demandFallback(latest: UseQueryResult<DemandSnapshot | null, Error>) {
  if (latest.isLoading)
    return (
      <Section>
        <Skeleton variant="table" columns={SIGNAL_COLUMN_COUNT} label="Loading search demand…" />
      </Section>
    );
  if (latest.data === null) return <SearchConsoleSetup />;
  if (latest.isError)
    return (
      <StateBlock
        kind="error"
        {...readErrorProps(latest)}
        fallback="Demand could not be loaded. The request failed or timed out."
        title="Demand could not be loaded"
      />
    );
  if (latest.data === undefined) return null;
  return <SearchConsoleSetup />;
}

function SearchConsoleSetup() {
  return (
    <DataSourceSetup
      required={['gsc']}
      title="Connect Search Console"
      unconnected={{
        icon: Search,
        heading: 'Connect Search Console to see search demand',
      }}
      whenReady={
        <DemandEmpty>
          <StateBlock
            kind="empty"
            icon={Search}
            heading="Demand appears after the next Search Console import"
            headingLevel={2}
          />
        </DemandEmpty>
      }
    />
  );
}
