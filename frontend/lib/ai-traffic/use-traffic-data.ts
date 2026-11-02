import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useProjectContext } from '@/lib/project/project-context';
import { aiTrafficApi, aiTrafficQueries } from '@/lib/api/ai-traffic';
import { stringUrlCodec, optionalStringUrlCodec, useUrlState } from '@/lib/navigation/url-state';
import { useCursorTable } from '@/lib/table/use-cursor-table';
import { saveBlob } from '@/lib/download';
import { TRAFFIC_RANGES, VERIFICATION_OPTIONS } from '@/lib/config/crawl-logs';
export type TrafficDataTab = 'overview' | 'crawlers' | 'activity' | 'pages';
const rangeCodec = stringUrlCodec(
  TRAFFIC_RANGES.map((t) => t.value),
  TRAFFIC_RANGES[0].value,
);
const verificationCodec = stringUrlCodec(
  VERIFICATION_OPTIONS.map((t) => t.value),
  'default',
);
function useTrafficSelection() {
  const [range, setRange] = useUrlState('range', rangeCodec),
    [verification, setVerification] = useUrlState('verification', verificationCodec);
  const [purpose, setPurpose] = useUrlState('purpose', optionalStringUrlCodec),
    [bot, setBot] = useUrlState('bot', optionalStringUrlCodec);
  const [status, setStatus] = useUrlState('status', optionalStringUrlCodec),
    [folder, setFolder] = useUrlState('folder', optionalStringUrlCodec);
  const [resource, setResource] = useUrlState('resource', optionalStringUrlCodec);
  const [pattern, setPattern] = useUrlState('pattern', optionalStringUrlCodec);
  const [sort, setSort] = useUrlState(
    'sort',
    stringUrlCodec(
      ['requests_desc', 'sessions_desc', 'key_events_desc', 'citations_desc', 'url_asc'],
      'requests_desc',
    ),
  );
  return {
    range,
    setRange,
    verification,
    setVerification,
    purpose,
    setPurpose,
    bot,
    setBot,
    status,
    setStatus,
    folder,
    setFolder,
    resource,
    setResource,
    sort,
    setSort,
    pattern,
    setPattern,
  };
}
function selectedFilters(tab: TrafficDataTab, selection: ReturnType<typeof useTrafficSelection>) {
  const { range, verification, folder, resource } = selection;
  return {
    range,
    verification: verification === 'default' ? undefined : verification,
    folder: tab === 'overview' ? undefined : folder || undefined,
    resource_class: tab === 'overview' ? undefined : resource || undefined,
    ...viewFilters(tab, selection),
  };
}
function viewFilters(tab: TrafficDataTab, selection: ReturnType<typeof useTrafficSelection>) {
  if (tab === 'crawlers') return { purpose: selection.purpose };
  if (tab === 'pages') return { sort: selection.sort, pattern: selection.pattern };
  if (tab === 'activity') {
    const status = selection.status;
    return {
      bot_id: selection.bot,
      status: status && /^[1-5]\d{2}$/u.test(status) ? Number(status) : undefined,
    };
  }
  return {};
}
/**
 * Start the Overview tab's reads together, before the tab is chosen.
 *
 * The screen picks its default tab from crawl log availability, and the
 * insights strip mounts only under a rendered overview, so left to the tree
 * the three reads ran in series: sources, then overview, then insights. None
 * needs another's answer. Warming overview and insights here, under the keys
 * the tab reads, runs all three side by side.
 */
export function useOverviewWarmup(active: boolean) {
  const client = useQueryClient();
  const { activeProject } = useProjectContext();
  const workspaceId = activeProject?.workspace_id ?? '',
    projectId = activeProject?.id ?? '';
  const { range, verification } = selectedFilters('overview', useTrafficSelection());
  const ready = active && !!workspaceId && !!projectId;
  useEffect(() => {
    if (!ready) return;
    // The overview's own filters: its folder and resource narrowing are unset,
    // and an unset filter is absent from both the key and the request.
    void client.prefetchQuery(
      aiTrafficQueries.overview(workspaceId, projectId, { range, verification }),
    );
    void client.prefetchQuery(aiTrafficQueries.insights(workspaceId, projectId, range));
  }, [client, ready, workspaceId, projectId, range, verification]);
}

export function useTrafficData(tab: TrafficDataTab) {
  const { activeProject, isLoading } = useProjectContext();
  const workspaceId = activeProject?.workspace_id ?? '',
    projectId = activeProject?.id ?? '';
  const options = { workspaceId },
    enabled = !!workspaceId && !!projectId;
  const selection = useTrafficSelection(),
    filters = selectedFilters(tab, selection);
  const pager = useCursorTable(JSON.stringify([workspaceId, projectId, tab, filters]));
  const tableFilters = { ...filters, cursor: pager.cursor, limit: pager.pageSize };
  const summary = useQuery({
    ...aiTrafficQueries.overview(workspaceId, projectId, filters),
    enabled: enabled && tab === 'overview',
  });
  const crawlers = useQuery({
    ...aiTrafficQueries.crawlers(workspaceId, projectId, tableFilters),
    enabled: enabled && tab === 'crawlers',
  });
  const activity = useQuery({
    ...aiTrafficQueries.activity(workspaceId, projectId, tableFilters),
    enabled: enabled && tab === 'activity',
  });
  const pages = useQuery({
    ...aiTrafficQueries.pages(workspaceId, projectId, tableFilters),
    enabled: enabled && tab === 'pages',
  });
  const catalog = useQuery({
    ...aiTrafficQueries.catalog(workspaceId, projectId),
    enabled: enabled && tab !== 'overview',
  });
  const exporting = useMutation({
    mutationFn: async () => {
      if (tab === 'overview') return;
      saveBlob(
        await aiTrafficApi.export(projectId, tab, filters, options),
        'ai-traffic-' + tab + '.csv',
      );
    },
  });
  const current = { overview: summary, crawlers, activity, pages }[tab];
  const next = {
    overview: null,
    crawlers: crawlers.data?.next_cursor,
    activity: activity.data?.next_cursor,
    pages: pages.data?.next_cursor,
  }[tab];
  return {
    tab,
    isLoading,
    workspaceId,
    projectId,
    selection,
    pager,
    summary,
    crawlers,
    activity,
    pages,
    catalog,
    exporting,
    current,
    next,
  };
}
