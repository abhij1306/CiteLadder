import { useQuery } from '@tanstack/react-query';
import { AppGrid } from '@/components/ui/app-grid';
import { formatChartCount } from '@/components/ui/chart';
import { Stack } from '@/components/ui/layout';
import { QueryState } from '@/components/ui/query-state';
import { ReadError, readErrorProps } from '@/components/ui/read-error';
import { Skeleton } from '@/components/ui/skeleton';
import { TrendChart, type TrendPoint } from '@/components/ui/trend-chart';
import { textRole } from '@/components/ui/typography';
import {
  searchIntelligenceApi,
  type SearchIntelligenceDataset,
} from '@/lib/api/search-intelligence';
import { searchIntelligenceKeys } from '@/lib/api/query-keys/search-intelligence';
import { useProjectContext } from '@/lib/project/project-context';

/** One month of saved history; a null value is an unobserved month and draws as a gap. */
type HistoryRow = {
  date: string;
  backlinks: number | null;
  new: number | null;
  lost: number | null;
};

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
  if (query.isPending) return <Skeleton variant="chart" />;
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
  const points = (value: (row: HistoryRow) => number | null): TrendPoint[] =>
    data.map((row) => ({
      label: longMonth(row.date),
      axisLabel: shortMonth(row.date),
      value: value(row),
    }));
  return (
    <AppGrid as="section" layout="halves" aria-label="Saved backlink history">
      <p className={textRole('caption', 'shell:col-span-2')}>
        Monthly domain-level history for {dataset.target_domain}, {first.date} to {last.date}.
        Coverage includes the provider’s historical link population and may differ from the live
        summary. Missing observations are gaps.
      </p>
      <Stack gap="compact" className="min-w-0 content-start">
        <h3 className={textRole('itemTitle', 'min-h-6')}>Total backlinks</h3>
        <TrendChart
          label="Saved monthly backlink totals"
          name="Backlinks"
          data={points((row) => row.backlinks)}
          yFormat={compactCount}
          format={formatChartCount}
        />
      </Stack>
      <Stack gap="compact" className="min-w-0 content-start">
        <h3 className={textRole('itemTitle', 'min-h-6')}>Monthly changes</h3>
        <TrendChart
          label="Saved monthly new and lost backlinks"
          name="New backlinks"
          data={points((row) => row.new)}
          series={[{ label: 'Lost backlinks', values: data.map((row) => row.lost) }]}
          yFormat={compactCount}
          format={formatChartCount}
        />
      </Stack>
    </AppGrid>
  );
}

/** `2026-07` → `07/26`, under the axis. */
function shortMonth(date: string): string {
  return `${date.slice(5, 7)}/${date.slice(2, 4)}`;
}

/** `2026-07` → `Jul 2026`, in the hover card and the table. */
function longMonth(date: string): string {
  return new Date(`${date.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function compactCount(value: number): string {
  return Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 0 }).format(value);
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
