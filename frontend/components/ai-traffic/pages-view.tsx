import { Fragment, useState, type ReactNode } from 'react';
import type { z } from 'zod';
import type { aiTrafficPagesSchema } from '@citeladder/contracts/ai-traffic';
import { Absence } from '@/components/ui/absence';
import { DataTable, type DataTableColumn, type DataTableState } from '@/components/ui/data-table';
import { StatusMark } from '@/components/ui/status-mark';
import { TableCell, TableRow, TableTime, UrlText } from '@/components/ui/table';
import { Stack } from '@/components/ui/layout';
import { Pressable } from '@/components/ui/pressable';
import { TextLink } from '@/components/ui/text-link';
import { SearchX } from '@/lib/icons';
import type { TrafficPagesSort } from '@/lib/config/crawl-logs';
import { DisplayTime } from '@/components/ui/display-time';
import { aiTrafficQueries, type TrafficTableScope } from '@/lib/api/ai-traffic';
import { formatCount, formatPercent, ownOrigin } from '@/lib/format';
import { useProjectScope } from '@/lib/project/active-project-scope';
import { useCursorTableQuery } from '@/lib/table/use-cursor-table-query';
import { UrlPanel, TrafficLeg, trafficLegExplanation } from './url-panel';

type PageRow = z.infer<typeof aiTrafficPagesSchema>['items'][number];

const BLANK_LINE = ' ';

const SORT_BY_COLUMN: Readonly<Record<string, TrafficPagesSort>> = {
  path: 'url_asc',
  crawl: 'requests_desc',
  referrals: 'sessions_desc',
  'key-events': 'key_events_desc',
  citations: 'citations_desc',
};

const PAGE_COLUMNS: readonly DataTableColumn[] = [
  { key: 'path', label: 'Path', kind: 'identity' },
  { key: 'crawl', label: 'Requests', kind: 'number' },
  { key: 'referrals', label: 'Referrals', kind: 'number' },
  { key: 'citations', label: 'Citations', kind: 'number' },
  { key: 'coverage', label: 'Coverage', kind: 'status', width: 'category' },
  { key: 'key-events', label: 'Key events', kind: 'number', priority: 'low' },
  { key: 'findings', label: 'Findings', kind: 'number', priority: 'low' },
  { key: 'last-crawl', label: 'Last crawl', kind: 'date', priority: 'low' },
  { key: 'errors', label: '4xx / 5xx', kind: 'number', priority: 'low' },
];

const ABSENT: Readonly<Record<string, (row: PageRow) => boolean>> = {
  crawl: (row) => row.crawl.value === null,
  referrals: (row) => row.referrals.value === null,
  citations: (row) => row.citations.value === null,
  coverage: (row) => !partialCoverage(row),
  findings: (row) => row.findings.value === null,
  'key-events': (row) => row.key_events === null,
  'last-crawl': (row) => row.last_crawl === null,
  errors: (row) => row.errors_4xx === null && row.errors_5xx === null,
};

function measuredPageColumns<C extends Pick<DataTableColumn, 'key'>>(
  columns: readonly C[],
  rows: readonly PageRow[],
): C[] {
  if (!rows.length) return [...columns];
  return columns.filter((column) => {
    const absent = ABSENT[column.key];
    return !absent || !rows.every(absent);
  });
}

function pageColumns(
  sort: TrafficPagesSort | undefined,
  onSort: ((sort: TrafficPagesSort) => void) | undefined,
): readonly DataTableColumn[] {
  if (!sort || !onSort) return PAGE_COLUMNS;
  return PAGE_COLUMNS.map((column) => {
    const order = SORT_BY_COLUMN[column.key];
    if (!order) return column;
    return {
      ...column,
      sort: {
        active: sort === order,
        descending: order !== 'url_asc',
        onSort: () => onSort(order),
      },
    };
  });
}

const NOTHING_MEASURED: DataTableState = {
  kind: 'not_measured',
  description: 'No signal measured these paths in this window.',
};

export function TrafficPages({
  workspaceId,
  projectId,
  filters,
  sort,
  onSort,
}: TrafficTableScope &
  Readonly<{ sort?: TrafficPagesSort; onSort?: (sort: TrafficPagesSort) => void }>) {
  const [urlHash, setUrlHash] = useState<string | null>(null);
  const { page, table } = useCursorTableQuery({
    workspaceId,
    scopeId: projectId,
    scope: filters,
    query: (request) =>
      aiTrafficQueries.pages({ workspaceId, projectId }, { ...filters, ...request }),
    noun: 'paths',
    loading: 'Loading paths…',
    subject: 'the pages',
    empty: () => ({
      kind: 'empty',
      icon: SearchX,
      heading: 'No joinable paths were observed',
    }),
  });
  const rows = page?.items ?? [];
  const columns = measuredPageColumns(pageColumns(sort, onSort), rows);
  const nothingMeasured = rows.length > 0 && columns.length === 1;
  return (
    <Stack gap="workspace">
      <CoverageLine data={page} />
      <DataTable
        label="Path-level AI traffic with separate signal units"
        columns={columns}
        {...table}
        state={nothingMeasured ? NOTHING_MEASURED : table.state}
      >
        {rows.map((r) => (
          <TrafficPageRow key={r.url_hash} r={r} columns={columns} onOpen={setUrlHash} />
        ))}
      </DataTable>
      <UrlPanel
        urlHash={urlHash}
        onClose={() => setUrlHash(null)}
        fromRow
        filters={{
          range: filters.range,
          verification: filters.verification,
          bot_id: filters.bot_id,
        }}
      />
    </Stack>
  );
}

