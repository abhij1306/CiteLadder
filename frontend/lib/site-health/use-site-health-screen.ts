'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/lib/api/query-keys';
import {
  siteHealthMutations,
  siteHealthQueries,
  type StartCrawlInput,
} from '@/lib/api/site-health';
import type { SiteCrawl } from '@/lib/api/types';
import {
  downloadCrawlExport,
  type ExportFormat,
  type ExportView,
} from '@/lib/site-health/download';
import { invalidateCrawlViews, invalidateMonitoredProjection } from '@/lib/site-health/invalidate';
import { useActiveWorkspaceId } from '@/lib/project/project-context';
import { resolveProjectRequestScope } from '@/lib/project/request-scope';
import { useCrawlEvents } from '@/lib/site-health/use-crawl-events';
import {
  crawlPollInterval,
  crawlProgressVersion,
  inventoryModeForPhase,
  isCrawlStalled,
  PAGE_LIMIT,
  shouldPollCrawl,
  type InventoryMode,
  type SiteHealthPhase,
} from '@/lib/site-health/status';

function monitoredPagePreviewParams(active: boolean) {
  return {
    limit: PAGE_LIMIT,
    monitored: true,
    status: active ? 'completed' : undefined,
  };
}

function canLoadPagePreview(
  scopeEnabled: boolean,
  crawlId: string | undefined,
  phase: SiteHealthPhase,
): boolean {
  return scopeEnabled && Boolean(crawlId) && (phase === 'analyzing' || phase === 'dashboard');
}

/**
 * Data orchestration for the Site Health screen (Slice 7).
 *
 * Owns the dashboard / pages / discovery-preview / monitored
 * queries, the create/cancel mutations, the export flow, and the phase
 * resolution. Progress is POLLING-FIRST: the credentialed SSE stream is only an
 * invalidation accelerator (a dropped stream never stops progress). Exports are
 * authenticated blob downloads so a non-default workspace's `X-Workspace-Id`
 * is preserved.
 *
 * Polling is ONE subscription. The dashboard query owns the only timer; every
 * other crawl-derived view (pages here, inventory/pages/issues in the sections)
 * refreshes when the crawl's progress fingerprint changes. Five components each
 * running their own 4s timer over the same crawl produced overlapping refetches
 * that resolved out of order, so panels rendered state from different moments.
 */
