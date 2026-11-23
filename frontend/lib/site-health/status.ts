/**
 * Site Health lifecycle / status presentation helpers — PURE.
 *
 * Maps the crawl overall/discovery/analysis sub-states, per-page analysis
 * states, and the neutral count-disclosure rules onto display view-models the
 * screens render without embedding business logic. No transport, no React.
 *
 * Key product rules encoded here:
 *   - discovery counts are PROVISIONAL until discovery terminalizes ("N pages
 *     discovered so far" vs "N pages discovered");
 *   - sample mode never renders a total placeholder or count-dependent copy —
 *     `total_url_count` is null and there is no "discovered so far";
 *   - error / blocked rows are explicit states, never a fabricated zero score;
 *   - missing / not-yet-analysed scores render an explicit not-measured label.
 */
import type {
  CrawlDiscoveryStatus,
  CrawlOverallStatus,
  PageAnalysisStatus,
  SiteCrawl,
} from '@citeladder/contracts';
import type { PagesSort } from '@/lib/api/site-health';
import type { RunStatusValue, StatusValue } from '@/components/ui/status-mark';
import { checksRunSchema, type InternalLinkAnalysis } from '@citeladder/contracts/site-health';
import type { z } from 'zod';
import { CRAWL_POLL_MS, CRAWL_VIEW_REFRESH_MS } from '@/lib/config/operational';
import { RERUN_POLL_INTERVAL_MS } from '@/lib/config/site-health';
import { pollWhileActive, type JobStates } from '@/lib/jobs/poll';
import { absent, availabilityLabel, formatCount, pluralCount, type Formatted } from '@/lib/format';
import { sentenceCaseStatus } from '@/lib/utils';

const INTERNAL_LINK_REASON_LABELS: Record<string, string> = {
  permission_unavailable: 'run permission unavailable',
  provider_unconfigured: 'analysis provider not configured',
  deadline_exceeded: 'time limit reached',
  interrupted_dispatch: 'interrupted requests',
  invalid_placement: 'missing or invalid placement answer',
};

export const INTERNAL_LINK_STATES = {
  queued: { label: 'Queued', badge: 'queued', active: true },
  running: { label: 'Running', badge: 'running', active: true },
  completed: { label: 'Complete', badge: 'completed', active: false },
  partial: { label: 'Partial', badge: 'partial', active: false },
  unavailable: { label: 'Unavailable', badge: 'draft', active: false },
  cancelled: { label: 'Cancelled', badge: 'cancelled', active: false },
  failed: { label: 'Failed', badge: 'failed', active: false },
} as const satisfies JobStates<InternalLinkAnalysis['state'], RunStatusValue>;

export const pollInternalLinks = (state: InternalLinkAnalysis['state'] | undefined) =>
  pollWhileActive(INTERNAL_LINK_STATES, RERUN_POLL_INTERVAL_MS, state);

export function internalLinkStateNotice(analysis: InternalLinkAnalysis) {
  const reasons = Object.entries(analysis.diagnostics?.reasons ?? {})
    .filter(([reason]) => !['no_placement', 'overlapping_placement'].includes(reason))
    .map(([reason, count]) => {
      const label = INTERNAL_LINK_REASON_LABELS[reason] ?? `unknown reason: ${reason}`;
      return `${label} (${formatCount(count)})`;
    })
    .join(', ');
  const detail = reasons ? `: ${reasons}` : '';
  if (analysis.state === 'cancelled') return 'This analysis was cancelled.';
  if (analysis.state === 'unavailable')
    return `No page pairs could be checked${detail}. Analyze again to retry.`;
  if (analysis.state === 'failed') return `This analysis failed${detail}. Analyze again to retry.`;
  if (analysis.state === 'partial' && reasons)
    return `Some page pairs were not checked: ${reasons}. These suggestions cover the rest.`;
  return null;
}

export const DEFAULT_PAGES_SORT: PagesSort = 'status';

export const CRAWL_STATES = {
  queued: { label: 'Queued', badge: 'queued', active: true },
  running: { label: 'Running', badge: 'running', active: true },
  completed: { label: 'Completed', badge: 'completed', active: false },
  partially_completed: { label: 'Partially Completed', badge: 'partial', active: false },
  failed: { label: 'Failed', badge: 'failed', active: false },
  cancelled: { label: 'Cancelled', badge: 'cancelled', active: false },
} as const satisfies JobStates<CrawlOverallStatus, RunStatusValue>;

const TERMINAL_DISCOVERY: ReadonlySet<CrawlDiscoveryStatus> = new Set<CrawlDiscoveryStatus>([
  'completed',
  'sample_completed',
  'failed',
  'cancelled',
]);

export function crawlPollInterval(
  crawl: Pick<SiteCrawl, 'status' | 'started_at' | 'created_at' | 'updated_at'>,
  now: number = Date.now(),
): number | false {
  const base = pollWhileActive(CRAWL_STATES, CRAWL_POLL_MS, crawl.status);
  if (base === false) return false;
  const startedAt = crawl.started_at ?? crawl.created_at;
  const running = _sinceMs(startedAt, now);
  if (running === null) return base;
  if (running >= 5 * 60_000) return 30_000;
  if (running >= 60_000) return 10_000;
  return base;
}

function _sinceMs(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null;
  const elapsed = now - new Date(iso).getTime();
  return Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : null;
}

export function isCrawlStalled(crawl: Pick<SiteCrawl, 'status' | 'counters'> | null): boolean {
  if (!crawl || !CRAWL_STATES[crawl.status].active) return false;
  return crawl.counters.activity.state === 'stalled';
}

