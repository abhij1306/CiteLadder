'use client';
import { useState } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { z } from 'zod';
import type {
  aiTrafficOverviewSchema,
  crawlCatalogSchema,
  crawlCoverageResponseSchema,
} from '@citeladder/contracts/ai-traffic';
import {
  aiTrafficQueries,
  type TrafficFilters,
  type TrafficTableScope,
} from '@/lib/api/ai-traffic';
import { useCursorTableQuery } from '@/lib/table/use-cursor-table-query';
import { coverageLabel, reasonLabel, words } from '@/lib/ai-traffic/vocabulary';
import { MISSING_MARK } from '@/lib/format';
import { CalendarX, SearchX } from 'lucide-react';
import { TabPanel } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Stack } from '@/components/ui/layout';
import { TableTime } from '@/components/ui/display-time';
import { readErrorProps } from '@/components/ui/read-error';
import { TableRow, TableCell, TableCellLines } from '@/components/ui/table';
import { CrawlLogConnections } from './crawl-log-connections';
import { InsightStrip } from './insight-strip';
import {
  CitationSignal,
  CrawlSignalPanel,
  ReferralSignal,
  RequestsByPurpose,
} from './overview-signals';
import { CrawlerPages } from './crawler-pages';
import { DataTable, type DataTableColumn, type DataTableState } from '@/components/ui/data-table';

const CRAWLER_COLUMNS: readonly DataTableColumn[] = [
  { key: 'crawler', label: 'Crawler', width: 'name' },
  { key: 'purpose', label: 'Purpose', width: 'category' },
  { key: 'requests', label: 'Requests', width: 'figure', numeric: true },
  { key: 'pages', label: 'Path-level pages', width: 'metric', numeric: true },
  { key: 'last-seen', label: 'Last observed', width: 'date', numeric: true },
  { key: 'status', label: 'Status and verification' },
  { key: 'breakdown', label: 'Folder and resource breakdown' },
];
const COVERAGE_COLUMNS: readonly DataTableColumn[] = [
  { key: 'day', label: 'Day', width: 'date' },
  { key: 'source', label: 'Source', width: 'name' },
  { key: 'coverage', label: 'Coverage' },
  { key: 'counts', label: 'Batch / heartbeat count', width: 'metric', numeric: true },
  { key: 'gap', label: 'Longest receipt gap', width: 'metric', numeric: true },
];

const ACTIVITY_COLUMNS: readonly DataTableColumn[] = [
  { key: 'observed', label: 'Observed', width: 'date', numeric: true },
  { key: 'bot', label: 'Bot', width: 'status' },
  { key: 'path', label: 'Host and path' },
  { key: 'resource', label: 'Resource', width: 'status' },
  { key: 'status', label: 'Status', width: 'figure', numeric: true },
  { key: 'verification', label: 'Verification' },
];
export function TrafficOverview({
  data,
  projectId,
  workspaceId,
  range,
  crawlAvailable,
}: Readonly<{
  data: z.infer<typeof aiTrafficOverviewSchema>;
  projectId: string;
  workspaceId: string;
  range: string;
  crawlAvailable: boolean;
}>) {
  const [connectOpen, setConnectOpen] = useState(false);
  const crawlConnected = data.crawl.connection !== 'not_connected';
  return (
    <TabPanel value="overview">
      <Stack gap="workspace">
        <InsightStrip projectId={projectId} workspaceId={workspaceId} range={range} />
        <Stack gap="workspace" className="desktop:grid-cols-3">
          <CrawlSignalPanel
            data={data.crawl}
            available={crawlAvailable}
            onConnect={() => setConnectOpen(true)}
          />
          <ReferralSignal data={data.referrals} />
          <CitationSignal data={data.citations} projectId={projectId} />
        </Stack>
        {data.crawl.series.length ? <RequestsByPurpose series={data.crawl.series} /> : null}
        {crawlAvailable ? (
          <CrawlLogConnections
            open={connectOpen}
            onOpenChange={setConnectOpen}
            headerWhenEmpty={false}
          />
        ) : null}
        {crawlConnected ? (
          <CoverageTable projectId={projectId} workspaceId={workspaceId} range={range} />
        ) : null}
      </Stack>
    </TabPanel>
  );
}
/**
 * Absence in a filtered table is an observation within the available logs,
 * not proof of no traffic; with crawl logs connectable, the setup follows.
 */
