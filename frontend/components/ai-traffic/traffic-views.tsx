'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { z } from 'zod';
import type {
  aiTrafficOverviewSchema,
  botCrawlersResponseSchema,
  botActivityResponseSchema,
  crawlCatalogSchema,
  crawlCoverageResponseSchema,
} from '@citeladder/contracts/ai-traffic';
import { aiTrafficApi } from '@/lib/api/ai-traffic';
import { queryKeys } from '@/lib/api/query-keys';
import { cursorControls, useCursorTable } from '@/lib/table/use-cursor-table';
import { coverageLabel, reasonLabel, words } from '@/lib/ai-traffic/vocabulary';
import { MISSING_MARK } from '@/lib/format';
import { CalendarX } from 'lucide-react';
import { TabPanel } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Stack } from '@/components/ui/layout';
import { DisplayTime } from '@/components/ui/display-time';
import { ReadError, readErrorProps } from '@/components/ui/read-error';
import {
  ClampText,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { CrawlLogConnections } from './crawl-log-connections';
import { InsightStrip } from './insight-strip';
import {
  CitationSignal,
  CrawlSignalPanel,
  ReferralSignal,
  RequestsByPurpose,
} from './overview-signals';
import { CrawlerPages } from './crawler-pages';
import { TrafficNoResults } from './empty-state';
import { Pager } from '@/components/ui/pager';
import { EditorialSectionHeader } from '@/components/ui/workspace';
import type { TrafficFilters } from '@/lib/api/ai-traffic';
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
        <div className="grid gap-[var(--workspace-gap)] lg:grid-cols-3">
          <CrawlSignalPanel
            data={data.crawl}
            available={crawlAvailable}
            onConnect={() => setConnectOpen(true)}
          />
          <ReferralSignal data={data.referrals} />
          <CitationSignal data={data.citations} projectId={projectId} />
        </div>
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
export function TrafficCrawlers({
  data,
  filters = {},
}: Readonly<{ data: z.infer<typeof botCrawlersResponseSchema>; filters?: TrafficFilters }>) {
  const [botId, setBotId] = useState<string | null>(null);
  return (
    <TabPanel value="crawlers">
      {data.items.length ? (
        <Table>
          <caption className="sr-only">Recognized crawlers</caption>
          <TableHeader>
            <TableRow>
              <TableHead>Crawler</TableHead>
              <TableHead>Purpose</TableHead>
              <TableHead numeric>Requests</TableHead>
              <TableHead numeric>Path-level pages</TableHead>
              <TableHead numeric>Last observed</TableHead>
              <TableHead>Status and verification</TableHead>
              <TableHead>Folder and resource breakdown</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.items.map((b) => (
              <TableRow key={b.bot_id}>
                <TableCell>{b.label}</TableCell>
                <TableCell>{words(b.purpose)}</TableCell>
                <TableCell numeric>{b.requests}</TableCell>
                <TableCell numeric>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setBotId(b.bot_id)}
                    aria-label={`View paths requested by ${b.label}`}
                  >
                    {b.pages ?? MISSING_MARK} paths
                  </Button>
                </TableCell>
                <TableCell numeric>
                  <DisplayTime value={b.last_seen} />
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
          </TableBody>
        </Table>
      ) : (
        <TrafficNoResults
          heading="No matching requests were observed"
          connectLogs
          description="Check coverage on Overview before interpreting absence in the available logs."
        />
      )}
      <CrawlerPages botId={botId} onClose={() => setBotId(null)} filters={filters} />
    </TabPanel>
  );
}
export function TrafficActivity({
  data,
  catalog,
}: Readonly<{
  data: z.infer<typeof botActivityResponseSchema>;
  catalog?: z.infer<typeof crawlCatalogSchema>;
}>) {
  return (
    <TabPanel value="activity">
      {data.items.length ? (
        <Table>
          <caption className="sr-only">Retained automated request activity</caption>
          <TableHeader>
            <TableRow>
              <TableHead numeric>Observed</TableHead>
              <TableHead>Bot</TableHead>
              <TableHead>Host and path</TableHead>
              <TableHead>Resource</TableHead>
              <TableHead numeric>Status</TableHead>
              <TableHead>Verification</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.items.map((r) => (
              <TableRow key={r.id}>
                <TableCell numeric>
                  <DisplayTime value={r.occurred_at} />
                </TableCell>
                <TableCell>
                  {catalog?.bots.find((b) => b.bot_id === r.bot_id)?.label ?? r.bot_id}
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
          </TableBody>
        </Table>
      ) : (
        <TrafficNoResults
          heading="No matching requests"
          connectLogs
          description="Nothing in the available retained logs matches these filters."
        />
      )}
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
  return (
    <div className="grid min-w-0">
      <ClampText lines={1}>{first}</ClampText>
      {rest.length > 0 ? (
        <ClampText lines={1} className="type-caption">
          {rest.join(' · ')}
        </ClampText>
      ) : null}
    </div>
  );
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
  const pager = useCursorTable(JSON.stringify([projectId, workspaceId, range]));
  const filters = { range, cursor: pager.cursor, limit: pager.pageSize };
  const query = useQuery({
    queryKey: queryKeys.aiTraffic.view(workspaceId, projectId, 'coverage', filters),
    queryFn: ({ signal }) => aiTrafficApi.coverage(projectId, filters, { workspaceId, signal }),
  });
  const data = query.data;
  return (
    <section className="grid gap-3" aria-labelledby="ai-traffic-coverage">
      <EditorialSectionHeader
        headingId="ai-traffic-coverage"
        title="Coverage by source and reporting day"
      />
      {query.isError ? (
        <ReadError {...readErrorProps(query)} fallback="Could not read coverage" />
      ) : null}
      {data && !data.items.length && !pager.canPrev ? (
        <EmptyState
          variant="compact"
          headingLevel={3}
          icon={CalendarX}
          heading="No persisted coverage in this range"
        />
      ) : null}
      {data && (data.items.length || pager.canPrev) ? (
        <>
          <Table>
            <caption className="sr-only">Crawl log coverage and receipt gaps</caption>
            <TableHeader>
              <TableRow>
                <TableHead>Day</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Coverage</TableHead>
                <TableHead numeric>Batch / heartbeat count</TableHead>
                <TableHead numeric>Longest receipt gap</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((r) => (
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
            </TableBody>
          </Table>
          <Pager
            hideWhenSinglePage
            page={pager.page}
            {...cursorControls(pager, data.next_cursor)}
          />
        </>
      ) : null}
    </section>
  );
}