export function isDiscoveryTerminal(status: CrawlDiscoveryStatus): boolean {
  return TERMINAL_DISCOVERY.has(status);
}

export function isDiscoveryProvisional(
  crawl: Pick<SiteCrawl, 'sample_mode' | 'discovery_status' | 'inventory_complete'>,
): boolean {
  if (crawl.sample_mode) return false;
  return !crawl.inventory_complete && !TERMINAL_DISCOVERY.has(crawl.discovery_status);
}

export function discoveryProgressLabel(
  crawl: Pick<
    SiteCrawl,
    'sample_mode' | 'discovery_status' | 'inventory_complete' | 'visible_url_count'
  >,
): string {
  const n = crawl.visible_url_count;
  if (crawl.sample_mode) {
    return `${n} sample ${pluralize(n, 'page')}`;
  }
  if (isDiscoveryProvisional(crawl)) {
    return `${n} ${pluralize(n, 'page')} discovered so far`;
  }
  return `${n} ${pluralize(n, 'page')} discovered`;
}

/**
 * Whether a discovered/total count may be shown at all: never for a sample
 * crawl, and never as a placeholder when the total is null on the wire.
 */
export function canShowDiscoveredTotal(
  crawl: Pick<SiteCrawl, 'sample_mode' | 'total_url_count'>,
): boolean {
  return !crawl.sample_mode && crawl.total_url_count !== null;
}

export type SiteHealthPhase =
  | 'resolving'
  | 'empty'
  | 'discovering'
  | 'analyzing'
  | 'dashboard'
  | 'terminal';

export type SeenProgress = { version: string; status: SiteCrawl['status']; refreshedAt: number };

export function crawlViewsDue(
  seen: SeenProgress,
  next: Omit<SeenProgress, 'refreshedAt'>,
  now: number,
): boolean {
  if (seen.version === next.version) return false;
  if (seen.status !== next.status || !CRAWL_STATES[next.status].active) return true;
  return now - seen.refreshedAt >= CRAWL_VIEW_REFRESH_MS;
}

export function crawlProgressVersion(
  crawl: Pick<
    SiteCrawl,
    | 'status'
    | 'discovery_status'
    | 'analysis_status'
    | 'visible_url_count'
    | 'analyzed_count'
    | 'failed_count'
    | 'updated_at'
  >,
): string {
  return [
    crawl.status,
    crawl.discovery_status,
    crawl.analysis_status,
    crawl.visible_url_count,
    crawl.analyzed_count,
    crawl.failed_count,
    crawl.updated_at ?? '',
  ].join('|');
}

export type InventoryMode = 'none' | 'discovering' | 'scored';

export function inventoryModeForPhase(
  phase: SiteHealthPhase,
  crawl?: Pick<SiteCrawl, 'status'> | null,
): InventoryMode {
  switch (phase) {
    case 'discovering':
      return 'discovering';
    case 'analyzing':
    case 'dashboard':
      return 'scored';
    case 'terminal':
      return crawl?.status === 'failed' ? 'scored' : 'none';
    case 'resolving':
    case 'empty':
      return 'none';
    default: {
      const unhandled: never = phase;
      return unhandled;
    }
  }
}

export function crawlDisplayStatus(
  crawl: Readonly<{ status: CrawlOverallStatus; partial_reason?: string | null }>,
): CrawlOverallStatus {
  return crawl.status === 'partially_completed' && crawl.partial_reason === 'discovery_incomplete'
    ? 'completed'
    : crawl.status;
}

export function pageStatusBadgeValue(status: PageAnalysisStatus): StatusValue {
  switch (status) {
    case 'completed':
      return 'success';
    case 'partially_completed':
      return 'warning';
    case 'failed':
    case 'error':
    case 'blocked':
    case 'cancelled':
      return 'danger';
    case 'not_selected':
    case 'not_measured':
    case 'pending':
    case 'running':
      return 'info';
    default: {
      const unhandled: never = status;
      return unhandled;
    }
  }
}

export function isFetchFailure(status: PageAnalysisStatus): boolean {
  return status === 'error' || status === 'blocked';
}

export function statusLabel(status: string): string {
  return sentenceCaseStatus(status);
}

export { formatScore } from '@/lib/format';

export type ChecksRun = z.infer<typeof checksRunSchema>;

export function checksRunLabel(checks: ChecksRun | null | undefined): string | null {
  if (!checks || checks.run >= checks.total) return null;
  return `${formatCount(checks.run)} of ${pluralCount(checks.total, 'check')} run`;
}

export function measurementCaveat(
  state: string | undefined,
  checks?: ChecksRun | null,
  reason?: string,
): string | null {
  if (state === 'measured') return null;
  if (state === 'limited_evidence') return checksRunLabel(checks) ?? 'Not every check ran';
  if (state === 'excluded') return 'Excluded from this audit';
  if (reason === 'unsupported_purpose_checklist') return 'Unsupported purpose checklist';
  return availabilityLabel('not_measured');
}

export function pageDisplayTitle(title: string | null, displayUrl: string): string {
  const trimmed = title?.trim();
  if (trimmed) return trimmed;
  let pathname: string;
  try {
    ({ pathname } = new URL(displayUrl));
  } catch {
    return displayUrl;
  }
  const segments = pathname.split('/').filter(Boolean);
  const last = segments.at(-1);
  return last ? `/${last}` : displayUrl;
}

export function formatIssueCount(count: number | null): Formatted {
  if (count === null) return absent();
  return `${count}`;
}

function pluralize(n: number, word: string): string {
  return n === 1 ? word : `${word}s`;
}
