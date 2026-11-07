'use client';

import { useMemo, useState, type ReactNode } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { Calendar, RefreshCw, Search, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ProjectRequiredState } from '@/components/layout/project-required-state';
import { ListScreen } from '@/components/layout/page-shell';
import { QueryState } from '@/components/ui/query-state';
import { ReadError, readErrorProps } from '@/components/ui/read-error';
import { SearchField } from '@/components/ui/search-field';
import { DemandEvidenceDrawer } from '@/components/demand/demand-evidence-drawer';
import { DemandLatentDemand } from '@/components/demand/demand-latent-demand';
import { DemandDataCaveats, DemandSignalFilters } from '@/components/demand/demand-signal-filters';
import { DemandSignalTable, SignalLegend } from '@/components/demand/demand-signal-table';
import {
  demandMutations,
  demandQueries,
  refreshDemandSnapshot,
  type demandApi,
  type DemandSignal,
  type DemandSnapshot,
} from '@/lib/api/demand';
import type { DemandRecomputeRequest } from '@citeladder/contracts/demand';
import { isTransientMutationError, mutationNoticeForError } from '@/lib/api/mutation-notice';
import { resolveActiveProjectRequestScope } from '@/lib/project/request-scope';
import {
  countByTab,
  FILTER_TABS,
  matchesTab,
  signalTarget,
  type FilterTab,
  type RankedSignal,
} from '@/lib/demand/signals';
import { formatCount, formatWindowDate } from '@/lib/format';
import { InlineFigure } from '@/components/ui/typography';
import { useProjectContext } from '@/lib/project/project-context';
import { optionalStringUrlCodec, stringUrlCodec, useUrlState } from '@/lib/navigation/url-state';
import { Icon } from '@/components/ui/icon';
import { Inline, Stack } from '@/components/ui/layout';
import { DataSourceSetup } from '@/components/integrations/data-source-setup';

const DEMAND_TAB_CODEC = stringUrlCodec(
  FILTER_TABS.map(({ tab }) => tab),
  'all' as FilterTab,
);

type RecomputeMutation = UseMutationResult<
  Awaited<ReturnType<typeof demandApi.recompute>>,
  Error,
  DemandRecomputeRequest
>;

/**
 * The header's one recompute button, which becomes the next step in place:
 * once queued it checks for the new snapshot; after a transient failure it
 * retries. The button keeps its slot, so the page never moves.
 */
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

/** Recompute's outcome as one more fact on the summary line. */
function RecomputeStatus({ mutation }: Readonly<{ mutation: RecomputeMutation }>) {
  if (mutation.isSuccess)
    return (
      <span className="type-caption text-info">
        {mutation.data.status === 'already_queued'
          ? 'A recompute for this window is already queued.'
          : 'Recompute queued. Signals refresh once the job finishes.'}
      </span>
    );
  if (mutation.isError) {
    const notice = mutationNoticeForError(mutation.error, {
      action: 'queue the search demand recompute',
    });
    const support = [notice.code, notice.requestId].filter(Boolean).join(' · ');
    return (
      <span role="alert" className="type-caption text-negative" title={support || undefined}>
        {notice.message}
      </span>
    );
  }
  return null;
}

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

  // Recompute is queued: the screen reports that the work was queued and lets
  // the reader check for the new snapshot once it lands.
  const scope = resolveActiveProjectRequestScope(activeProject);
  const recomputeMutation = useMutation(demandMutations.recompute(scope));
  const refreshSnapshot = () => refreshDemandSnapshot(queryClient, scope.projectId);

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
        <RecomputeAction
          mutation={recomputeMutation}
          onRecompute={() =>
            recomputeMutation.mutate({
              window_start: snapshot.window_start,
              window_end: snapshot.window_end,
            })
          }
          onCheck={() => {
            recomputeMutation.reset();
            void refreshSnapshot();
          }}
        />
      }
      controls={{
        search: (
          <SearchField
            value={searchQuery}
            onValueChange={setSearchQuery}
            placeholder="Filter signals…"
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
        {/* The summary line, then the table the top strip's filters narrow.
            Recompute's outcome rides the summary line and the header button
            rather than a banner above it, so the table never moves. */}
        <Stack>
          <Inline as="p" gap="meta">
            <span className="type-caption">
              <InlineFigure>{formatCount(snapshot.signals.length)}</InlineFigure>
              {snapshot.signals.length === 1 ? ' signal observed' : ' signals observed'}
            </span>
            <Inline as="span" gap="tight" className="type-caption">
              <Icon icon={Calendar} />
              {windowLabel}
            </Inline>
            <DemandLatentDemand snapshot={snapshot} />
            <DemandDataCaveats snapshot={snapshot} />
            <RecomputeStatus mutation={recomputeMutation} />
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
    ...demandQueries.latest(resolveActiveProjectRequestScope(activeProject)),
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