export function useSiteHealthScreen(projectId: string | null) {
  const queryClient = useQueryClient();
  const workspaceId = useActiveWorkspaceId();
  const requestScope = resolveProjectRequestScope(workspaceId, projectId);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const dashboardQuery = useQuery({
    ...siteHealthQueries.dashboard(requestScope.workspaceId, requestScope.projectId),
    enabled: requestScope.enabled,
    // Backed off by crawl age, and stops entirely on a crawl that has gone
    // silent — an active-forever crawl must not pin the tab to a 4s poll of
    // five queries indefinitely.
    refetchInterval: (query) => {
      const polled = query.state.data?.crawl;
      return polled ? crawlPollInterval(polled) : false;
    },
  });

  const crawl: SiteCrawl | null = dashboardQuery.data?.crawl ?? null;
  const active = crawl ? shouldPollCrawl(crawl) : false;
  // Evidence-derived backend activity state; never inferred from client time.
  const stalled = isCrawlStalled(crawl);
  // THE phase, resolved server-side from the crawl and the project's monitored
  // set at one instant. `'resolving'` only means the
  // dashboard request has not landed yet — there is no client-side precedence
  // chain racing three independently-loading queries any more.
  const phase: SiteHealthPhase = dashboardQuery.data?.phase ?? 'resolving';

  // SSE invalidation accelerator (polling stays the baseline). Keep it active
  // through an expired-lease report so the sweeper's recovery is observed.
  useCrawlEvents(crawl?.id, projectId, active);

  // Refresh crawl-derived lists only when persisted progress changes. The
  // first sighting mounts its own queries, and unchanged dashboard polls do no
  // downstream work.
  const crawlId = crawl?.id ?? null;
  const crawlVersion = crawl ? crawlProgressVersion(crawl) : null;
  const lastSeenRef = useRef<{ crawlId: string; version: string } | null>(null);
  useEffect(() => {
    if (!crawlId || crawlVersion === null) return;
    const previous = lastSeenRef.current;
    lastSeenRef.current = { crawlId, version: crawlVersion };
    if (previous?.crawlId !== crawlId || previous.version === crawlVersion) return;
    invalidateCrawlViews(queryClient, crawlId);
    if (projectId) invalidateMonitoredProjection(queryClient, projectId);
  }, [crawlId, crawlVersion, projectId, queryClient]);

  // Per-project monitored rows supply analysis progress totals. Automatic URL
  // admission owns membership; this query is display-only and cannot change
  // the crawl phase.
  const monitoredQuery = useQuery({
    ...siteHealthQueries.monitored(requestScope.workspaceId, requestScope.projectId),
    enabled: requestScope.enabled,
  });
  const projectSelectedTotal = useMemo(() => {
    const rows = monitoredQuery.data?.monitored_urls;
    if (!rows) return null;
    return rows.filter((row) => row.active).length;
  }, [monitoredQuery.data]);

  // The live score preview shares the exact first-page query key rendered by
  // ScoredInventory. During an active crawl that first view contains completed
  // rows only, so results appear progressively instead of rendering the whole
  // pre-seeded pending set at once. Once terminal, it returns to the complete
  // monitored projection.
  const pagesQuery = useQuery({
    ...siteHealthQueries.pages(
      requestScope.workspaceId,
      crawl?.id ?? '',
      monitoredPagePreviewParams(active),
    ),
    enabled: canLoadPagePreview(requestScope.enabled, crawl?.id, phase),
  });

  // The one thing still derived from the phase: what the always-mounted
  // inventory section renders. The crawl rides along so a FAILED terminal
  // phase keeps the scored page browser (the Errors & Blocked tab renders
  // the root-failure block).
  const inventoryMode: InventoryMode = inventoryModeForPhase(phase, crawl);
  // Surface a failed monitored-count fetch rather than silently disabling the
  // analysis view: the count query is best-effort (the counters degrade to the
  // visible window), but the error is exposed so the screen can note it.
  const projectSelectedError = monitoredQuery.isError;

  // "Starting a crawl" spans two distinct phases: the POST that creates the
  // crawl, and the projection refresh that first shows it. The mutation owns
  // only the first — it settles at POST success, so a slow or failed
  // projection refetch can neither extend the mutation lifecycle (and disable
  // the control indefinitely) nor report a failure for a crawl that already
  // exists. The `starting` state carries the button guard and strip notice
  // through the refresh window; the refresh continuation below releases it.
  // Each attempt carries a token, and every callback applies its state change
  // only while its token is still the active one — a late callback from an
  // earlier creation (e.g. the reader switched projects mid-POST) can refresh
  // that project's projection but can neither overwrite nor clear a newer
  // attempt's state.
  const [starting, setStarting] = useState<{
    projectId: string;
    crawlId: string | null;
    token: number;
  } | null>(null);
  const createAttemptRef = useRef(0);

  const createMutation = useMutation({
    ...siteHealthMutations.createCrawl(requestScope.workspaceId),
    onMutate: (variables) => {
      createAttemptRef.current += 1;
      const token = createAttemptRef.current;
      setStarting({ projectId: variables.project_id, crawlId: null, token });
      return { token };
    },
    onSuccess: (crawl, variables, context) => {
      const token = context.token;
      if (token === createAttemptRef.current) {
        setStarting({ projectId: variables.project_id, crawlId: crawl.id, token });
      }
      // The create response is a crawl row, while this screen is driven by the
      // backend's crawl + phase projection. Refresh the full projection in the
      // background — the starting state releases when it lands, not when the
      // POST resolves. Automatic admission also adds the root to the monitored
      // set, so its project-scoped count must refresh in the same window.
      void (async () => {
        // Stop any in-flight dashboard fetch first, so a pre-create answer
        // cannot commit after creation and read as the acknowledgement.
        await queryClient.cancelQueries({
          queryKey: queryKeys.siteHealth.dashboard(variables.project_id),
        });
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: queryKeys.siteHealth.dashboard(variables.project_id),
          }),
          queryClient.invalidateQueries({
            queryKey: queryKeys.siteHealth.monitored(variables.project_id),
          }),
        ]);
        // The projection has now answered for the created crawl (a refetch
        // failure also resolves here — bounded by the client's request
        // timeout), so show the refreshed state instead of a permanent
        // "Starting…" notice. A stale attempt never clears a newer one.
        setStarting((current) => (current?.token === token ? null : current));
      })();
    },
    onError: (_error, _variables, context) => {
      if (context?.token === createAttemptRef.current) setStarting(null);
    },
  });
  const cancelMutation = useMutation({
    ...siteHealthMutations.cancelCrawl(requestScope.workspaceId),
    onSuccess: async () => {
      if (!projectId) return;
      // Cancellation also changes the server-owned phase. Refresh the whole
      // projection atomically instead of pairing the terminal crawl row with
      // an active phase in the client cache.
      await queryClient.invalidateQueries({
        queryKey: queryKeys.siteHealth.dashboard(projectId),
      });
    },
  });
  const startCrawl = (input?: StartCrawlInput) =>
    requestScope.enabled && createMutation.mutate(input ?? { project_id: requestScope.projectId });
  // Reruns the shown crawl's scope, so Changes always has a comparable baseline.
  const recrawl = () =>
    crawl && startCrawl({ project_id: requestScope.projectId, recrawl_of: crawl.id });
  const cancelCrawl = () => crawl && cancelMutation.mutate(crawl.id);

  // A create is genuinely in flight, or its projection refresh has not yet
  // acknowledged it: the button says "Starting…" and a second click cannot
  // fire a duplicate. Scoped to the create's own project so a sticky state
  // from another project (after a project switch) can never disable this
  // screen's control.
  const startPending = starting?.projectId === projectId;

  const runExport = async (format: ExportFormat, view: ExportView) => {
    if (!crawl) return;
    setExportError(null);
    setExporting(true);
    try {
      await downloadCrawlExport(crawl.id, format, view, {
        workspaceId: requestScope.workspaceId,
      });
    } catch {
      setExportError('Export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  return {
    dashboardQuery,
    pagesQuery,
    monitoredQuery,
    crawl,
    active,
    stalled,
    phase,
    inventoryMode,
    projectSelectedTotal,
    projectSelectedError,
    startPending,
    createMutation,
    cancelMutation,
    startCrawl,
    recrawl,
    cancelCrawl,
    runExport,
    exporting,
    exportError,
  };
}
