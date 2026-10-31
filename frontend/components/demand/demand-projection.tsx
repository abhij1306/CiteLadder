'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { Calendar, RefreshCw, Search, Sparkles } from 'lucide-react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { MutationNotice } from '@/components/ui/mutation-notice';
import { ProjectRequiredState } from '@/components/layout/project-required-state';
import { ListScreen } from '@/components/layout/page-shell';
import { QueryState } from '@/components/ui/query-state';
import { ReadError, readErrorProps } from '@/components/ui/read-error';
import { SearchField } from '@/components/ui/search-field';
import { DemandEvidenceDrawer } from '@/components/demand/demand-evidence-drawer';
import { DemandLatentDemand } from '@/components/demand/demand-latent-demand';
import { DemandSignalFilters } from '@/components/demand/demand-signal-filters';
import { DemandSignalTable, SignalLegend } from '@/components/demand/demand-signal-table';
import { demandApi, type DemandSignal, type DemandSnapshot } from '@/lib/api/demand';
import { mutationNoticeForError } from '@/lib/api/mutation-notice';
import { queryKeys } from '@/lib/api/query-keys';
import { latestDemandSnapshotQuery } from '@/lib/demand/latest-snapshot';
import {
  countByTab,
  FILTER_TABS,
  matchesTab,
  signalTarget,
  type FilterTab,
  type RankedSignal,
} from '@/lib/demand/signals';
import { formatCount, formatWindowDate } from '@/lib/format';
import { useProjectContext } from '@/lib/project/project-context';
import { optionalStringUrlCodec, stringUrlCodec, useUrlState } from '@/lib/navigation/url-state';
import { Icon } from '@/components/ui/icon';
import { Inline, Stack } from '@/components/ui/layout';
import { DataSourceSetup } from '@/components/integrations/data-source-setup';

const DEMAND_TAB_CODEC = stringUrlCodec(
  FILTER_TABS.map(({ tab }) => tab),
  'all' as FilterTab,
);

function SearchDemandView({
  snapshot,
  refreshError,
  onRetry,
  retrying,
}: Readonly<{
  snapshot: DemandSnapshot;
  refreshError?: Error | null;
  onRetry?: () => void;
  retrying?: boolean;
}>) {
  const { activeProject } = useProjectContext();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useUrlState('view', DEMAND_TAB_CODEC, {
    clearKeys: ['signal'],
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSignalId, setSelectedSignalId] = useUrlState('signal', optionalStringUrlCodec);
  const selectedSignal = snapshot.signals.find((signal) => signal.id === selectedSignalId) ?? null;

  /**
   * Recompute is a QUEUED job, not a synchronous rebuild: the endpoint returns
   * 202 with `status: queued` and a worker produces the new snapshot later.
   * Refetching on success would therefore just re-read the current snapshot
   * and look like a no-op, so we report that the work was queued and let the
   * user refresh once it lands.
   */
  const recomputeMutation = useMutation({
    mutationFn: () =>
      demandApi.recompute(
        activeProject!.id,
        { window_start: snapshot.window_start, window_end: snapshot.window_end },
        { workspaceId: activeProject!.workspace_id },
      ),
  });

  const refreshSnapshot = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.demand.latest(activeProject?.id) });

  const handleInspect = (signal: DemandSignal) => {
    setSelectedSignalId(signal.id);
  };

  const windowLabel = `${formatWindowDate(snapshot.window_start)} – ${formatWindowDate(snapshot.window_end)}`;

  // Counts for every tab in one pass, recomputed only when the snapshot does —
  // not on every keystroke in the search box.
  const tabCounts = useMemo(
    () => new Map(FILTER_TABS.map(({ tab }) => [tab, countByTab(snapshot.signals, tab)] as const)),
    [snapshot.signals],
  );

  /**
   * The API returns signals ordered by priority, so a signal's rank is its
   * index in the FULL list. Pairing it here keeps the rank stable when a
   * filter hides the signals above it.
   */
  const filteredSignals = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return snapshot.signals.reduce<RankedSignal[]>((matches, signal, index) => {
      if (!matchesTab(signal, activeTab)) return matches;
      if (!query) {
        matches.push({ signal, rank: index + 1 });
        return matches;
      }
      const haystack = [
        signalTarget(signal),
        signal.page_url,
        signal.signal_type.replaceAll('_', ' '),
      ]
        .join(' ')
        .toLowerCase();
      if (haystack.includes(query)) matches.push({ signal, rank: index + 1 });
      return matches;
    }, []);
  }, [snapshot.signals, activeTab, searchQuery]);

  // An empty feed has two different causes, and they need different words:
  // nothing was detected at all, or the filter hid everything that was.
  let signalsFeed: ReactNode = (
    <QueryState
      kind="empty"
      icon={Search}
      heading="No signals match your filter"
      description="Try choosing a different filter tab or clearing your search term."
      action={
        <Button
          variant="secondary"
          onClick={() => {
            setActiveTab('all');
            setSearchQuery('');
          }}
        >
          Clear filters
        </Button>
      }
    />
  );
  if (filteredSignals.length > 0) {
    signalsFeed = (
      <Stack gap="compact">
        <DemandSignalTable
          rows={filteredSignals}
          filterKey={`${activeTab}\u0000${searchQuery.trim().toLowerCase()}`}
          onInspect={handleInspect}
        />
        <SignalLegend signals={filteredSignals.map(({ signal }) => signal)} />
      </Stack>
    );
  } else if (snapshot.signals.length === 0) {
    signalsFeed = (
      <QueryState
        kind="empty"
        icon={Sparkles}
        heading="No qualifying search gaps observed"
        description="Search Console data was observed, but no configured detector emitted a signal in this window."
      />
    );
  }

  return (
    <ListScreen
      actions={
        <Button
          variant="secondary"
          onClick={() => recomputeMutation.mutate()}
          pending={recomputeMutation.isPending}
          pendingLabel="Queueing…"
        >
          <Icon icon={RefreshCw} />
          Recompute signals
        </Button>
      }
      controls={{
        search: (
          <SearchField
            value={searchQuery}
            onValueChange={setSearchQuery}
            placeholder="Filter queries or pages…"
            aria-label="Filter queries or pages"
          />
        ),
        filters: (
          <DemandSignalFilters
            snapshot={snapshot}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            tabCounts={tabCounts}
          />
        ),
      }}
    >
      <>
        {refreshError ? (
          <ReadError
            error={refreshError}
            fallback="Search demand could not be refreshed."
            onRetry={onRetry ?? (() => undefined)}
            pending={Boolean(retrying)}
          />
        ) : null}
        {recomputeMutation.isError ? (
          <MutationNotice
            notice={mutationNoticeForError(recomputeMutation.error, {
              action: 'queue the search demand recompute',
            })}
            onRetry={() => recomputeMutation.mutate()}
          />
        ) : null}

        {recomputeMutation.isSuccess ? (
          <Alert tone="info">
            <Inline className="flex-wrap">
              <span>
                {recomputeMutation.data.status === 'already_queued'
                  ? 'A recompute for this window is already queued.'
                  : 'Recompute queued. Signals refresh once the job finishes.'}
              </span>
              <Button type="button" variant="ghost" onClick={() => refreshSnapshot()}>
                Check for the new snapshot
              </Button>
            </Inline>
          </Alert>
        ) : null}

        {/* The summary line, then the table the top strip's filters narrow. */}
        <Stack>
          <Inline as="p" gap="meta">
            <span className="type-caption">
              {snapshot.signals.length === 1
                ? '1 signal observed'
                : `${formatCount(snapshot.signals.length)} signals observed`}
            </span>
            <Inline as="span" gap="tight" className="type-caption">
              <Icon icon={Calendar} />
              {windowLabel}
            </Inline>
            <DemandLatentDemand snapshot={snapshot} />
          </Inline>
          {signalsFeed}
        </Stack>

        <DemandEvidenceDrawer
          signal={selectedSignal}
          open={selectedSignal !== null}
          onOpenChange={(open) => {
            if (!open) setSelectedSignalId(null);
          }}
        />
      </>
    </ListScreen>
  );
}

