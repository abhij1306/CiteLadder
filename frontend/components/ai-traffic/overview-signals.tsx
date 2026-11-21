import type { ReactNode } from 'react';
import type { z } from 'zod';
import type { aiTrafficOverviewSchema, crawlSummarySchema } from '@citeladder/contracts/ai-traffic';
import {
  formatCount,
  formatPercent,
  formatWindowDate,
  type DataAvailabilityState,
} from '@/lib/format';
import {
  citationGapLabel,
  connectionLabel,
  coverageLabel,
  words,
} from '@/lib/ai-traffic/vocabulary';
import type { SourceStep } from '@/components/integrations/data-sources';
import { ActionButton } from '@/components/ui/actions';
import { Button } from '@/components/ui/button';
import { Stack } from '@/components/ui/layout';
import { ProjectLink } from '@/components/ui/project-link';
import { StateBlock } from '@/components/ui/state-block';
import { InfoHint } from '@/components/ui/info-hint';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { DisplayTime } from '@/components/ui/display-time';
import { FigureStrip, type FigureSegment } from '@/components/ui/figure-strip';
import { pageNumberControls, useTablePage } from '@/components/ui/pager';
import { TitledSection } from '@/components/ui/section';
import { TableCell, TableRow } from '@/components/ui/table';

type Overview = z.infer<typeof aiTrafficOverviewSchema>;
type CrawlSummary = z.infer<typeof crawlSummarySchema>;

const PURPOSE_COLUMNS: readonly DataTableColumn[] = [
  { key: 'day', label: 'Reporting day', kind: 'date' },
  { key: 'purpose', label: 'Purpose' },
  { key: 'requests', label: 'Requests', width: 'figure', kind: 'number' },
];

const PURPOSE_PAGE_SIZE = 10;

export function OverviewFigures({
  data,
  projectId,
  crawlAvailable,
  ga4,
  onConnectCrawl,
}: Readonly<{
  data: Overview;
  projectId: string;
  ga4: SourceStep | null;
  crawlAvailable: boolean;
  onConnectCrawl?: () => void;
}>) {
  const ga4Step = referralSetup(ga4);
  const ga4Missing = data.referrals.window_end === null && ga4Step.action !== null;
  const crawlMissing =
    crawlAvailable && data.crawl.connection === 'not_connected' && onConnectCrawl !== undefined;
  return (
    <Stack gap="workspace" className="min-w-0">
      <CrawlNotes crawl={data.crawl} available={crawlAvailable} />
      <Stack gap="compact">
        <FigureStrip
          label="AI traffic key figures"
          segments={[
            referralFigure(data.referrals, ga4),
            ...crawlFigures(data.crawl, crawlAvailable),
            citationFigure(data.citations),
          ]}
        />
        {ga4Missing ? (
          <StateBlock
            kind="empty"
            inline
            message={ga4Step.note}
            action={
              <Button asChild>
                <ProjectLink href="/ai-traffic?tab=referrals" projectId={projectId}>
                  {ga4Step.action}
                </ProjectLink>
              </Button>
            }
          />
        ) : null}
        {crawlMissing ? (
          <StateBlock
            kind="empty"
            inline
            message={CRAWL_EMPTY.not_connected}
            action={<ActionButton action="connectCrawlLogs" onClick={onConnectCrawl} />}
          />
        ) : null}
      </Stack>
    </Stack>
  );
}

export function overviewStarted(data: Overview): boolean {
  return data.crawl.connection !== 'not_connected' || overviewMeasured(data);
}

export function overviewMeasured(data: Overview): boolean {
  return (
    data.referrals.window_end !== null ||
    data.crawl.requests !== null ||
    data.citations.state === 'measured'
  );
}

const CRAWL_REQUESTS = 'Crawler requests';

const CRAWL_EMPTY = {
  not_connected: 'Crawl logs are not connected.',
  awaiting_data: 'Awaiting the first accepted batch.',
  connected: 'No matching requests were observed. Coverage is incomplete.',
} as const;

function crawlFigures(crawl: CrawlSummary, available: boolean): FigureSegment[] {
  if (!available)
    return [
      {
        key: 'requests',
        label: CRAWL_REQUESTS,
        value: null,
        missingState: 'unavailable',
        marker: (
          <WhyAbsent label={CRAWL_REQUESTS}>
            Crawl log collection is not available for this workspace yet.
          </WhyAbsent>
        ),
      },
    ];
  const status =
    crawl.connection === 'connected'
      ? coverageLabel(crawl.coverage)
      : connectionLabel(crawl.connection);
  const failed = crawl.failed_verification_requests ?? 0;
  const failedNote =
    failed > 0 ? `${formatCount(failed)} failed verification requests shown separately.` : null;
  if (crawl.requests === null)
    return [noRequestsFigure({ connection: crawl.connection, status, failedNote })];
  return [
    {
      key: 'requests',
      label: CRAWL_REQUESTS,
      value: formatCount(crawl.requests),
      sub: status,
    },
    {
      key: 'pages',
      label: 'Path-level pages',
      value: crawl.pages === null ? null : formatCount(crawl.pages),
      missingState: 'unavailable',
      sub:
        crawl.active_bots === null
          ? 'Active bots unavailable'
          : `Requested by ${formatCount(crawl.active_bots)} active bots`,
    },
    {
      key: 'errors',
      label: 'Error share',
      value: crawl.error_share === null ? null : errorShare(crawl.error_share),
      missingState: 'unavailable',
      sub: failedNote ?? undefined,
    },
  ];
}

