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
import { formatCount, formatMean, formatWindowDate, isOwnHost } from '@/lib/format';
import { useProjectScope } from '@/lib/project/active-project-scope';
import { CalendarX, SearchX } from '@/lib/icons';
import { TabPanel } from '@/components/ui/tabs';
import { Absence } from '@/components/ui/absence';
import { Pressable } from '@/components/ui/pressable';
import { TextLink } from '@/components/ui/text-link';
import { TableRow, TableCell, TableCellLines, TableTime, UrlText } from '@/components/ui/table';
import { CrawlLogConnections } from './crawl-log-connections';
import { InsightStrip } from './insight-strip';
import { OverviewFigures, RequestsByPurpose, overviewMeasured } from './overview-signals';
import { trafficNarrowed } from './traffic-controls';
import type { SourceStep } from '@/components/integrations/data-sources';
import { CrawlerPages } from './crawler-pages';
import { ClampText } from '@/components/ui/clamp-text';
import { StatusMark } from '@/components/ui/status-mark';
import { DataTable, type DataTableColumn, type DataTableState } from '@/components/ui/data-table';
import { readErrorProps } from '@/components/ui/notice';
import { SectionStack, TitledSection } from '@/components/ui/section';

const CRAWLER_COLUMNS: readonly DataTableColumn[] = [
  { key: 'crawler', label: 'Crawler', width: 'name' },
  { key: 'purpose', label: 'Purpose', width: 'category', priority: 'low' },
  { key: 'requests', label: 'Requests', width: 'figure', kind: 'number' },
  { key: 'pages', label: 'Path-level pages', width: 'metric', kind: 'number' },
  { key: 'last-seen', label: 'Last observed', width: 'date', kind: 'date', priority: 'low' },
  { key: 'status', label: 'Status codes' },
  { key: 'verification', label: 'Verification', width: 'name' },
  { key: 'breakdown', label: 'Folder and resource breakdown', priority: 'low' },
];
const COVERAGE_COLUMNS: readonly DataTableColumn[] = [
  { key: 'day', label: 'Day', kind: 'date', width: 'category' },
  { key: 'source', label: 'Source', width: 'name' },
  { key: 'coverage', label: 'Coverage' },
  {
    key: 'counts',
    label: 'Batch / heartbeat count',
    width: 'metric',
    kind: 'number',
    priority: 'low',
  },
  { key: 'gap', label: 'Longest receipt gap', width: 'metric', kind: 'number', priority: 'low' },
];

const ACTIVITY_COLUMNS: readonly DataTableColumn[] = [
  { key: 'observed', label: 'Observed', width: 'date', kind: 'date' },
  { key: 'bot', label: 'Bot', width: 'category' },
  { key: 'path', label: 'Host and path' },
  { key: 'resource', label: 'Resource', width: 'status', priority: 'low' },
  { key: 'status', label: 'Status', width: 'figure', kind: 'number' },
  { key: 'verification', label: 'Verification', priority: 'low' },
];
export function TrafficOverview({
  data,
  projectId,
  workspaceId,
  range,
  crawlAvailable,
  ga4,
}: Readonly<{
  data: z.infer<typeof aiTrafficOverviewSchema>;
  projectId: string;
  workspaceId: string;
  range: string;
  crawlAvailable: boolean;
  ga4: SourceStep | null;
}>) {
  const [connectOpen, setConnectOpen] = useState(false);
  const crawlConnected = data.crawl.connection !== 'not_connected';
  return (
    <TabPanel value="overview">
      <SectionStack>
        <OverviewFigures
          data={data}
          projectId={projectId}
          crawlAvailable={crawlAvailable}
          ga4={ga4}
          onConnectCrawl={() => setConnectOpen(true)}
        />
        {overviewMeasured(data) ? (
          <InsightStrip projectId={projectId} workspaceId={workspaceId} range={range} />
        ) : null}
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
      </SectionStack>
    </TabPanel>
  );
}
type CrawlTableScope = TrafficTableScope & Readonly<{ onClearFilters: () => void }>;