function noMatches(heading: string, description: string): DataTableState {
  return { kind: 'empty', icon: SearchX, heading, description };
}
/** A drawer opened from a row reads the table's window, not its narrowing. */
function windowFilters(filters: TrafficFilters): TrafficFilters {
  return { range: filters.range, verification: filters.verification };
}
export function TrafficCrawlers({ workspaceId, projectId, filters }: TrafficTableScope) {
  const [botId, setBotId] = useState<string | null>(null);
  const { page, table } = useCursorTableQuery({
    workspaceId,
    scopeId: projectId,
    scope: filters,
    query: (request) =>
      aiTrafficQueries.crawlers(workspaceId, projectId, { ...filters, ...request }),
    noun: 'crawlers',
    loading: 'Loading crawlers…',
    error: 'Could not read crawlers',
    empty: () =>
      noMatches(
        'No matching requests were observed',
        'Check coverage on Overview before interpreting absence in the available logs.',
      ),
  });
  return (
    <TabPanel value="crawlers">
      <Stack gap="workspace">
        {/* Status and breakdown stack their qualifiers: two-line rows. */}
        <DataTable
          label="Recognized crawlers"
          columns={CRAWLER_COLUMNS}
          minWidth="xl"
          rowLines={2}
          {...table}
        >
          {page?.items.map((b) => (
            <TableRow key={b.bot_id}>
              <TableCell>{b.label}</TableCell>
              <TableCell>{words(b.purpose)}</TableCell>
              <TableCell numeric>{b.requests}</TableCell>
              <TableCell numeric>
                <Button
                  variant="ghost"
                  onClick={() => setBotId(b.bot_id)}
                  aria-label={`View paths requested by ${b.label}`}
                >
                  {b.pages ?? MISSING_MARK} paths
                </Button>
              </TableCell>
              <TableCell numeric>
                <TableTime value={b.last_seen} />
              </TableCell>
              <TableCell>
                <CellLines
                  lines={[
                    entries(b.status_codes),
                    entries(b.verification),
                    reasonEntries(b.verification_reasons),
                  ]}
                />
              </TableCell>
              <TableCell>
                <CellLines lines={[entries(b.folders), entries(b.resources)]} />
              </TableCell>
            </TableRow>
          ))}
        </DataTable>
        {page?.items.length === 0 ? <CrawlLogConnections /> : null}
      </Stack>
      <CrawlerPages
        botId={botId}
        onClose={() => setBotId(null)}
        workspaceId={workspaceId}
        projectId={projectId}
        filters={windowFilters(filters)}
      />
    </TabPanel>
  );
}
/**
 * What the activity table shows while the crawler catalog cannot name its
 * bots: rows of raw bot ids would read as findings, so the catalog's own
 * loading or failure takes the table's place, in the same footprint.
 */
