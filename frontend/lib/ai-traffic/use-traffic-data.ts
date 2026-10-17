import { useQuery, useMutation } from '@tanstack/react-query';
import { useProjectContext } from '@/lib/project/project-context';
import { aiTrafficApi } from '@/lib/api/ai-traffic';
import { queryKeys } from '@/lib/api/query-keys';
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
    queryKey: queryKeys.aiTraffic.view(workspaceId, projectId, 'overview', filters),
    queryFn: ({ signal }) => aiTrafficApi.overview(projectId, filters, { ...options, signal }),
    enabled: enabled && tab === 'overview',
  });
  const crawlers = useQuery({
    queryKey: queryKeys.aiTraffic.view(workspaceId, projectId, 'crawlers', tableFilters),
    queryFn: ({ signal }) => aiTrafficApi.crawlers(projectId, tableFilters, { ...options, signal }),
    enabled: enabled && tab === 'crawlers',
  });
  const activity = useQuery({
    queryKey: queryKeys.aiTraffic.view(workspaceId, projectId, 'activity', tableFilters),
    queryFn: ({ signal }) => aiTrafficApi.activity(projectId, tableFilters, { ...options, signal }),
    enabled: enabled && tab === 'activity',
  });
  const pages = useQuery({
    queryKey: queryKeys.aiTraffic.view(workspaceId, projectId, 'pages', tableFilters),
    queryFn: ({ signal }) => aiTrafficApi.pages(projectId, tableFilters, { ...options, signal }),
    enabled: enabled && tab === 'pages',
  });
  const catalog = useQuery({
    queryKey: queryKeys.aiTraffic.view(workspaceId, projectId, 'catalog'),
    queryFn: ({ signal }) => aiTrafficApi.catalog(projectId, { ...options, signal }),
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