function noMatches(
  { filters, onClearFilters }: CrawlTableScope,
  copy: Readonly<{ heading: string }>,
): DataTableState {
  if (trafficNarrowed(filters)) return { kind: 'filtered', onClear: onClearFilters };
  return { kind: 'empty', icon: SearchX, ...copy };
}

function windowFilters(filters: TrafficFilters): TrafficFilters {
  return { range: filters.range, verification: filters.verification };
}
export function TrafficCrawlers(scope: CrawlTableScope) {
  const { workspaceId, projectId, filters } = scope;
  const [botId, setBotId] = useState<string | null>(null);
  const { page, table } = useCursorTableQuery({
    workspaceId,
    scopeId: projectId,
    scope: filters,
    query: (request) =>
      aiTrafficQueries.crawlers({ workspaceId, projectId }, { ...filters, ...request }),
    noun: 'crawlers',
    loading: 'Loading crawlers…',
    subject: 'the crawlers',
    empty: () => noMatches(scope, { heading: 'No matching requests were observed' }),
  });
  return (
    <TabPanel value="crawlers">
      <SectionStack>
        <DataTable label="Recognized crawlers" columns={CRAWLER_COLUMNS} {...table}>
          {page?.items.map((b) => (
            <TableRow key={b.bot_id}>
              <TableCell>{b.label}</TableCell>
              <TableCell>{words(b.purpose)}</TableCell>
              <TableCell numeric>{formatCount(b.requests)}</TableCell>
              <TableCell numeric>
                {b.pages === null ? (
                  <Absence state="unavailable" />
                ) : (
                  <TextLink asChild text="inherit">
                    <Pressable
                      className="w-auto tabular-nums"
                      onClick={() => setBotId(b.bot_id)}
                      aria-label={`View paths requested by ${b.label}`}
                    >
                      {formatCount(b.pages)} paths
                    </Pressable>
                  </TextLink>
                )}
              </TableCell>
              <TableCell>
                <TableTime value={b.last_seen} />
              </TableCell>
              <TableCell>
                <ClampText>{entries(b.status_codes)}</ClampText>
              </TableCell>
              <TableCell>
                <ClampText className="max-w-56!">
                  {[entries(b.verification), reasonEntries(b.verification_reasons)]
                    .filter(Boolean)
                    .join(' · ')}
                </ClampText>
              </TableCell>
              <TableCell>
                <CellLines lines={[topEntries(b.folders), topEntries(b.resources)]} />
              </TableCell>
            </TableRow>
          ))}
        </DataTable>
        {page?.items.length === 0 ? <CrawlLogConnections /> : null}
      </SectionStack>
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
function catalogState(
  catalog: UseQueryResult<z.infer<typeof crawlCatalogSchema>>,
): DataTableState | undefined {
  if (catalog.isError && !catalog.data)
    return {
      kind: 'error',
      ...readErrorProps(catalog),
      title: "Couldn't load the crawler catalog",
      fallback: 'Without it the bots in this table cannot be named.',
    };
  if (catalog.isPending) return { kind: 'loading', label: 'Loading the crawler catalog…' };
  return undefined;
}
export function TrafficActivity(scope: CrawlTableScope) {
  const { workspaceId, projectId, filters } = scope;
  const catalog = useQuery(aiTrafficQueries.catalog({ workspaceId, projectId }));
  const website = useProjectScope().project.website_url;
  const { page, table } = useCursorTableQuery({
    workspaceId,
    scopeId: projectId,
    scope: filters,
    query: (request) =>
      aiTrafficQueries.activity({ workspaceId, projectId }, { ...filters, ...request }),
    noun: 'requests',
    loading: 'Loading request activity…',
    subject: 'the request activity',
    empty: () => noMatches(scope, { heading: 'No matching requests' }),
  });
  return (
    <TabPanel value="activity">
      <SectionStack>
        <DataTable
          label="Retained automated request activity"
          columns={ACTIVITY_COLUMNS}
          {...table}
          state={catalogState(catalog) ?? table.state}
        >
          {page?.items.map((r) => (
            <TableRow key={r.id}>
              <TableCell>
                <TableTime value={r.occurred_at} />
              </TableCell>
              <TableCell>
                {catalog.data?.bots.find((b) => b.bot_id === r.bot_id)?.label ?? r.bot_id}
              </TableCell>
              <TableCell>
                <TableCellLines
                  primary={
                    <UrlText
                      url={isOwnHost(r.host, website) ? r.display_path : r.host + r.display_path}
                    />
                  }
                  secondary={r.identity === 'non_joinable' ? 'Redacted; non-joinable' : null}
                />
              </TableCell>
              <TableCell>{words(r.resource_class)}</TableCell>
              <TableCell numeric>
                {r.status_code >= 400 ? (
                  <StatusMark tone={r.status_code >= 500 ? 'negative' : 'warning'}>
                    {r.status_code}
                  </StatusMark>
                ) : (
                  r.status_code
                )}
              </TableCell>
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
      </SectionStack>
    </TabPanel>
  );
}
function SourceLines({
  source,
}: Readonly<{ source?: z.infer<typeof crawlCoverageResponseSchema>['sources'][number] }>) {
  return <CellLines lines={[source?.host ?? 'Removed source', words(source?.setup ?? '')]} />;
}
function CellLines({ lines }: Readonly<{ lines: string[] }>) {
  const [first, ...rest] = lines.filter(Boolean);
  return <TableCellLines primary={first} secondary={rest.join(' · ')} />;
}
function reasonEntries(values: Record<string, number>) {
  return Object.entries(values)
    .filter(([key]) => key !== 'verified')
    .map(([key, value]) => reasonLabel(key) + ': ' + value)
    .join(' · ');
}
function entries(values: Record<string, number>) {
  return Object.entries(values)
    .map(([key, value]) => words(key) + ': ' + formatCount(value))
    .join(' · ');
}
const TOP_ENTRIES = 3;
function topEntries(values: Record<string, number>) {
  const sorted = Object.entries(values).sort(([, a], [, b]) => b - a);
  const shown = sorted
    .slice(0, TOP_ENTRIES)
    .map(([key, value]) => words(key) + ': ' + formatCount(value));
  const more = sorted.length - TOP_ENTRIES;
  return [...shown, ...(more > 0 ? [`+${formatCount(more)} more`] : [])].join(' · ');
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
    query: (request) =>
      aiTrafficQueries.coverage({ workspaceId, projectId }, { range, ...request }),
    noun: 'reporting days',
    loading: 'Loading coverage…',
    subject: 'the coverage',
    empty: () => ({
      kind: 'empty',
      icon: CalendarX,
      heading: 'No persisted coverage in this range',
    }),
  });
  return (
    <TitledSection title="Coverage by source and reporting day">
      <DataTable label="Coverage by source and reporting day" columns={COVERAGE_COLUMNS} {...table}>
        {data?.items.map((r) => (
          <TableRow key={r.source_id + r.reporting_date + r.reporting_timezone}>
            <TableCell>
              <CellLines lines={[formatWindowDate(r.reporting_date), r.reporting_timezone]} />
            </TableCell>
            <TableCell>
              <SourceLines source={data.sources.find((s) => s.id === r.source_id)} />
            </TableCell>
            <TableCell>
              <CellLines lines={[coverageLabel(r.coverage), reasonLabel(r.reason)]} />
            </TableCell>
            <TableCell numeric>
              {formatCount(r.batch_count)} / {formatCount(r.heartbeat_count)}
            </TableCell>
            <TableCell numeric>{formatMean(r.max_gap_minutes)} minutes</TableCell>
          </TableRow>
        ))}
      </DataTable>
    </TitledSection>
  );
}
