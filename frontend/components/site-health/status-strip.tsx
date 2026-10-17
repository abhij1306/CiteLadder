'use client';

import type { ReactNode } from 'react';

import { Alert } from '@/components/ui/alert';
import { EmptyState } from '@/components/ui/empty-state';
import { textRole } from '@/components/ui/typography';
import { UnavailableValue } from '@/components/ui/unavailable-value';
import type { PageSummary, SiteCrawl } from '@/lib/api/types';
import { ICONS } from '@/lib/icons';
import { cn } from '@/lib/utils';
import { CrawlStatusBadge } from '@/components/site-health/crawl-status-badge';
import {
  canShowDiscoveredTotal,
  crawlFailureCopy,
  dashboardRunNotice,
  discoveryProgressLabel,
  endSentence,
  isDiscoveryProvisional,
  isDiscoveryTerminal,
  type SiteHealthPhase,
} from '@/lib/site-health/status';

/**
 * Always-mounted status row of the canonical Site Health screen.
 *
 * ONE compact row (badge + narration + inline counters) that narrates the
 * whole lifecycle in place below the score cards — discovery counts while
 * discovering, audit progress while analyzing, and the run-outcome notice
 * (`dashboardRunNotice`) for a run that did not complete cleanly. The row
 * changes CONTENT, never the screen: no phase mounts or unmounts the region,
 * and progress is never a separate panel that pushes the results around.
 */
export function StatusStrip({
  crawl,
  phase,
  cancelPending,
  startPending,
  pages,
  selectedTotal,
  selectedError,
}: Readonly<{
  crawl: SiteCrawl | null;
  phase: SiteHealthPhase;
  cancelPending: boolean;
  /** A fresh crawl create is in flight — freeze current content behind a notice. */
  startPending: boolean;
  /** Bounded monitored-page window (observed "running" rows only, never totals). */
  pages: PageSummary[];
  /** This project's active monitored count; null until loaded. */
  selectedTotal: number | null;
  /** True when the monitored-count fetch failed (counts fall back, noted here). */
  selectedError: boolean;
}>) {
  // The wrapper (and its test id) stays mounted in every phase — only the
  // CONTENT below changes. The screen regression tests assert this stability.
  return (
    <div className="grid empty:hidden" data-testid="status-strip">
      <StripContent
        crawl={crawl}
        phase={phase}
        cancelPending={cancelPending}
        startPending={startPending}
        pages={pages}
        selectedTotal={selectedTotal}
        selectedError={selectedError}
      />
    </div>
  );
}

function StripContent({
  crawl,
  phase,
  cancelPending,
  startPending,
  pages,
  selectedTotal,
  selectedError,
}: Readonly<{
  crawl: SiteCrawl | null;
  phase: SiteHealthPhase;
  cancelPending: boolean;
  startPending: boolean;
  pages: PageSummary[];
  selectedTotal: number | null;
  selectedError: boolean;
}>) {
  if (startPending) {
    return (
      <Alert tone="info">
        {crawl
          ? 'Starting a fresh crawl — current results stay visible until the new run completes.'
          : 'Starting crawl — pages will appear below as they are found.'}
      </Alert>
    );
  }

  // The phase inputs have not all settled: say nothing rather than narrate a
  // state that is about to be corrected. (The screen holds its skeleton for
  // this beat, so it is not normally reached from there.)
  if (phase === 'resolving') return null;

  if (!crawl || phase === 'empty') {
    // Direct component callers retain an empty-state fallback. The canonical
    // layout owns the actionable first-crawl placeholder.
    return (
      <EmptyState
        icon={ICONS.siteHealth}
        heading="No crawl yet"
        description="Discover and analyze your site's pages for AI search optimization. Start a crawl to see your pages, scores, and issues here — this screen updates in place as the crawl progresses."
      />
    );
  }

  if (phase === 'discovering') {
    return <DiscoveryStrip crawl={crawl} cancelPending={cancelPending} />;
  }

  if (phase === 'analyzing') {
    return (
      <AnalysisStrip
        crawl={crawl}
        cancelPending={cancelPending}
        pages={pages}
        selectedTotal={selectedTotal}
        selectedError={selectedError}
      />
    );
  }

  if (phase === 'terminal') return <TerminalNotice crawl={crawl} />;
  return <DashboardNotice crawl={crawl} />;
}

/** Why a terminal crawl has no score: its own reason wherever there is one. */
function terminalMessage(
  status: SiteCrawl['status'],
  failure: ReturnType<typeof crawlFailureCopy> | null,
): string {
  if (status === 'cancelled') return 'This crawl was cancelled before it produced results.';
  if (status === 'paused') {
    return 'This crawl is paused and has no completed score yet. Run a new crawl to try again.';
  }
  if (failure) return [endSentence(failure.reason), failure.guidance].filter(Boolean).join(' ');
  return 'This crawl ended before it produced results. Run a new crawl to try again.';
}

function TerminalNotice({ crawl }: Readonly<{ crawl: SiteCrawl }>) {
  const failure = crawl.status === 'failed' ? crawlFailureCopy(crawl) : null;
  const message = terminalMessage(crawl.status, failure);
  return (
    <Alert tone={failure ? 'danger' : 'info'}>
      <RunNotice crawl={crawl} message={message} />
    </Alert>
  );
}

function DashboardNotice({ crawl }: Readonly<{ crawl: SiteCrawl }>) {
  const notice = dashboardRunNotice(crawl);
  const analyzed = crawl.counters.analyzed || crawl.analyzed_count;
  return (
    <ProgressRow
      crawl={crawl}
      narration={notice?.message ?? 'Latest crawl results'}
      counts={[
        { label: 'Pages discovered', value: crawl.visible_url_count },
        { label: 'Pages analyzed', value: analyzed, className: 'text-success-text' },
      ]}
    />
  );
}

