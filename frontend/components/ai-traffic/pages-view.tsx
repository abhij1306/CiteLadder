'use client';
import { Fragment, useState, type ReactNode } from 'react';
import type { z } from 'zod';
import type { aiTrafficPagesSchema } from '@citeladder/contracts/ai-traffic';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { ClampText, TableCell, TableRow } from '@/components/ui/table';
import { Stack } from '@/components/ui/layout';
import { Tooltip, TooltipProvider } from '@/components/ui/tooltip';
import { Pressable } from '@/components/ui/pressable';
import { MISSING_MARK } from '@/lib/format';
import { DisplayTime, TableTime } from '@/components/ui/display-time';
import { UrlPanel, TrafficLeg, trafficLegExplanation } from './url-panel';
import { TrafficNoResults } from './empty-state';
import type { TrafficFilters } from '@/lib/api/ai-traffic';

const PAGE_COLUMNS: readonly DataTableColumn[] = [
  { key: 'path', label: 'Path' },
  { key: 'crawl', label: 'Crawler requests', width: 'metric', numeric: true },
  { key: 'referrals', label: 'AI referral sessions', width: 'metric', numeric: true },
  { key: 'key-events', label: 'Key events', width: 'figure', numeric: true },
  { key: 'citations', label: 'Tracked citations', width: 'metric', numeric: true },
  { key: 'findings', label: 'Open findings', width: 'metric', numeric: true },
  { key: 'last-crawl', label: 'Last crawl', width: 'date', numeric: true },
  { key: 'errors', label: '4xx / 5xx', width: 'figure', numeric: true },
];

export function TrafficPages({
  data,
  filters = {},
}: Readonly<{ data: z.infer<typeof aiTrafficPagesSchema>; filters?: TrafficFilters }>) {
  const [urlHash, setUrlHash] = useState<string | null>(null);
  return (
    <Stack gap="workspace">
      <CoverageLine data={data} />
      {data.items.length ? null : (
        <TrafficNoResults
          heading="No joinable paths were observed"
          description="Check each signal’s coverage for this window before interpreting absence."
        />
      )}
      {data.items.length ? (
        <DataTable
          label="Path-level AI Traffic with separate signal units"
          columns={PAGE_COLUMNS}
          minWidth="xl"
        >
          {data.items.map((r) => (
            <TrafficPageRow key={r.url_hash} r={r} onOpen={setUrlHash} />
          ))}
        </DataTable>
      ) : null}
      <UrlPanel urlHash={urlHash} onClose={() => setUrlHash(null)} filters={filters} />
    </Stack>
  );
}

function UnavailableTrafficValue({
  reason,
  label = 'Unavailable',
}: Readonly<{ reason: string; label?: string }>) {
  return (
    <TooltipProvider>
      <Tooltip content={reason}>
        <Pressable type="button" className="w-auto text-center" aria-label={label}>
          {MISSING_MARK}
        </Pressable>
      </Tooltip>
    </TooltipProvider>
  );
}

function TrafficErrors({
  page,
}: Readonly<{ page: z.infer<typeof aiTrafficPagesSchema>['items'][number] }>) {
  const reason = trafficLegExplanation(page.crawl, 'Crawler requests');
  if (page.errors_4xx === null && page.errors_5xx === null)
    return (
      <UnavailableTrafficValue
        label="4xx and 5xx unavailable"
        reason={`4xx and 5xx unavailable: ${reason}`}
      />
    );
  return (
    <>
      {page.errors_4xx ?? (
        <UnavailableTrafficValue label="4xx unavailable" reason={`4xx unavailable: ${reason}`} />
      )}{' '}
      /{' '}
      {page.errors_5xx ?? (
        <UnavailableTrafficValue label="5xx unavailable" reason={`5xx unavailable: ${reason}`} />
      )}
    </>
  );
}
function TrafficPageRow({
  r,
  onOpen,
}: Readonly<{
  r: z.infer<typeof aiTrafficPagesSchema>['items'][number];
  onOpen: (hash: string) => void;
}>) {
  return (
    <TableRow>
      <TableCell>
        {/* A ghost button centred a path wider than the column and cut its
            start off; a plain pressable keeps the start and cuts the end. */}
        <Pressable
          onClick={() => onOpen(r.url_hash)}
          className="hover:underline"
          aria-label={`View AI Traffic for ${r.canonical_url}`}
        >
          <ClampText lines={1} tooltip={r.canonical_url}>
            {r.display_path}
          </ClampText>
        </Pressable>
      </TableCell>
      <TableCell numeric>
        <TrafficLeg compact leg={r.crawl} unit="requests" />
      </TableCell>
      <TableCell numeric>
        <TrafficLeg compact leg={r.referrals} unit="sessions" />
      </TableCell>
      <TableCell numeric>
        {r.key_events === null ? (
          <UnavailableTrafficValue
            label="Key events unavailable"
            reason="Key events are unavailable for this path in the selected window."
          />
        ) : (
          r.key_events
        )}
      </TableCell>
      <TableCell numeric>
        <TrafficLeg compact leg={r.citations} unit="citations" />
      </TableCell>
      <TableCell numeric>
        <TrafficLeg compact leg={r.findings} unit="findings" />
      </TableCell>
      <TableCell numeric>
        {r.last_crawl ? (
          <TableTime value={r.last_crawl} />
        ) : (
          <UnavailableTrafficValue
            label="Last crawl unavailable"
            reason="Last crawl is unavailable for this path in the selected window."
          />
        )}
      </TableCell>
      <TableCell numeric>
        <TrafficErrors page={r} />
      </TableCell>
    </TableRow>
  );
}
/**
 * The tab's one context line: which sources are not connected, crawl coverage
 * and the inventory behind the rows. A dash in the table explains itself on
 * focus, so the line does not repeat that.
 */
function CoverageLine({ data }: Readonly<{ data: z.infer<typeof aiTrafficPagesSchema> }>) {
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
  // Unknown (logs connected, nothing to measure against) and unavailable stay
  // distinct; disconnected crawler logs already say why coverage is missing.
  let crawlCoverage: string | null =
    coverage.state === 'unknown' ? 'Crawl coverage unknown' : 'Crawl coverage unavailable';
  if (coverage.share !== null)
    crawlCoverage = `${coverage.label}: ${(coverage.share * 100).toFixed(1)}%`;
  else if (disconnected.some(([key]) => key === 'crawl')) crawlCoverage = null;
  const segments: Array<[string, ReactNode]> = [];
  if (disconnected.length)
    segments.push([
      'sources',
      `${disconnected.map(([, label]) => label).join(', ')} not connected`,
    ]);
  if (crawlCoverage) segments.push(['coverage', crawlCoverage]);
  segments.push(['pages', `${coverage.known_pages} known pages`]);
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