export function DemandProjection() {
  const { activeProject, isLoading: projectLoading } = useProjectContext();
  const latest = useQuery({
    ...latestDemandSnapshotQuery(activeProject?.id ?? '', activeProject?.workspace_id ?? null),
    enabled: Boolean(activeProject),
    // Deliberately NO `keepPreviousData`: the key's only variable is the
    // project, so keeping previous data would render the PREVIOUS project's
    // snapshot as a success (placeholder data is not `isLoading`) while
    // `SearchDemandView` recomputes against the CURRENT project id.
  });

  // The loaded view owns its own bands. Every other state is the same page
  // with an empty content region, so it keeps its identity band rather than
  // losing the heading and the rule above the work.
  const snapshot = latest.data;
  if (activeProject && snapshot?.coverage.search === 'observed') {
    // The route already wraps this subtree in a TooltipProvider.
    //
    // A refresh that fails over evidence we already hold keeps the evidence and
    // says so. Returning the error instead would blank a working screen; saying
    // nothing would present a stale snapshot as current.
    return (
      <SearchDemandView
        snapshot={snapshot}
        refreshError={latest.error}
        onRetry={() => void latest.refetch()}
        retrying={latest.isFetching}
      />
    );
  }
  return (
    <ListScreen>
      {demandFallback({
        projectLoading,
        hasProject: Boolean(activeProject),
        latest,
      })}
    </ListScreen>
  );
}

/** Every non-loaded state of `/demand`, in the order it is decided. */
function demandFallback({
  projectLoading,
  hasProject,
  latest,
}: Readonly<{
  projectLoading: boolean;
  hasProject: boolean;
  latest: UseQueryResult<DemandSnapshot | null, Error>;
}>) {
  if (projectLoading || latest.isLoading)
    return <QueryState kind="loading" label="Loading search demand…" />;
  if (!hasProject) return <ProjectRequiredState />;
  if (latest.data === null) return <SearchConsoleSetup />;
  if (latest.isError)
    return (
      <QueryState
        kind="error"
        {...readErrorProps(latest)}
        fallback="Search demand could not be loaded. Check your connection and try again."
      />
    );
  if (latest.data === undefined) return null;
  return <SearchConsoleSetup />;
}

/** No usable Search Console evidence yet: connect it, or wait for its import. */
function SearchConsoleSetup() {
  return (
    <DataSourceSetup
      required={['gsc']}
      title="Connect Search Console"
      description="Search Demand finds opportunities in this project's own search queries. Connect Google and use the property for this site."
      whenReady={
        <QueryState
          kind="empty"
          icon={Search}
          heading="Search Demand appears after the next Search Console import"
        />
      }
    />
  );
}