function RunNotice({ crawl, message }: Readonly<{ crawl: SiteCrawl; message: string }>) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <CrawlStatusBadge crawl={crawl} />
      <span>{message}</span>
    </div>
  );
}

/**
 * The shared one-row shell: status badge + live narration on the left, the
 * inline counters on the right, wrapping on narrow screens. Extra content
 * (count-fetch warnings) stacks compactly underneath.
 */
function ProgressRow({
  crawl,
  narration,
  counts,
  active,
  children,
}: Readonly<{
  crawl: SiteCrawl;
  narration: string;
  counts: ReadonlyArray<{ label: string; value: number | null; className?: string }>;
  /** Show the live pulse — work is ongoing but not reflected in the counters. */
  active?: boolean;
  children?: ReactNode;
}>) {
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex min-w-0 items-center gap-3">
          <CrawlStatusBadge crawl={crawl} />
          <span className="type-body flex min-w-0 items-center gap-2">
            {active ? (
              <span
                aria-hidden
                data-testid="activity-pulse"
                className="activity-dot bg-info size-1.5 shrink-0"
              />
            ) : null}
            {/* The live region is the TEXT, not the row: announcing the whole
                  row would re-read every counter on each poll. */}
            <span className="truncate" aria-live="polite">
              {narration}
            </span>
          </span>
        </div>
        <dl className="ml-auto flex flex-wrap items-center gap-x-6 gap-y-1">
          {counts.map((count) => (
            <div key={count.label} className="type-body flex items-center gap-2">
              <dt className="type-label">{count.label}</dt>
              <dd className="m-0">
                {count.value === null ? (
                  <UnavailableValue state="not_measured" />
                ) : (
                  <span className={textRole('emphasis', cn('tabular-nums', count.className))}>
                    {count.value}
                  </span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      </div>
      {children}
    </div>
  );
}

function DiscoveryStrip({
  crawl,
  cancelPending,
}: Readonly<{
  crawl: SiteCrawl;
  cancelPending: boolean;
}>) {
  const provisional = isDiscoveryProvisional(crawl);
  const showTotal = canShowDiscoveredTotal(crawl);
  let narration: string;
  if (cancelPending) {
    narration = 'Stopping crawl — finishing the page in flight';
  } else if (provisional) {
    narration = `${discoveryProgressLabel(crawl)} — scanning continues in the background`;
  } else {
    narration = discoveryProgressLabel(crawl);
  }

  const counts: Array<{ label: string; value: number | null }> = [
    { label: 'Pages discovered', value: crawl.visible_url_count },
    { label: 'Pages analyzed', value: crawl.counters.analyzed },
  ];
  if (showTotal && crawl.total_url_count !== null) {
    counts.push({ label: 'Total discovered', value: crawl.total_url_count });
  }

  return (
    <ProgressRow crawl={crawl} narration={narration} counts={counts} active={!cancelPending} />
  );
}

function AnalysisStrip({
  crawl,
  cancelPending,
  pages,
  selectedTotal,
  selectedError,
}: Readonly<{
  crawl: SiteCrawl;
  cancelPending: boolean;
  pages: PageSummary[];
  selectedTotal: number | null;
  selectedError: boolean;
}>) {
  const summary = crawl.score_summary;
  const selected =
    crawl.counters.selected || summary?.selected_count || selectedTotal || pages.length;
  const narration = analysisNarration(crawl, cancelPending);

  return (
    <ProgressRow
      crawl={crawl}
      narration={narration}
      // Background re-discovery can leave the counters still; the pulse is
      // what distinguishes "working" from "stuck".
      active={!cancelPending && crawl.counters.activity.state !== 'stalled'}
      counts={analysisCounts(crawl, selected)}
    >
      {selectedError ? (
        <Alert tone="warning">
          Could not load the monitored-page count — progress totals may be approximate until it
          refreshes.
        </Alert>
      ) : null}
    </ProgressRow>
  );
}

type ProgressCount = { label: string; value: number | null; className?: string };

function analysisNarration(crawl: SiteCrawl, cancelPending: boolean): string {
  if (cancelPending) return 'Cancelling — finishing the page in flight and stopping';
  if (crawl.counters.activity.state === 'waiting') {
    return crawl.counters.activity.reason === 'host_gate'
      ? 'Waiting for the site host gate while the worker lease stays healthy'
      : 'Waiting for the next persisted retry window';
  }
  if (crawl.counters.activity.state === 'stalled')
    return 'Worker lease expired — recovery is pending';
  return !crawl.sample_mode && !isDiscoveryTerminal(crawl.discovery_status)
    ? 'Auditing monitored pages while discovery re-scans the site in the background'
    : 'Auditing monitored pages for Web Fundamentals and AEO issues';
}

function analysisCounts(crawl: SiteCrawl, selected: number): ProgressCount[] {
  const { counters } = crawl;
  const fixed: ProgressCount[] = [
    { label: 'Pages discovered', value: crawl.visible_url_count },
    { label: 'Pages selected', value: selected },
  ];
  const robots = counters.failure_breakdown.robots_denied;
  if (robots > 0) {
    fixed.push({ label: 'Blocked by robots.txt', value: robots, className: 'text-warning-text' });
  }
  return [
    ...fixed,
    ...(['http_4xx', 'http_5xx', 'timeout'] as const)
      .filter((code) => counters.failure_breakdown[code] > 0)
      .map((code) => ({
        label: code === 'timeout' ? 'Timeouts' : code.replace('_', ' ').toUpperCase(),
        value: counters.failure_breakdown[code],
        className: 'text-danger-text',
      })),
  ];
}
