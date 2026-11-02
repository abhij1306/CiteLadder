import { useQuery } from '@tanstack/react-query';
import { lazy } from 'react';
import { ChartContainer, LegendSwatch } from '@/components/ui/chart';
import { Inline, Stack } from '@/components/ui/layout';
import { splitPaneClasses } from '@/components/ui/workspace';
import { QueryState } from '@/components/ui/query-state';
import { ReadError, readErrorProps } from '@/components/ui/read-error';
import { Skeleton } from '@/components/ui/skeleton';
import { textRole } from '@/components/ui/typography';
import {
  searchIntelligenceApi,
  type SearchIntelligenceDataset,
} from '@/lib/api/search-intelligence';
import { searchIntelligenceKeys } from '@/lib/api/query-keys/search-intelligence';
import { useProjectContext } from '@/lib/project/project-context';
import type { HistoryRow } from './search-intelligence-history-plot';

// The drawings are fetched when the history is drawn; each plot's box renders
// at once, so a plot arrives in a space already held.
const BacklinkTotalPlot = lazy(() =>
  import('./search-intelligence-history-plot').then(({ BacklinkTotalPlot }) => ({
    default: BacklinkTotalPlot,
  })),
);
const BacklinkChangesPlot = lazy(() =>
  import('./search-intelligence-history-plot').then(({ BacklinkChangesPlot }) => ({
    default: BacklinkChangesPlot,
  })),
);

export function SearchIntelligenceHistory({
  dataset,
}: Readonly<{ dataset: SearchIntelligenceDataset }>) {
  const { activeProject } = useProjectContext();
  const query = useQuery({
    queryKey: [
      ...searchIntelligenceKeys.dataset(activeProject?.workspace_id, activeProject?.id, dataset.id),
      'history',
    ],
    queryFn: ({ signal }) =>
      searchIntelligenceApi.rows(
        activeProject!.id,
        dataset.id,
        { signal, workspaceId: activeProject!.workspace_id },
        { limit: 200 },
      ),
    enabled: Boolean(activeProject),
  });
  if (query.isError)
    return <ReadError {...readErrorProps(query)} fallback="Saved history could not be loaded." />;
  if (query.isPending) return <Skeleton shape="chart" />;
  const rows = query.data.rows;
  const observations = rows
    .map((row) => ({
      date: String(row.auxiliary.date ?? '').slice(0, 10),
      backlinks: row.backlinks,
      new: numeric(row.auxiliary.new_backlinks),
      lost: numeric(row.auxiliary.lost_backlinks),
    }))
    .filter(({ date }) => validHistoryDate(date))
    .sort((left, right) => left.date.localeCompare(right.date));
  const [first] = observations;
  const last = observations.at(-1);
  if (!first || !last || observations.length < 2)
    return (
      <QueryState
        kind="empty"
        inline
        message="History needs at least two saved observations to show a trend."
      />
    );
  const data = fillMonths(observations, first.date, last.date);
  return (
    <section className={splitPaneClasses('peers')} aria-label="Saved backlink history">
      <p className={textRole('caption', 'desktop:col-span-2')}>
        Monthly domain-level history for {dataset.target_domain}, {first.date} to {last.date}.
        Coverage includes the provider’s historical link population and may differ from the live
        summary. Missing observations are gaps.
      </p>
      <Stack gap="compact" className="min-w-0 content-start">
        <Inline as="h3" className={textRole('itemTitle', 'min-h-6')}>
          <LegendSwatch color="var(--color-chart-1)" shape="line" />
          Total backlinks
        </Inline>
        <ChartContainer
          config={{ backlinks: { label: 'Backlinks', color: 'var(--color-chart-1)' } }}
          description="Saved monthly backlink totals; missing observations break the line."
        >
          <BacklinkTotalPlot data={data} />
        </ChartContainer>
      </Stack>
      <Stack gap="compact" className="min-w-0 content-start">
        <Inline gap="meta" className="min-h-6">
          <h3 className={textRole('itemTitle')}>Monthly changes</h3>
          <Inline gap="meta" className="type-caption">
            <Inline as="span">
              <LegendSwatch color="var(--color-chart-2)" shape="line" />
              New backlinks
            </Inline>
            <Inline as="span">
              <LegendSwatch color="var(--color-chart-3)" shape="line" />
              Lost backlinks
            </Inline>
          </Inline>
        </Inline>
        <ChartContainer
          config={{
            new: { label: 'New backlinks', color: 'var(--color-chart-2)' },
            lost: { label: 'Lost backlinks', color: 'var(--color-chart-3)' },
          }}
          description="Saved monthly new and lost backlinks, shown as separate labelled lines."
        >
          <BacklinkChangesPlot data={data} />
        </ChartContainer>
      </Stack>
    </section>
  );
}

function numeric(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function validHistoryDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

/** One row per month from the first date's month to the last's; missing months are gaps. */
function fillMonths(rows: HistoryRow[], firstDate: string, lastDate: string): HistoryRow[] {
  const byMonth = new Map(rows.map((row) => [row.date.slice(0, 7), row]));
  const start = new Date(`${firstDate.slice(0, 7)}-01T00:00:00Z`);
  const end = lastDate.slice(0, 7);
  const result: HistoryRow[] = [];
  while (start.toISOString().slice(0, 7) <= end) {
    const month = start.toISOString().slice(0, 7);
    result.push(byMonth.get(month) ?? { date: month, backlinks: null, new: null, lost: null });
    start.setUTCMonth(start.getUTCMonth() + 1);
  }
  return result;
}
