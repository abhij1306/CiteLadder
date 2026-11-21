import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Inline, Stack } from '@/components/ui/layout';
import { Spinner } from '@/components/ui/spinner';
import { Absence } from '@/components/ui/absence';
import type { SiteCrawl } from '@citeladder/contracts';
import { useDisplayTimeZone } from '@/lib/display-timezone';
import { endSentence, formatCount, formatStripTimestamp } from '@/lib/format';
import { ICONS } from '@/lib/icons';
import { CrawlStatusBadge } from '@/components/site-health/crawl-status-badge';
import { crawlFailureCopy, dashboardRunNotice } from '@/lib/site-health/run-notice';
import {
  canShowDiscoveredTotal,
  discoveryProgressLabel,
  isDiscoveryTerminal,
  type SiteHealthPhase,
} from '@/lib/site-health/status';
import { Notice } from '@/components/ui/notice';
import { Section } from '@/components/ui/section';
import { StateBlock } from '@/components/ui/state-block';

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
  onRerun,
}: Readonly<{
  crawl: SiteCrawl | null;
  phase: SiteHealthPhase;
  cancelPending: boolean;
  onRerun?: () => void;
  startPending: boolean;
}>) {
  return (
    <div className="grid empty:hidden" data-testid="status-strip">
      <StripContent
        crawl={crawl}
        phase={phase}
        cancelPending={cancelPending}
        startPending={startPending}
        onRerun={onRerun}
      />
    </div>
  );
}

function StripContent({
  crawl,
  phase,
  cancelPending,
  startPending,
  onRerun,
}: Readonly<{
  crawl: SiteCrawl | null;
  phase: SiteHealthPhase;
  cancelPending: boolean;
  startPending: boolean;
  onRerun?: () => void;
}>) {
  if (startPending) {
    return <Notice tone="info">{crawl ? 'Starting a fresh crawl.' : 'Starting crawl.'}</Notice>;
  }

  if (phase === 'resolving') return null;

  if (!crawl || phase === 'empty') {
    return <StateBlock kind="empty" icon={ICONS.siteHealth} heading="No crawl yet" />;
  }

  if (phase === 'discovering') {
    return <DiscoveryStrip crawl={crawl} cancelPending={cancelPending} />;
  }

  if (phase === 'analyzing') {
    return <AnalysisStrip crawl={crawl} cancelPending={cancelPending} />;
  }

  if (phase === 'terminal') return <TerminalNotice crawl={crawl} onRerun={onRerun} />;
  return <DashboardNotice crawl={crawl} />;
}

function terminalMessage(
  status: SiteCrawl['status'],
  failure: ReturnType<typeof crawlFailureCopy> | null,
): string {
  if (status === 'cancelled') return 'This crawl was cancelled before it produced results.';
  if (failure) return [endSentence(failure.reason), failure.guidance].filter(Boolean).join(' ');
  return 'This crawl ended before it produced results. Run a new crawl to try again.';
}

function TerminalNotice({ crawl, onRerun }: Readonly<{ crawl: SiteCrawl; onRerun?: () => void }>) {
  const failure = crawl.status === 'failed' ? crawlFailureCopy(crawl) : null;
  const message = terminalMessage(crawl.status, failure);
  if (failure)
    return (
      <Notice
        kind="mutation"
        notice={{ message, retryable: false }}
        recovery={
          onRerun ? (
            <Button type="button" variant="secondary" onClick={onRerun}>
              Crawl again
            </Button>
          ) : undefined
        }
      />
    );
  return (
    <Notice tone="info">
      <RunNotice crawl={crawl} message={message} />
    </Notice>
  );
}

function DashboardNotice({ crawl }: Readonly<{ crawl: SiteCrawl }>) {
  const timeZone = useDisplayTimeZone();
  const notice = dashboardRunNotice(crawl);
  const ranAt = crawl.completed_at ?? crawl.started_at ?? crawl.created_at;
  return (
    <ProgressRow
      crawl={crawl}
      narration={notice?.message ?? `Latest crawl · ${formatStripTimestamp(ranAt, timeZone)}`}
      counts={[]}
    />
  );
}

function RunNotice({ crawl, message }: Readonly<{ crawl: SiteCrawl; message: string }>) {
  return (
    <Inline className="flex-wrap">
      <CrawlStatusBadge crawl={crawl} />
      <span>{message}</span>
    </Inline>
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
  counts: readonly ProgressCount[];
  active?: boolean;
  children?: ReactNode;
}>) {
  return (
    <Section aria-label="Crawl status">
      <Stack>
        <Inline gap="meta" className="justify-between">
          <Inline gap="item" className="min-w-0">
            <CrawlStatusBadge crawl={crawl} />
            {active ? (
              <span data-testid="activity-pulse" className="inline-flex">
                <Spinner />
              </span>
            ) : null}
            <span className="type-body min-w-0" aria-live="polite">
              {narration}
            </span>
          </Inline>
          <Inline as="dl" gap="meta" className="empty:hidden">
            {counts.map((count) => (
              <Inline key={count.label} gap="item">
                <dt className="type-body text-ink-2">{count.label}</dt>
                <dd className="type-body text-ink tabular-nums">
                  {count.value === null ? (
                    <Absence state="not_measured" />
                  ) : (
                    formatCount(count.value)
                  )}
                </dd>
              </Inline>
            ))}
          </Inline>
        </Inline>
        {children}
      </Stack>
    </Section>
  );
}

function DiscoveryStrip({
  crawl,
  cancelPending,
}: Readonly<{
  crawl: SiteCrawl;
  cancelPending: boolean;
}>) {
  const showTotal = canShowDiscoveredTotal(crawl);
  let narration: string;
  if (cancelPending) {
    narration = 'Stopping crawl…';
  } else {
    narration = discoveryProgressLabel(crawl);
  }

  const counts: ProgressCount[] = [];
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
}: Readonly<{ crawl: SiteCrawl; cancelPending: boolean }>) {
  return (
    <ProgressRow
      crawl={crawl}
      narration={analysisNarration(crawl, cancelPending)}
      active={!cancelPending && crawl.counters.activity.state !== 'stalled'}
      counts={analysisCounts(crawl)}
    />
  );
}

type ProgressCount = { label: string; value: number | null };

function analysisNarration(crawl: SiteCrawl, cancelPending: boolean): string {
  if (cancelPending) return 'Cancelling…';
  if (crawl.counters.activity.state === 'waiting') {
    return crawl.counters.activity.reason === 'host_gate'
      ? 'Waiting for the site host'
      : 'Waiting to retry';
  }
  if (crawl.counters.activity.state === 'stalled') return 'Stalled. Recovery is pending.';
  return !crawl.sample_mode && !isDiscoveryTerminal(crawl.discovery_status)
    ? 'Auditing monitored pages; discovery is re-scanning'
    : 'Auditing monitored pages';
}

function analysisCounts(crawl: SiteCrawl): ProgressCount[] {
  const { counters } = crawl;
  const fixed: ProgressCount[] = [];
  const robots = counters.failure_breakdown.robots_denied;
  if (robots > 0) {
    fixed.push({ label: 'Blocked by robots.txt', value: robots });
  }
  return [
    ...fixed,
    ...(['http_4xx', 'http_5xx', 'timeout'] as const)
      .filter((code) => counters.failure_breakdown[code] > 0)
      .map((code) => ({
        label: FAILURE_LABELS[code],
        value: counters.failure_breakdown[code],
      })),
  ];
}

const FAILURE_LABELS = {
  http_4xx: 'HTTP 4xx',
  http_5xx: 'HTTP 5xx',
  timeout: 'Timeouts',
} as const;