function catalogState(
  catalog: UseQueryResult<z.infer<typeof crawlCatalogSchema>>,
): DataTableState | undefined {
  if (catalog.isError && !catalog.data)
    return {
      kind: 'error',
      ...readErrorProps(catalog),
      fallback: 'Could not read the crawler catalog, so bots cannot be named',
    };
  if (catalog.isPending) return { kind: 'loading', label: 'Loading the crawler catalog…' };
  return undefined;
}
export function TrafficActivity({ workspaceId, projectId, filters }: TrafficTableScope) {
  // The screen's controls read the same entry, so this adds no request.
  const catalog = useQuery(aiTrafficQueries.catalog(workspaceId, projectId));
  const { page, table } = useCursorTableQuery({
    workspaceId,
    scopeId: projectId,
    scope: filters,
    query: (request) =>
      aiTrafficQueries.activity(workspaceId, projectId, { ...filters, ...request }),
    noun: 'requests',
    loading: 'Loading request activity…',
    error: 'Could not read request activity',
    empty: () =>
      noMatches(
        'No matching requests',
        'Nothing in the available retained logs matches these filters.',
      ),
  });
  return (
    <TabPanel value="activity">
      <Stack gap="workspace">
        <DataTable
          label="Retained automated request activity"
          columns={ACTIVITY_COLUMNS}
          minWidth="md"
          rowLines={2}
          {...table}
          state={catalogState(catalog) ?? table.state}
        >
          {page?.items.map((r) => (
            <TableRow key={r.id}>
              <TableCell numeric>
                <TableTime value={r.occurred_at} />
              </TableCell>
              <TableCell>
                {catalog.data?.bots.find((b) => b.bot_id === r.bot_id)?.label ?? r.bot_id}
              </TableCell>
              <TableCell>
                <CellLines
                  lines={[
                    r.host + r.display_path,
                    r.identity === 'non_joinable'
                      ? 'Redacted; non-joinable'
                      : 'Path-level identity',
                  ]}
                />
              </TableCell>
              <TableCell>{words(r.resource_class)}</TableCell>
              <TableCell numeric>{r.status_code}</TableCell>
              <TableCell>
                <CellLines
                  lines={[
                    words(r.verification) +
                      (r.verification_reason ? ' · ' + reasonLabel(r.verification_reason) : ''),
                    r.verification_basis === 'later_snapshot'
                      ? 'Verified using a later IP-range snapshot.'
                      : '',
                  ]}
                />
              </TableCell>
            </TableRow>
          ))}
        </DataTable>
        {page?.items.length === 0 ? <CrawlLogConnections /> : null}
      </Stack>
    </TabPanel>
  );
}
function SourceLines({
  source,
}: Readonly<{ source?: z.infer<typeof crawlCoverageResponseSchema>['sources'][number] }>) {
  return <CellLines lines={[source?.host ?? 'Removed source', words(source?.setup ?? '')]} />;
}
/**
 * A primary value with its qualifiers beneath it in caption ink: one line
 * each, so the row never grows past two; cut text moves into a tooltip.
 */
function CellLines({ lines }: Readonly<{ lines: string[] }>) {
  const [first, ...rest] = lines.filter(Boolean);
  return <TableCellLines primary={first} secondary={rest.join(' · ')} />;
}
/** Reasons survive raw retention because rollups keep them. */
function reasonEntries(values: Record<string, number>) {
  return Object.entries(values)
    .filter(([key]) => key !== 'verified')
    .map(([key, value]) => reasonLabel(key) + ': ' + value)
    .join(' · ');
}
function entries(values: Record<string, number>) {
  return Object.entries(values)
    .map(([key, value]) => words(key) + ': ' + value)
    .join(' · ');
}
function CoverageTable({
  projectId,
  workspaceId,
  range,
}: Readonly<{ projectId: string; workspaceId: string; range: string }>) {
  const { page: data, table } = useCursorTableQuery({
    workspaceId,
    scopeId: projectId,
    scope: range,
    query: (request) => aiTrafficQueries.coverage(workspaceId, projectId, { range, ...request }),
    noun: 'reporting days',
    loading: 'Loading coverage…',
    error: 'Could not read coverage',
    empty: () => ({
      kind: 'empty',
      icon: CalendarX,
      heading: 'No persisted coverage in this range',
    }),
  });
  return (
    <DataTable
      title="Coverage by source and reporting day"
      columns={COVERAGE_COLUMNS}
      minWidth="md"
      // Every row stacks a qualifier under its value.
      rowLines={2}
      {...table}
    >
      {data?.items.map((r) => (
        <TableRow key={r.source_id + r.reporting_date + r.reporting_timezone}>
          <TableCell>
            <CellLines lines={[r.reporting_date, r.reporting_timezone]} />
          </TableCell>
          <TableCell>
            <SourceLines source={data.sources.find((s) => s.id === r.source_id)} />
          </TableCell>
          <TableCell>
            <CellLines lines={[coverageLabel(r.coverage), reasonLabel(r.reason)]} />
          </TableCell>
          <TableCell numeric>
            {r.batch_count} / {r.heartbeat_count}
          </TableCell>
          <TableCell numeric>{r.max_gap_minutes.toFixed(1)} minutes</TableCell>
        </TableRow>
      ))}
    </DataTable>
  );
}