function Unavailable({ reason }: Readonly<{ reason: string }>) {
  return <Absence state="unavailable" reason={reason} />;
}

function partialCoverage(row: PageRow): boolean {
  return [row.crawl, row.referrals, row.citations, row.findings].some(
    (leg) => leg.value !== null && leg.coverage === 'partial',
  );
}

function TrafficErrors({ page }: Readonly<{ page: PageRow }>) {
  const reason = trafficLegExplanation(page.crawl, 'Crawler requests');
  if (page.errors_4xx === null && page.errors_5xx === null)
    return <Unavailable reason={`4xx and 5xx unavailable: ${reason}`} />;
  return (
    <>
      {page.errors_4xx ?? <Unavailable reason={`4xx unavailable: ${reason}`} />} /{' '}
      {page.errors_5xx ?? <Unavailable reason={`5xx unavailable: ${reason}`} />}
    </>
  );
}

const CELLS: Readonly<Record<string, (row: PageRow) => ReactNode>> = {
  crawl: (r) => (
    <TableCell numeric>
      <TrafficLeg leg={r.crawl} unit="requests" />
    </TableCell>
  ),
  referrals: (r) => (
    <TableCell numeric>
      <TrafficLeg leg={r.referrals} unit="sessions" />
    </TableCell>
  ),
  citations: (r) => (
    <TableCell numeric>
      <TrafficLeg leg={r.citations} unit="citations" />
    </TableCell>
  ),
  coverage: (r) => (
    <TableCell>
      {partialCoverage(r) ? <StatusMark tone="warning">Partial</StatusMark> : null}
    </TableCell>
  ),
  'key-events': (r) => (
    <TableCell numeric>
      {r.key_events === null ? (
        <Unavailable reason="Key events unavailable for this window." />
      ) : (
        formatCount(r.key_events)
      )}
    </TableCell>
  ),
  findings: (r) => (
    <TableCell numeric>
      <TrafficLeg leg={r.findings} unit="findings" />
    </TableCell>
  ),
  'last-crawl': (r) => (
    <TableCell>
      {r.last_crawl ? (
        <TableTime value={r.last_crawl} />
      ) : (
        <Unavailable reason="Last crawl unavailable for this window." />
      )}
    </TableCell>
  ),
  errors: (r) => (
    <TableCell numeric>
      <TrafficErrors page={r} />
    </TableCell>
  ),
};

function TrafficPageRow({
  r,
  columns,
  onOpen,
}: Readonly<{
  r: PageRow;
  columns: readonly DataTableColumn[];
  onOpen: (hash: string) => void;
}>) {
  const { project } = useProjectScope();
  return (
    <TableRow>
      <TableCell>
        <TextLink asChild text="inherit" underline="hover">
          <Pressable
            onClick={() => onOpen(r.url_hash)}
            className="flex w-auto max-w-full min-w-0"
            aria-label={`View AI traffic for ${r.canonical_url}`}
          >
            <UrlText
              url={r.canonical_url}
              origin={ownOrigin(r.canonical_url, project.website_url)}
            />
          </Pressable>
        </TextLink>
      </TableCell>
      {columns.map((column) => (
        <Fragment key={column.key}>{CELLS[column.key]?.(r)}</Fragment>
      ))}
    </TableRow>
  );
}

function CoverageLine({
  data,
}: Readonly<{ data: z.infer<typeof aiTrafficPagesSchema> | undefined }>) {
  if (!data) return <p className="type-caption">{BLANK_LINE}</p>;
  const coverage = data.observed_crawl_coverage;
  const disconnected = (
    [
      ['crawl', 'Crawler logs'],
      ['referrals', 'Referral analytics'],
      ['citations', 'Citation tracking'],
    ] as const
  ).filter(
    ([key]) =>
      data.items.length > 0 && data.items.every((row) => row[key].state === 'not_connected'),
  );
  let crawlCoverage: string | null =
    coverage.state === 'unknown' ? 'Crawl coverage unknown' : 'Crawl coverage unavailable';
  if (coverage.share !== null)
    crawlCoverage = `${coverage.label}: ${formatPercent(coverage.share)}`;
  else if (disconnected.some(([key]) => key === 'crawl')) crawlCoverage = null;
  const segments: Array<[string, ReactNode]> = [];
  if (disconnected.length)
    segments.push([
      'sources',
      `${disconnected.map(([, label]) => label).join(', ')} not connected`,
    ]);
  if (crawlCoverage) segments.push(['coverage', crawlCoverage]);
  segments.push(['pages', `${formatCount(coverage.known_pages)} known pages`]);
  if (coverage.inventory_date)
    segments.push([
      'inventory',
      <>
        Inventory <DisplayTime value={coverage.inventory_date} dateOnly />
      </>,
    ]);
  if (!coverage.inventory_complete) segments.push(['limited', 'Limited inventory']);
  if (coverage.sample_mode) segments.push(['sampled', 'Sampled inventory']);
  return (
    <p className="type-caption">
      {segments.map(([key, segment], index) => (
        <Fragment key={key}>
          {index ? ' · ' : null}
          {segment}
        </Fragment>
      ))}
    </p>
  );
}
