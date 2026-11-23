import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import type { AgentView } from '@citeladder/contracts/agent-views';
import { ViewFrame, ViewRead } from '@/components/agent/thread-view-frame';
import { OverviewFigures, RequestsByPurpose } from '@/components/ai-traffic/overview-signals';
import { useSourceStep } from '@/components/integrations/data-sources';
import { EvidenceDrawer } from '@/components/search-intelligence/search-intelligence-dataset-view';
import {
  SearchIntelligenceRows,
  searchIntelligenceColumns,
} from '@/components/search-intelligence/search-intelligence-rows-table';
import { ScoreSection } from '@/components/site-health/score-section';
import { DataTable } from '@/components/ui/data-table';
import { Stack } from '@/components/ui/layout';
import { crawlLogsAvailable, useCrawlSources } from '@/lib/ai-traffic/use-crawl-connections';
import { aiTrafficQueries } from '@/lib/api/ai-traffic';
import {
  searchIntelligenceQueries,
  type SearchIntelligenceRow,
} from '@/lib/api/search-intelligence';
import { siteHealthQueries } from '@/lib/api/site-health-queries';
import { agentViewHref } from '@/lib/agent/view-links';

type Scope = Readonly<{ workspaceId: string; projectId: string }>;
type ViewOf<Kind extends AgentView['kind']> = Extract<AgentView, { kind: Kind }>;

const KEYWORD_ROWS = 10;

export function SiteHealthView({
  scope,
  view,
}: Readonly<{ scope: Scope; view: ViewOf<'site_health_summary'> }>) {
  const query = useQuery(siteHealthQueries.dashboard(scope, view.crawl_id ?? undefined));
  return (
    <ViewFrame title="Site Health" href={agentViewHref(view)}>
      <ViewRead query={query} subject="Site Health" shape={{ kind: 'figures' }}>
        {(dashboard) => <ScoreSection crawl={dashboard.crawl} dashboard={dashboard} />}
      </ViewRead>
    </ViewFrame>
  );
}

export function AiTrafficView({
  scope,
  view,
}: Readonly<{ scope: Scope; view: ViewOf<'ai_traffic_overview'> }>) {
  const query = useQuery(aiTrafficQueries.overview(scope, { range: view.range }));
  const sources = useCrawlSources(scope.projectId, scope.workspaceId);
  const ga4 = useSourceStep(scope.workspaceId, scope.projectId, 'ga4');
  const crawlAvailable = sources.data ? crawlLogsAvailable(sources.data) : true;
  const read = { ...query, isPending: query.isPending || sources.isPending };
  return (
    <ViewFrame title="AI traffic" href={agentViewHref(view)}>
      <ViewRead query={read} subject="AI traffic" shape={{ kind: 'figures' }}>
        {(data) => (
          <Stack gap="workspace" className="min-w-0">
            <OverviewFigures
              data={data}
              projectId={scope.projectId}
              crawlAvailable={crawlAvailable}
              ga4={ga4}
            />
            {data.crawl.series.length ? <RequestsByPurpose series={data.crawl.series} /> : null}
          </Stack>
        )}
      </ViewRead>
    </ViewFrame>
  );
}

export function KeywordRowsView({
  scope,
  view,
}: Readonly<{ scope: Scope; view: ViewOf<'keyword_research_rows'> }>) {
  const [order, setOrder] = useState<{ sort: string; direction: 'asc' | 'desc' }>({
    sort: 'id',
    direction: 'asc',
  });
  const [selected, setSelected] = useState<SearchIntelligenceRow | null>(null);
  const query = useQuery(
    searchIntelligenceQueries.datasetRows(scope, view.dataset_id, {
      ...order,
      limit: KEYWORD_ROWS,
    }),
  );
  const kind = query.data?.dataset.dataset_kind ?? null;
  return (
    <ViewFrame title="Keyword research" href={agentViewHref(view, kind)}>
      <ViewRead query={query} subject="the saved rows" shape={{ kind: 'table' }}>
        {(page) => (
          <>
            <DataTable
              label={page.dataset.target_hostname}
              columns={searchIntelligenceColumns({
                kind: page.dataset.dataset_kind,
                order,
                onSort: (sort) =>
                  setOrder({
                    sort,
                    direction: order.sort === sort && order.direction === 'asc' ? 'desc' : 'asc',
                  }),
              })}
              rowCount={page.items.length}
              pageSize={KEYWORD_ROWS}
              busy={{ active: query.isFetching, label: 'Updating saved rows' }}
              state={
                page.items.length
                  ? undefined
                  : { kind: 'empty', headingLevel: 3, heading: 'No saved rows in this dataset' }
              }
            >
              <SearchIntelligenceRows
                kind={page.dataset.dataset_kind}
                rows={page.items}
                onSelect={setSelected}
              />
            </DataTable>
            <EvidenceDrawer selected={selected} onClose={() => setSelected(null)} />
          </>
        )}
      </ViewRead>
    </ViewFrame>
  );
}
