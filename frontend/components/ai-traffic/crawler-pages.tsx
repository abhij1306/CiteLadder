import { useQuery } from '@tanstack/react-query';
import { Drawer } from '@/components/ui/drawer';
import { ReadError, readErrorProps } from '@/components/ui/read-error';
import { PageLoading } from '@/components/layout/page-loading';
import { Pager } from '@/components/ui/pager';
import { aiTrafficApi, type TrafficFilters } from '@/lib/api/ai-traffic';
import { queryKeys } from '@/lib/api/query-keys';
import { useProjectContext } from '@/lib/project/project-context';
import { cursorControls, useCursorTable } from '@/lib/table/use-cursor-table';
import { TrafficPages } from './pages-view';

export function CrawlerPages({
  botId,
  onClose,
  filters = {},
}: Readonly<{ botId: string | null; onClose: () => void; filters?: TrafficFilters }>) {
  const { activeProject } = useProjectContext(),
    workspaceId = activeProject?.workspace_id ?? '',
    projectId = activeProject?.id ?? '';
  const pager = useCursorTable(JSON.stringify([workspaceId, projectId, botId, filters]));
  const selected = { ...filters, bot_id: botId, cursor: pager.cursor, limit: pager.pageSize };
  const query = useQuery({
    queryKey: queryKeys.aiTraffic.view(workspaceId, projectId, 'crawler-pages', selected),
    queryFn: ({ signal }) => aiTrafficApi.pages(projectId, selected, { workspaceId, signal }),
    enabled: !!botId && !!workspaceId && !!projectId,
  });
  return (
    <Drawer
      open={!!botId}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Observed crawler pages"
      description="Joinable path observations for the selected crawler."
    >
      {query.isLoading ? <PageLoading label="Loading crawler paths…" /> : null}
      {query.isError ? (
        <ReadError {...readErrorProps(query)} fallback="Could not read crawler pages" />
      ) : null}
      {query.data && !query.isError ? (
        <>
          <TrafficPages data={query.data} filters={filters} />
          <Pager
            hideWhenSinglePage
            page={pager.page}
            {...cursorControls(pager, query.data.next_cursor)}
          />
        </>
      ) : null}
    </Drawer>
  );
}
