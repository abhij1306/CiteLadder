'use client';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { z } from 'zod';
import type { aiTrafficOverviewSchema, crawlSummarySchema } from '@citeladder/contracts/ai-traffic';
import { formatPercent } from '@/lib/format';
import { connectionLabel, coverageLabel, words } from '@/lib/ai-traffic/vocabulary';
import { projectDestination } from '@/lib/navigation/project-destination';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ProjectLink } from '@/components/layout/scoped-link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DisplayTime } from '@/components/ui/display-time';
import { MetricValue } from '@/components/ui/metric-value';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

/** One Overview signal: title and state, the figure or why it is missing, one action. */
function SignalCard({
  title,
  status,
  action,
  children,
}: Readonly<{ title: string; status?: string; action?: ReactNode; children: ReactNode }>) {
  return (
    <Card className="flex flex-col">
      <CardHeader actions={status ? <Badge>{status}</Badge> : null}>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        {children}
        {action ? <div className="mt-auto pt-1">{action}</div> : null}
      </CardContent>
    </Card>
  );
}
export function ReferralSignal({
  data,
}: Readonly<{
  data: z.infer<typeof aiTrafficOverviewSchema>['referrals'];
}>) {
  const latest = data.referral_volume.at(-1);
  const synced = data.window_end !== null;
  return (
    <SignalCard
      title="AI referrals"
      status={synced ? 'GA4 · Synced' : 'GA4 · Not synced'}
      action={
        synced ? null : (
          <Button asChild variant="secondary" size="sm">
            {/* The referrals view connects GA4 in place. */}
            <ProjectLink href="/ai-traffic?tab=referrals">Connect GA4</ProjectLink>
          </Button>
        )
      }
    >
      {data.referral_volume.length ? (
        <div className="grid gap-1">
          <p className="type-label">AI referral sessions in the latest day</p>
          <MetricValue
            value={latest?.value == null ? null : String(latest.value)}
            label="Unavailable"
          />
          <p className="type-caption">
            Share of sessions: {formatPercent(data.referral_share.at(-1)?.value ?? null, 1)}
          </p>
        </div>
      ) : (
        <p className="type-body text-secondary">
          Connect GA4 and sync a source/medium report to measure referral sessions.
        </p>
      )}
      {synced ? (
        <p className="type-caption">
          Report through <DisplayTime value={data.window_end} dateOnly />
        </p>
      ) : null}
    </SignalCard>
  );
}
export function CitationSignal({
  data,
  projectId,
}: Readonly<{
  data: z.infer<typeof aiTrafficOverviewSchema>['citations'];
  projectId: string;
}>) {
  return (
    <SignalCard
      title="Tracked citations"
      action={
        <Button asChild variant="secondary" size="sm">
          <Link to={projectDestination('/visibility', null, projectId)}>Open AI Visibility</Link>
        </Button>
      }
    >
      <div className="grid gap-1">
        <p className="type-label">{data.label}</p>
        <MetricValue value={data.count === null ? null : String(data.count)} label="Unavailable" />
      </div>
    </SignalCard>
  );
}
export function RequestsByPurpose({
  series,
}: Readonly<{ series: z.infer<typeof crawlSummarySchema>['series'] }>) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recognized requests by purpose</CardTitle>
      </CardHeader>
      <Table>
        <caption className="sr-only">Daily recognized automated requests</caption>
        <TableHeader>
          <TableRow>
            <TableHead numeric>Reporting day</TableHead>
            <TableHead>Purpose</TableHead>
            <TableHead numeric>Requests</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {series.map((s) => (
            <TableRow key={s.date + s.purpose}>
              <TableCell numeric>{s.date}</TableCell>
              <TableCell>{words(s.purpose)}</TableCell>
              <TableCell numeric>{s.requests}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
export function CrawlSignalPanel({
  data,
  available,
  onConnect,
}: Readonly<{
  data: z.infer<typeof crawlSummarySchema>;
  /** False when this workspace cannot collect crawl logs yet. */
  available: boolean;
  onConnect?: () => void;
}>) {
  if (!available)
    return (
      <SignalCard title="Crawlers" status="Not available yet">
        <p className="type-body text-secondary">
          Crawl log collection is not available for this workspace yet. AI referrals and tracked
          citations are measured without it.
        </p>
      </SignalCard>
    );
  return <CrawlSignal data={data} onConnect={onConnect} />;
}
function CrawlSignal({
  data,
  onConnect,
}: Readonly<{ data: z.infer<typeof crawlSummarySchema>; onConnect?: () => void }>) {
  const emptyMessage = {
    not_connected: 'Connect crawl logs to observe recognized automated requests.',
    awaiting_data: 'Source connected. Awaiting the first accepted batch.',
    connected: 'No matching requests were observed in the available logs. Coverage is incomplete.',
  }[data.connection];
  return (
    <SignalCard
      title="Crawlers"
      status={
        data.connection === 'connected'
          ? coverageLabel(data.coverage)
          : connectionLabel(data.connection)
      }
      action={
        data.connection === 'not_connected' ? (
          <Button variant="secondary" size="sm" onClick={onConnect}>
            Connect crawl logs
          </Button>
        ) : null
      }
    >
      {data.requests === null ? (
        <p className="type-body text-secondary">{emptyMessage}</p>
      ) : (
        <dl className="grid gap-3">
          <div className="grid gap-1">
            <dt className="type-label">Recognized automated requests</dt>
            <dd>
              <MetricValue value={String(data.requests)} label="Unavailable" />
            </dd>
          </div>
          <div className="grid gap-1">
            <dt className="type-label">Path-level pages · active bots</dt>
            <dd className="type-body">
              {data.pages ?? 'Unavailable'} pages · {data.active_bots ?? 'Unavailable'} bots
            </dd>
          </div>
          <div className="grid gap-1">
            <dt className="type-label">Error share within the selected requests</dt>
            <dd className="type-body">
              {data.error_share === null ? 'Unavailable' : errorShare(data.error_share)}
            </dd>
          </div>
        </dl>
      )}
      {data.coverage === 'partial' ? (
        <p className="type-caption">
          Coverage is incomplete. These are observations within the available logs.
        </p>
      ) : null}
      {data.coverage === 'declared_complete' ? (
        <p className="type-caption">Complete within the client-reported file scan.</p>
      ) : null}
      {data.failed_verification_requests !== null && data.failed_verification_requests > 0 ? (
        <p className="type-caption">
          {data.failed_verification_requests} failed verification requests are shown separately.
        </p>
      ) : null}
      {data.last_processed_at ? (
        <p className="type-caption">
          Reporting timezone: {data.reporting_timezone}. Processed{' '}
          <DisplayTime value={data.last_processed_at} />.
        </p>
      ) : null}
    </SignalCard>
  );
}
function errorShare(value: number) {
  return value > 0 && value < 0.001 ? '<0.1%' : (value * 100).toFixed(1) + '%';
}