function noRequestsFigure({
  connection,
  status,
  failedNote,
}: Readonly<{
  connection: CrawlSummary['connection'];
  status: string;
  failedNote: string | null;
}>): FigureSegment {
  if (connection === 'not_connected')
    return {
      key: 'requests',
      label: CRAWL_REQUESTS,
      value: null,
      missingState: 'not_connected',
    };
  return {
    key: 'requests',
    label: CRAWL_REQUESTS,
    value: null,
    missingLabel: status,
    marker: (
      <WhyAbsent label={CRAWL_REQUESTS}>
        {failedNote ? `${CRAWL_EMPTY[connection]} ${failedNote}` : CRAWL_EMPTY[connection]}
      </WhyAbsent>
    ),
  };
}

function referralFigure(referrals: Overview['referrals'], ga4: SourceStep | null): FigureSegment {
  const latest = referrals.referral_volume.at(-1);
  const synced = referrals.window_end !== null;
  const share = sharePhrase(referrals);
  const unsynced = referralSetup(ga4);
  const reported = referrals.referral_volume.length > 0;
  const label = 'AI referral sessions';
  const hinted = !reported && (synced || unsynced.action === null);
  return {
    key: 'referrals',
    label,
    caption: 'Latest day',
    value: latest?.value == null ? null : formatCount(latest.value),
    missingState: synced ? 'unavailable' : unsyncedKind(ga4),
    marker: hinted ? <WhyAbsent label={label}>{unsynced.note}</WhyAbsent> : undefined,
    sub:
      reported || referrals.window_end !== null ? (
        <>
          {reported ? `${share}GA4 · Synced` : null}
          {referrals.window_end === null ? null : (
            <>
              {reported ? ' · Report through ' : 'Report through '}
              <time dateTime={referrals.window_end}>{formatWindowDate(referrals.window_end)}</time>
            </>
          )}
        </>
      ) : undefined,
  };
}

function sharePhrase(referrals: Overview['referrals']): string {
  const value = referrals.referral_share.at(-1)?.value ?? null;
  return value === null ? '' : `${formatPercent(value)} of sessions · `;
}

function unsyncedKind(ga4: SourceStep | null): DataAvailabilityState {
  if (ga4 === null) return 'unavailable';
  switch (ga4.kind) {
    case 'connect':
    case 'reconnect':
      return 'not_connected';
    case 'choose':
      return 'not_set';
    case 'ready':
      return 'not_run';
    default:
      return ga4 satisfies never;
  }
}

function WhyAbsent({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  return <InfoHint label={`About ${label}`}>{children}</InfoHint>;
}

function referralSetup(ga4: SourceStep | null): { note: string; action: string | null } {
  if (ga4 === null)
    return { note: 'Referral sessions appear once GA4 imports a report.', action: null };
  switch (ga4.kind) {
    case 'connect':
      return {
        note: 'GA4 is not connected.',
        action: 'Connect GA4',
      };
    case 'reconnect':
      return { note: 'GA4 needs your consent again.', action: 'Reconnect GA4' };
    case 'choose':
      return {
        note: 'No GA4 property chosen.',
        action: 'Choose GA4 property',
      };
    case 'ready':
      return {
        note: 'Awaiting the next GA4 import.',
        action: null,
      };
    default:
      return ga4 satisfies never;
  }
}

function citationFigure(citations: Overview['citations']): FigureSegment {
  const measured = citations.state === 'measured';
  return {
    key: 'citations',
    label: 'Tracked citations',
    value: measured ? formatCount(citations.count) : null,
    missingState: !measured && citations.reason === 'no_completed_run' ? 'not_run' : 'unavailable',
    sub: measured ? citations.label : `${citations.label} · ${citationGapLabel(citations.reason)}`,
  };
}

const COVERAGE_NOTE: Partial<Record<CrawlSummary['coverage'], string>> = {
  partial: 'Coverage is incomplete.',
  declared_complete: 'Complete within the reported file scan.',
};

function CrawlNotes({ crawl, available }: Readonly<{ crawl: CrawlSummary; available: boolean }>) {
  if (!available) return null;
  const coverage = COVERAGE_NOTE[crawl.coverage] ?? null;
  if (!coverage && !crawl.last_processed_at) return null;
  return (
    <p className="type-body text-ink-2 min-w-0">
      {coverage}
      {coverage && crawl.last_processed_at ? ' ' : null}
      {crawl.last_processed_at ? (
        <>
          {crawl.reporting_timezone} · Processed <DisplayTime value={crawl.last_processed_at} />.
        </>
      ) : null}
    </p>
  );
}

export function RequestsByPurpose({ series }: Readonly<{ series: CrawlSummary['series'] }>) {
  const rows = [...series].reverse();
  const { page, setPage, pageCount, from, to } = useTablePage(rows.length, {
    pageSize: PURPOSE_PAGE_SIZE,
    urlKey: 'purpose_page',
  });
  return (
    <TitledSection title="Recognized requests by purpose">
      <DataTable
        label="Recognized requests by purpose"
        columns={PURPOSE_COLUMNS}
        pageSize={PURPOSE_PAGE_SIZE}
        rowCount={Math.min(PURPOSE_PAGE_SIZE, to - from + 1)}
        pager={{
          range: { from, to, total: rows.length, noun: 'rows' },
          ...pageNumberControls(page, pageCount, setPage),
        }}
      >
        {rows.slice(from - 1, to).map((s) => (
          <TableRow key={s.date + s.purpose}>
            <TableCell>
              <time dateTime={s.date}>{formatWindowDate(s.date)}</time>
            </TableCell>
            <TableCell>{words(s.purpose)}</TableCell>
            <TableCell numeric>{formatCount(s.requests)}</TableCell>
          </TableRow>
        ))}
      </DataTable>
    </TitledSection>
  );
}

function errorShare(value: number) {
  return value > 0 && value < 0.001 ? '<0.1%' : formatPercent(value);
}
