import type { RunStatusValue } from '@/components/ui/status-mark';
import type { SiteCrawl } from '@citeladder/contracts';

import { endSentence } from '@/lib/format';

import { crawlDisplayStatus } from './status';

/**
 * Reason + what-to-do copy for a failed crawl, shared by the
 * terminal card and the dashboard run notice. The reason prefers the
 * API-projected `failure_summary.message` (humanized by the worker from the
 * terminal fetch evidence), falls back to the crawl row's `error_message`,
 * then to a neutral sentence — never a bare machine code.
 */
export type CrawlFailureCopy = { reason: string; guidance: string };

function failureGuidanceFor(code: string | undefined): string {
  switch (code) {
    case 'dns_resolution_failed':
      return 'Check that the domain is spelled correctly and publicly reachable, then re-crawl.';
    case 'connection_failed':
    case 'timeout':
      return 'The site may be down or blocking automated traffic. Re-crawl to try again.';
    case 'robots_denied':
      return "Allow the crawler in the site's robots.txt, then re-crawl.";
    case 'robots_unavailable':
      return 'This is usually temporary. Re-crawl to try again.';
    case 'access_blocked':
      return 'Re-crawling will not help until the site’s security settings allow the crawler.';
    case 'bot_blocked':
      return 'Allowlist the crawler with the site’s bot protection, then re-crawl.';
    case 'http_4xx':
      return 'Check that the start URL is correct and publicly reachable, then re-crawl.';
    case 'http_5xx':
      return 'The site is having server trouble. This is often temporary. Re-crawl to try again.';
    case 'ssrf_blocked':
      return 'Choose a publicly reachable start URL, then re-crawl.';
    default:
      return 'Re-crawl to try again.';
  }
}

const guidanceFor = (code: string | undefined) =>
  code?.startsWith('tls_cert_')
    ? 'Browsers and AI crawlers refuse this certificate too. Fix or renew it, then re-crawl.'
    : failureGuidanceFor(code);

export function crawlFailureCopy(
  crawl: Pick<SiteCrawl, 'error_message' | 'failure_summary'>,
): CrawlFailureCopy {
  const reason =
    crawl.failure_summary?.message ||
    crawl.error_message ||
    'This crawl failed before it produced results.';
  return { reason, guidance: guidanceFor(crawl.failure_summary?.code) };
}

export type DashboardRunNotice = {
  badge: RunStatusValue;
  tone: 'info' | 'warning';
  message: string;
} | null;

const ANALYSIS_INCOMPLETE =
  'Some pages could not be analyzed. Partial results are shown. Re-crawl to retry the remaining pages.';

const PARTIAL_FALLBACK =
  'This crawl finished with partial results. Everything it analyzed is shown.';

function partialCrawlNotice(partialReason: string): DashboardRunNotice {
  switch (partialReason) {
    case 'analysis_incomplete':
    case 'discovery_and_analysis_incomplete':
      return { badge: 'partial', tone: 'warning', message: ANALYSIS_INCOMPLETE };
    default:
      return { badge: 'partial', tone: 'warning', message: PARTIAL_FALLBACK };
  }
}

export function dashboardRunNotice(
  crawl: Pick<
    SiteCrawl,
    'status' | 'analyzed_count' | 'error_message' | 'failure_summary' | 'partial_reason'
  >,
): DashboardRunNotice {
  switch (crawlDisplayStatus(crawl)) {
    case 'cancelled':
      return {
        badge: 'cancelled',
        tone: 'info',
        message:
          'This run was cancelled. The pages analyzed so far are shown. Re-crawl to complete the analysis.',
      };
    case 'partially_completed':
      return partialCrawlNotice(crawl.partial_reason);
    case 'failed': {
      const { reason, guidance } = crawlFailureCopy(crawl);
      // With zero pages analyzed there is no "so far" to show — lead
      // with the failure reason instead of promising partial results.
      const headline =
        crawl.analyzed_count === 0
          ? 'The run failed before any page was analyzed.'
          : 'The run failed before finishing. The pages analyzed so far are shown.';
      return {
        badge: 'failed',
        tone: 'warning',
        message: `${headline} ${endSentence(reason)} ${guidance}`,
      };
    }
    default:
      return null;
  }
}
