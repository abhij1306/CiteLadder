'use client';
import { useState } from 'react';
import type { z } from 'zod';
import type { aiTrafficPagesSchema } from '@citeladder/contracts/ai-traffic';
import {
  ClampText,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tooltip, TooltipProvider } from '@/components/ui/tooltip';
import { Pressable } from '@/components/ui/pressable';
import { MISSING_MARK } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { DisplayTime } from '@/components/ui/display-time';
import { UrlPanel, TrafficLeg, trafficLegExplanation } from './url-panel';
import { TrafficNoResults } from './empty-state';
import type { TrafficFilters } from '@/lib/api/ai-traffic';

export function TrafficPages({
  data,
  filters = {},
}: Readonly<{ data: z.infer<typeof aiTrafficPagesSchema>; filters?: TrafficFilters }>) {
  const [urlHash, setUrlHash] = useState<string | null>(null),
    coverage = data.observed_crawl_coverage;
  return (
    <div className="grid gap-[var(--workspace-gap)]">
      <p className="type-caption">
        {coverage.share === null
          ? 'Crawl coverage unavailable'
          : `${coverage.label}: ${(coverage.share * 100).toFixed(1)}%`}{' '}
        · {coverage.known_pages} known pages. Inventory{' '}
        <DisplayTime value={coverage.inventory_date} /> ·{' '}
        {coverage.inventory_complete ? 'Complete inventory' : 'Limited inventory'}
        {coverage.sample_mode ? ' · Sampled inventory' : ''}
      </p>
      <DisconnectedSources items={data.items} />
      {data.items.length > 0 ? (
        <p className="type-caption">
          Unavailable metrics show a dash. Focus a value for its source, coverage, and availability
          details. Known pages and open findings remain visible.
        </p>
      ) : null}
      {data.items.length ? null : (
        <TrafficNoResults
          heading="No joinable paths were observed"
          description="Check each signal’s coverage for this window before interpreting absence."
        />
      )}
      {data.items.length ? (
        <Table minWidth="lg">
          <caption className="sr-only">Path-level AI Traffic with separate signal units</caption>
          <TableHeader>
            <TableRow>
              <TableHead>Path</TableHead>
              <TableHead numeric="end">Crawler requests</TableHead>
              <TableHead numeric="end">AI referral sessions</TableHead>
              <TableHead numeric="end">Key events</TableHead>
              <TableHead numeric="end">Tracked citations</TableHead>
              <TableHead numeric="end">Open findings</TableHead>
              <TableHead numeric="end">Last crawl</TableHead>
              <TableHead numeric="end">4xx / 5xx</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.items.map((r) => (
              <TrafficPageRow key={r.url_hash} r={r} onOpen={setUrlHash} />
            ))}
          </TableBody>
        </Table>
      ) : null}
      <UrlPanel urlHash={urlHash} onClose={() => setUrlHash(null)} filters={filters} />
    </div>
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
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onOpen(r.url_hash)}
          className="max-w-72"
          aria-label={`View AI Traffic for ${r.canonical_url}`}
        >
          <ClampText lines={1} tooltip={r.canonical_url}>
            {r.display_path}
          </ClampText>
        </Button>
      </TableCell>
      <TableCell numeric="end">
        <TrafficLeg compact leg={r.crawl} unit="requests" />
      </TableCell>
      <TableCell numeric="end">
        <TrafficLeg compact leg={r.referrals} unit="sessions" />
      </TableCell>
      <TableCell numeric="end">
        {r.key_events === null ? (
          <UnavailableTrafficValue
            label="Key events unavailable"
            reason="Key events are unavailable for this path in the selected window."
          />
        ) : (
          r.key_events
        )}
      </TableCell>
      <TableCell numeric="end">
        <TrafficLeg compact leg={r.citations} unit="citations" />
      </TableCell>
      <TableCell numeric="end">
        <TrafficLeg compact leg={r.findings} unit="findings" />
      </TableCell>
      <TableCell numeric="end">
        {r.last_crawl ? (
          <DisplayTime value={r.last_crawl} />
        ) : (
          <UnavailableTrafficValue
            label="Last crawl unavailable"
            reason="Last crawl is unavailable for this path in the selected window."
          />
        )}
      </TableCell>
      <TableCell numeric="end">
        <TrafficErrors page={r} />
      </TableCell>
    </TableRow>
  );
}
function DisconnectedSources({
  items,
}: Readonly<{ items: z.infer<typeof aiTrafficPagesSchema>['items'] }>) {
  const sources = (
    [
      ['crawl', 'Crawler logs'],
      ['referrals', 'Referral analytics'],
      ['citations', 'Citation tracking'],
    ] as const
  )
    .filter(([key]) => items.length > 0 && items.every((row) => row[key].state === 'not_connected'))
    .map(([, label]) => label);
  if (sources.length === 0) return null;
  return (
    <p className="type-body">
      {sources.join(', ')} not connected. Showing known pages and open findings.
    </p>
  );
}
