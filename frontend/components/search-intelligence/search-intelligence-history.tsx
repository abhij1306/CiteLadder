import { useQuery } from '@tanstack/react-query';
import { AppGrid } from '@/components/ui/app-grid';
import { Stack } from '@/components/ui/layout';
import { Skeleton } from '@/components/ui/skeleton';
import { AreaChart } from '@/components/ui/area-chart';
import { type TrendPoint } from '@/components/ui/series-data';
import { textRole } from '@/components/ui/typography';
import {
  searchIntelligenceQueries,
  type SearchIntelligenceDataset,
} from '@/lib/api/search-intelligence';
import { formatCount, formatMonth, formatWindowDate } from '@/lib/format';
import { useProjectScope } from '@/lib/project/active-project-scope';
import { Section, SectionHeader, SectionTitle } from '@/components/ui/section';
import { Notice, readErrorProps } from '@/components/ui/notice';
import { StateBlock } from '@/components/ui/state-block';

type HistoryRow = {
  date: string;
  backlinks: number | null;
  new: number | null;
  lost: number | null;
};

function useHistory(datasetId: string) {
  const { workspaceId, projectId } = useProjectScope();
  return useQuery(searchIntelligenceQueries.datasetHistory({ workspaceId, projectId }, datasetId));
}

export function SearchIntelligenceHistory({
  dataset,
}: Readonly<{ dataset: SearchIntelligenceDataset }>) {
  const query = useHistory(dataset.id);
  return (
    <Section aria-labelledby="backlink-history">
      <SectionHeader>
        <SectionTitle id="backlink-history">Backlink history</SectionTitle>
      </SectionHeader>
      <HistoryBody query={query} />
    </Section>
  );
}

function HistoryBody({ query }: Readonly<{ query: ReturnType<typeof useHistory> }>) {
  if (query.isError)
    return (
      <Notice
        kind="read"
        {...readErrorProps(query)}
        fallback="Saved history could not be loaded."
        title="Saved history could not be loaded"
      />
    );
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
      <StateBlock
        kind="empty"
        inline
        message="History needs at least two saved observations to show a trend."
      />
    );
  const data = fillMonths(observations, first.date, last.date);
  const points = (value: (row: HistoryRow) => number | null): TrendPoint[] =>
    data.map((row) => ({
      label: formatMonth(row.date),
      value: value(row),
    }));
  return (
    <AppGrid layout="halves">
      <p className={textRole('caption', 'shell:col-span-2')}>
        {formatWindowDate(first.date)} to {formatWindowDate(last.date)}
      </p>
      <Stack gap="compact" className="min-w-0 content-start">
        <h3 className={textRole('subheading', 'min-h-6')}>Total backlinks</h3>
        <AreaChart
          label="Saved monthly backlink totals"
          name="Backlinks"
          data={points((row) => row.backlinks)}
          yFormat={compactCount}
          format={formatCount}
          you={false}
        />
      </Stack>
      <Stack gap="compact" className="min-w-0 content-start">
        <h3 className={textRole('subheading', 'min-h-6')}>Monthly changes</h3>
        <AreaChart
          label="Saved monthly new and lost backlinks"
          name="New backlinks"
          data={points((row) => row.new)}
          series={[{ label: 'Lost backlinks', values: data.map((row) => row.lost) }]}
          yFormat={compactCount}
          format={formatCount}
          you={false}
        />
      </Stack>
    </AppGrid>
  );
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
