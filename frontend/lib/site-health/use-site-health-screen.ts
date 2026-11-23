import { useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';

import { TABLE_DEFAULT_PAGE_SIZE } from '@/lib/config/tables';
import {
  type ExportFormat,
  type ExportView,
  type PageFilterParams,
  type StartCrawlInput,
} from '@/lib/api/site-health';
import { siteHealthMutations, siteHealthQueries } from '@/lib/api/site-health-queries';
import type { SiteCrawl, SiteHealthDashboard } from '@citeladder/contracts';
import { downloadCrawlExport } from '@/lib/site-health/download';
import { useProjectScope } from '@/lib/project/active-project-scope';
import { optionalStringUrlCodec, useUrlState } from '@/lib/navigation/url-state';
import { useLiveCrawlDashboard } from '@/lib/site-health/use-live-crawl-dashboard';
import {
  DEFAULT_PAGES_SORT,
  inventoryModeForPhase,
  isCrawlStalled,
  CRAWL_STATES,
  type InventoryMode,
  type SiteHealthPhase,
} from '@/lib/site-health/status';

export function monitoredPagePreviewParams(active: boolean) {
  return {
    limit: TABLE_DEFAULT_PAGE_SIZE,
    monitored: true,
    status: active ? 'completed' : undefined,
    sort: DEFAULT_PAGES_SORT,
  };
}

function canLoadPagePreview(crawlId: string | undefined, phase: SiteHealthPhase): boolean {
  return Boolean(crawlId) && (phase === 'analyzing' || phase === 'dashboard');
}

export function pagePreviewQuery(workspaceId: string, dashboard: SiteHealthDashboard | null) {
  const crawl = dashboard?.crawl ?? null;
  const phase: SiteHealthPhase = dashboard?.phase ?? 'resolving';
  if (!crawl || !canLoadPagePreview(crawl.id, phase)) return null;
  return siteHealthQueries.pages(
    workspaceId,
    crawl.id,
    monitoredPagePreviewParams(CRAWL_STATES[crawl.status].active),
  );
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
export function useSiteHealthScreen() {
  const { workspaceId, projectId } = useProjectScope();
  const requestScope = { workspaceId, projectId };
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const [pinnedCrawlId, setPinnedCrawlId] = useUrlState('crawl_id', optionalStringUrlCodec);
  const dashboardQuery = useLiveCrawlDashboard(requestScope, pinnedCrawlId ?? undefined);

  const crawl: SiteCrawl | null = dashboardQuery.data?.crawl ?? null;
  const active = crawl ? CRAWL_STATES[crawl.status].active : false;
  const stalled = isCrawlStalled(crawl);
  // THE phase, resolved server-side from the crawl and the project's monitored
  // set at one instant. `'resolving'` only means the
  // dashboard request has not landed yet — there is no client-side precedence
  // chain racing three independently-loading queries any more.
  const phase: SiteHealthPhase = dashboardQuery.data?.phase ?? 'resolving';

  const pagesQuery = useQuery({
    ...siteHealthQueries.pages(workspaceId, crawl?.id ?? '', monitoredPagePreviewParams(active)),
    enabled: canLoadPagePreview(crawl?.id, phase),
  });

  // The one thing still derived from the phase: what the always-mounted
  // inventory section renders. The crawl rides along so a FAILED terminal
  // phase keeps the scored page browser (the Errors & Blocked tab renders
  // the root-failure block).
  const inventoryMode: InventoryMode = inventoryModeForPhase(phase, crawl);

  const [starting, setStarting] = useState<{
    projectId: string;
    crawlId: string | null;
    token: number;
  } | null>(null);
  const createAttemptRef = useRef(0);

  const createMutation = useMutation(siteHealthMutations.createCrawl(workspaceId));
  const cancelMutation = useMutation(siteHealthMutations.cancelCrawl(requestScope));
  const startCrawl = (input?: StartCrawlInput) => {
    const variables = input ?? { project_id: projectId };
    setPinnedCrawlId(null, 'replace');
    createAttemptRef.current += 1;
    const token = createAttemptRef.current;
    setStarting({ projectId: variables.project_id, crawlId: null, token });
    createMutation.mutate(variables, {
      onSuccess: (created, _variables, start) => {
        if (token === createAttemptRef.current)
          setStarting({ projectId: variables.project_id, crawlId: created.id, token });
        void Promise.resolve(start?.refreshed).finally(() =>
          setStarting((current) => (current?.token === token ? null : current)),
        );
      },
      onError: () => {
        if (token === createAttemptRef.current) setStarting(null);
      },
    });
  };
  const retryStart = () => startCrawl(createMutation.variables);
  const cancelCrawl = () => crawl && cancelMutation.mutate(crawl.id);

  const startPending = starting?.projectId === projectId;

  const runExport = async (format: ExportFormat, view: ExportView, filters?: PageFilterParams) => {
    if (!crawl) return;
    setExportError(null);
    setExporting(true);
    try {
      await downloadCrawlExport({ crawlId: crawl.id, format, view, filters }, { workspaceId });
    } catch {
      setExportError('Export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  return {
    dashboardQuery,
    pagesQuery,
    crawl,
    active,
    stalled,
    phase,
    inventoryMode,
    startPending,
    createMutation,
    cancelMutation,
    startCrawl,
    retryStart,
    cancelCrawl,
    runExport,
    exporting,
    exportError,
  };
}
