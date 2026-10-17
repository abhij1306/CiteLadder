import { useQuery } from '@tanstack/react-query';
import { Line, LineChart, XAxis, YAxis, Tooltip } from 'recharts';
import { axisProps, ChartContainer, LegendSwatch } from '@/components/ui/chart';
import { InlineEmpty } from '@/components/ui/inline-empty';
import { ReadError, readErrorProps } from '@/components/ui/read-error';
import { Skeleton } from '@/components/ui/skeleton';
import { textRole } from '@/components/ui/typography';
import {
  searchIntelligenceApi,
  type SearchIntelligenceDataset,
} from '@/lib/api/search-intelligence';
import { searchIntelligenceKeys } from '@/lib/api/query-keys/search-intelligence';
import { useProjectContext } from '@/lib/project/project-context';

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
  if (query.isPending) return <Skeleton className="h-48 w-full" />;
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
      <InlineEmpty>History needs at least two saved observations to show a trend.</InlineEmpty>
    );
  const data = fillMonths(observations, first.date, last.date);
  return (
    <section className="grid gap-4 md:grid-cols-2" aria-label="Saved backlink history">
      <p className={textRole('caption', 'md:col-span-2')}>
        Monthly domain-level history for {dataset.target_domain}, {first.date} to {last.date}.
        Coverage includes the provider’s historical link population and may differ from the live
        summary. Missing observations are gaps.
      </p>
      <div className="grid min-w-0 content-start gap-2">
        <h3 className={textRole('itemTitle', 'flex min-h-6 items-center gap-2')}>
          <LegendSwatch color="var(--color-chart-1)" shape="line" />
          Total backlinks
        </h3>
        <ChartContainer
          config={{ backlinks: { label: 'Backlinks', color: 'var(--color-chart-1)' } }}
          size="md"
          description="Saved monthly backlink totals; missing observations break the line."
        >
          <LineChart data={data}>
            <XAxis {...axisProps} dataKey="date" tickFormatter={shortMonth} />
            <YAxis {...axisProps} width={48} tickFormatter={compactCount} />
            <Tooltip />
            <Line
              dataKey="backlinks"
              stroke="var(--color-backlinks)"
              connectNulls={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ChartContainer>
      </div>
      <div className="grid min-w-0 content-start gap-2">
        <div className="flex min-h-6 flex-wrap items-center gap-x-4 gap-y-1">
          <h3 className={textRole('itemTitle')}>Monthly changes</h3>
          <div className="type-caption flex flex-wrap gap-x-4 gap-y-1">
            <span className="flex items-center gap-2">
              <LegendSwatch color="var(--color-chart-2)" shape="line" />
              New backlinks
            </span>
            <span className="flex items-center gap-2">
              <LegendSwatch color="var(--color-chart-3)" shape="line" />
              Lost backlinks
            </span>
          </div>
        </div>
        <ChartContainer
          config={{
            new: { label: 'New backlinks', color: 'var(--color-chart-2)' },
            lost: { label: 'Lost backlinks', color: 'var(--color-chart-3)' },
          }}
          size="md"
          description="Saved monthly new and lost backlinks, shown as separate labelled lines."
        >
          <LineChart data={data}>
            <XAxis {...axisProps} dataKey="date" tickFormatter={shortMonth} />
            <YAxis {...axisProps} width={48} tickFormatter={compactCount} />
            <Tooltip />
            <Line
              name="New backlinks"
              dataKey="new"
              stroke="var(--color-new)"
              connectNulls={false}
              isAnimationActive={false}
            />
            <Line
              name="Lost backlinks"
              dataKey="lost"
              stroke="var(--color-lost)"
              strokeDasharray="5 3"
              connectNulls={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ChartContainer>
      </div>
    </section>
  );
}

function shortMonth(date: string): string {
  return `${date.slice(5, 7)}/${date.slice(2, 4)}`;
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
function fillMonths(
  rows: { date: string; backlinks: number | null; new: number | null; lost: number | null }[],
  firstDate: string,
  lastDate: string,
) {
  const byMonth = new Map(rows.map((row) => [row.date.slice(0, 7), row]));
  const start = new Date(`${firstDate.slice(0, 7)}-01T00:00:00Z`);
  const end = lastDate.slice(0, 7);
  const result = [];
  while (start.toISOString().slice(0, 7) <= end) {
    const month = start.toISOString().slice(0, 7);
    result.push(byMonth.get(month) ?? { date: month, backlinks: null, new: null, lost: null });
    start.setUTCMonth(start.getUTCMonth() + 1);
  }
  return result;
}
