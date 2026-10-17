import { describe, expect, it } from 'vite-plus/test';

import {
  PLACEHOLDER,
  POLL_INTERVAL_MS,
  canShowDiscoveredTotal,
  crawlDisplayStatus,
  crawlFailureCopy,
  dashboardRunNotice,
  discoveryProgressLabel,
  formatAudited,
  formatIssueCount,
  formatScore,
  isAnalysisTerminal,
  crawlPollInterval,
  isCrawlCancelable,
  isCrawlStalled,
  isDiscoveryProvisional,
  isDiscoveryTerminal,
  isErrorRow,
  isSampleMode,
  crawlProgressVersion,
  shouldPollCrawl,
  statusLabel,
} from './status';

describe('polling / cancel / terminal predicates', () => {
  it('polls while not terminal, stops when terminal', () => {
    expect(shouldPollCrawl({ status: 'running' })).toBe(true);
    expect(shouldPollCrawl({ status: 'queued' })).toBe(true);
    expect(shouldPollCrawl({ status: 'completed' })).toBe(false);
    expect(shouldPollCrawl({ status: 'partially_completed' })).toBe(false);
    expect(shouldPollCrawl({ status: 'cancelled' })).toBe(false);
  });

  it('backs the poll cadence off as an active crawl ages', () => {
    const now = Date.parse('2026-07-29T12:00:00Z');
    const at = (msAgo: number) => ({
      status: 'running' as const,
      started_at: new Date(now - msAgo).toISOString(),
      created_at: new Date(now - msAgo).toISOString(),
      // Progressing: last write was just now, so it is never "silent".
      updated_at: new Date(now - 1_000).toISOString(),
    });

    expect(crawlPollInterval(at(5_000), now)).toBe(POLL_INTERVAL_MS);
    expect(crawlPollInterval(at(90_000), now)).toBe(10_000);
    expect(crawlPollInterval(at(6 * 60_000), now)).toBe(30_000);
  });

  it('never polls a terminal crawl regardless of age', () => {
    const now = Date.parse('2026-07-29T12:00:00Z');
    const iso = new Date(now - 1_000).toISOString();
    expect(
      crawlPollInterval(
        { status: 'completed', started_at: iso, created_at: iso, updated_at: iso },
        now,
      ),
    ).toBe(false);
  });

  it('keeps polling a long crawl that is still writing progress', () => {
    // The stall cutoff is about SILENCE, not duration: an hour-long crawl that
    // updated a second ago is healthy and must not be abandoned.
    const now = Date.parse('2026-07-29T12:00:00Z');
    const crawl = {
      status: 'running' as const,
      started_at: new Date(now - 3600_000).toISOString(),
      created_at: new Date(now - 3600_000).toISOString(),
      updated_at: new Date(now - 1_000).toISOString(),
    };
    expect(crawlPollInterval(crawl, now)).toBe(30_000);
    expect(
      isCrawlStalled({
        status: 'running',
        counters: { activity: { state: 'working' } },
      } as never),
    ).toBe(false);
  });

  it('does not infer a stall from silence and trusts expired-lease evidence', () => {
    const now = Date.parse('2026-07-29T12:00:00Z');
    const silent = new Date(now - 60 * 60_000).toISOString();
    const crawl = {
      status: 'running' as const,
      started_at: silent,
      created_at: silent,
      updated_at: silent,
    };
    expect(crawlPollInterval(crawl, now)).toBe(30_000);
    expect(
      isCrawlStalled({
        status: 'running',
        counters: { activity: { state: 'stalled' } },
      } as never),
    ).toBe(true);
  });

  it('is not stalled when the crawl is terminal or absent', () => {
    const now = Date.parse('2026-07-29T12:00:00Z');
    expect(isCrawlStalled(null, now)).toBe(false);
    expect(
      isCrawlStalled(
        {
          status: 'completed',
          counters: { activity: { state: 'stalled' } },
        } as never,
        now,
      ),
    ).toBe(false);
  });

  it('keeps polling when timestamps are unusable rather than giving up', () => {
    // Clock skew / a bad timestamp must degrade to the baseline cadence — the
    // one thing it must never do is silently stop progress.
    const now = Date.parse('2026-07-29T12:00:00Z');
    expect(
      crawlPollInterval(
        {
          status: 'running',
          started_at: null,
          created_at: 'not-a-date',
          updated_at: 'not-a-date',
        },
        now,
      ),
    ).toBe(POLL_INTERVAL_MS);
    expect(
      crawlPollInterval(
        {
          status: 'running',
          started_at: new Date(now + 60_000).toISOString(),
          created_at: new Date(now + 60_000).toISOString(),
          updated_at: new Date(now + 60_000).toISOString(),
        },
        now,
      ),
    ).toBe(POLL_INTERVAL_MS);
  });

  it('is cancelable only before terminal', () => {
    expect(isCrawlCancelable('running')).toBe(true);
    expect(isCrawlCancelable('draft')).toBe(true);
    expect(isCrawlCancelable('completed')).toBe(false);
    expect(isCrawlCancelable('failed')).toBe(false);
  });

  it('recognises terminal discovery / analysis sub-states', () => {
    expect(isDiscoveryTerminal('sample_completed')).toBe(true);
    expect(isDiscoveryTerminal('running')).toBe(false);
    expect(isAnalysisTerminal('partially_completed')).toBe(true);
    expect(isAnalysisTerminal('pending')).toBe(false);
  });
});

describe('discovery provisional / sample-mode copy', () => {
  const base = {
    sample_mode: false,
    discovery_status: 'running' as const,
    inventory_complete: false,
    visible_url_count: 42,
  };

  it('is provisional while discovery runs and inventory is incomplete', () => {
    expect(isDiscoveryProvisional(base)).toBe(true);
  });

  it('is not provisional once inventory is complete', () => {
    expect(isDiscoveryProvisional({ ...base, inventory_complete: true })).toBe(false);
  });

  it('is NEVER provisional for a sample-mode crawl, even mid-discovery', () => {
    // Sample discovery must never imply continued full-site scanning —
    // the shared helper enforces this directly rather than leaving it to
    // every caller to remember to check `sample_mode` first.
    expect(isDiscoveryProvisional({ ...base, sample_mode: true })).toBe(false);
  });

  it('renders "discovered so far" while provisional', () => {
    expect(discoveryProgressLabel(base)).toBe('42 pages discovered so far');
  });

  it('renders settled "discovered" once complete', () => {
    expect(
      discoveryProgressLabel({ ...base, discovery_status: 'completed', inventory_complete: true }),
    ).toBe('42 pages discovered');
  });

  it('renders sample copy (never a total or "so far")', () => {
    const sample = { ...base, sample_mode: true, inventory_complete: true, visible_url_count: 10 };
    expect(isSampleMode(sample)).toBe(true);
    expect(discoveryProgressLabel(sample)).toBe('10 sample pages');
    expect(discoveryProgressLabel(sample)).not.toContain('so far');
    expect(discoveryProgressLabel(sample)).not.toContain('discovered');
  });

  it('pluralizes a single page', () => {
    expect(
      discoveryProgressLabel({
        ...base,
        visible_url_count: 1,
        inventory_complete: true,
        discovery_status: 'completed',
      }),
    ).toBe('1 page discovered');
  });
});

describe('canShowDiscoveredTotal', () => {
  it('shows the total for a full crawl with a real total', () => {
    expect(canShowDiscoveredTotal({ sample_mode: false, total_url_count: 25000 })).toBe(true);
  });

  it('hides the total for a sample crawl', () => {
    expect(canShowDiscoveredTotal({ sample_mode: true, total_url_count: null })).toBe(false);
  });

  it('hides the total while it is still null (provisional)', () => {
    expect(canShowDiscoveredTotal({ sample_mode: false, total_url_count: null })).toBe(false);
  });
});

describe('crawlProgressVersion (single-subscription fan-out key)', () => {
  const base = {
    status: 'running' as const,
    discovery_status: 'running' as const,
    analysis_status: 'pending' as const,
    visible_url_count: 10,
    analyzed_count: 2,
    failed_count: 0,
    updated_at: '2026-07-16T00:00:00Z',
  };

  it('is stable for an unchanged crawl (a no-op poll refreshes nothing)', () => {
    expect(crawlProgressVersion(base)).toBe(crawlProgressVersion({ ...base }));
  });

  it('changes on every kind of progress the screen must react to', () => {
    const version = crawlProgressVersion(base);
    expect(crawlProgressVersion({ ...base, status: 'completed' })).not.toBe(version);
    expect(crawlProgressVersion({ ...base, discovery_status: 'completed' })).not.toBe(version);
    expect(crawlProgressVersion({ ...base, analysis_status: 'running' })).not.toBe(version);
    expect(crawlProgressVersion({ ...base, visible_url_count: 11 })).not.toBe(version);
    expect(crawlProgressVersion({ ...base, analyzed_count: 3 })).not.toBe(version);
    expect(crawlProgressVersion({ ...base, failed_count: 1 })).not.toBe(version);
    expect(crawlProgressVersion({ ...base, updated_at: '2026-07-16T00:00:05Z' })).not.toBe(version);
  });
});

describe('dashboardRunNotice', () => {
  const noticeBase = {
    analyzed_count: 3,
    error_message: '',
    failure_summary: null,
    partial_reason: '' as const,
  };

  it('returns null for a cleanly completed crawl (no notice)', () => {
    expect(dashboardRunNotice({ ...noticeBase, status: 'completed' })).toBeNull();
  });

  it('labels a cancelled dashboard explicitly with a Cancelled badge + info tone', () => {
    const notice = dashboardRunNotice({ ...noticeBase, status: 'cancelled' });
    expect(notice?.badge).toBe('cancelled');
    expect(notice?.tone).toBe('info');
    expect(notice?.message).toMatch(/cancelled/i);
    expect(notice?.message).toMatch(/re-crawl/i);
  });

  it('blames analysis only when analysis is what actually fell short', () => {
    const notice = dashboardRunNotice({
      ...noticeBase,
      status: 'partially_completed',
      partial_reason: 'analysis_incomplete',
    });
    expect(notice?.badge).toBe('partial');
    expect(notice?.tone).toBe('warning');
    expect(notice?.message).toMatch(/could not be analyzed/i);
  });

  it('shows no notice when only discovered links could not be fetched', () => {
    // Every real site has a few dead or non-page links; that is a normal crawl
    // with nothing to retry, so only an analysis shortfall earns a notice.
    const partial = { ...noticeBase, status: 'partially_completed' as const };
    expect(dashboardRunNotice({ ...partial, partial_reason: 'discovery_incomplete' })).toBeNull();
    expect(
      dashboardRunNotice({ ...partial, partial_reason: 'discovery_and_analysis_incomplete' }),
    ).toEqual({
      badge: 'partial',
      tone: 'warning',
      message:
        'Some pages could not be analyzed — showing partial results. Re-crawl to retry the remaining pages.',
    });
  });

  it('labels a paused dashboard with actionable partial-results copy', () => {
    const notice = dashboardRunNotice({ ...noticeBase, status: 'paused' });
    expect(notice?.badge).toBe('paused');
    expect(notice?.tone).toBe('info');
    expect(notice?.message).toMatch(/showing the pages analyzed so far/i);
    expect(notice?.message).toMatch(/run a new crawl/i);
    expect(notice?.message).not.toMatch(/undefined/i);
  });

  it('labels a failed-with-data dashboard with a Failed badge', () => {
    const notice = dashboardRunNotice({ ...noticeBase, status: 'failed' });
    expect(notice?.badge).toBe('failed');
    // Partial results exist — the "so far" phrasing stays, with the reason.
    expect(notice?.message).toMatch(/showing the pages analyzed so far/);
  });

  it('drops the "pages analyzed so far" claim when nothing was analyzed', () => {
    const notice = dashboardRunNotice({
      status: 'failed',
      partial_reason: '',
      analyzed_count: 0,
      error_message: '',
      failure_summary: {
        code: 'dns_resolution_failed',
        message: 'The domain could not be resolved (DNS)',
        attempts: 1,
        status_code: null,
        target_url: 'https://gone.example/',
      },
    });
    expect(notice?.badge).toBe('failed');
    expect(notice?.message).not.toMatch(/showing the pages analyzed so far/);
    expect(notice?.message).toContain('The run failed before any page was analyzed.');
    expect(notice?.message).toContain('The domain could not be resolved (DNS)');
    expect(notice?.message).toMatch(/domain is spelled correctly/);
  });
});

describe('crawlFailureCopy', () => {
  it('prefers the API-projected failure summary message + code-aware guidance', () => {
    const copy = crawlFailureCopy({
      error_message: 'row message only',
      failure_summary: {
        code: 'http_5xx',
        message: 'The site returned HTTP 500 after 3 attempts',
        attempts: 3,
        status_code: 500,
        target_url: 'https://acme.com/',
      },
    });
    expect(copy.reason).toBe('The site returned HTTP 500 after 3 attempts');
    expect(copy.guidance).toMatch(/server trouble/i);
  });

  it('falls back to error_message, then to a neutral sentence — never a bare code', () => {
    const fromError = crawlFailureCopy({
      error_message: 'The site returned HTTP 404 for the start URL',
      failure_summary: null,
    });
    expect(fromError.reason).toBe('The site returned HTTP 404 for the start URL');
    expect(fromError.guidance).toBe('Re-crawl to try again.');

    const neutral = crawlFailureCopy({ error_message: '', failure_summary: null });
    expect(neutral.reason).toBe('This crawl failed before it produced results.');
  });
});

describe('badge mapping', () => {
  it('classifies error/blocked rows explicitly (not zero scores)', () => {
    expect(isErrorRow('failed')).toBe(true);
    expect(isErrorRow('error')).toBe(true);
    expect(isErrorRow('blocked')).toBe(true);
    expect(isErrorRow('cancelled')).toBe(true);
    expect(isErrorRow('completed')).toBe(false);
  });

  it('reads a crawl that only missed unreachable links as completed', () => {
    expect(
      crawlDisplayStatus({ status: 'partially_completed', partial_reason: 'discovery_incomplete' }),
    ).toBe('completed');
    expect(
      crawlDisplayStatus({ status: 'partially_completed', partial_reason: 'analysis_incomplete' }),
    ).toBe('partially_completed');
    expect(crawlDisplayStatus({ status: 'failed', partial_reason: null })).toBe('failed');
  });
});

describe('score / count / date placeholders', () => {
  it('renders not measured for a null or NaN score (never 0 for missing)', () => {
    expect(formatScore(null)).toBe(PLACEHOLDER);
    expect(formatScore(Number.NaN)).toBe(PLACEHOLDER);
    expect(formatScore(0)).toBe('0');
    // Whole numbers: the tenth is an artefact of the division, not a
    // measurement, and it changes with one check on one page.
    expect(formatScore(88.25)).toBe('88');
    expect(formatScore(27.210884353741495)).toBe('27');
  });

  it('renders not measured for a null issue count', () => {
    expect(formatIssueCount(null)).toBe(PLACEHOLDER);
    expect(formatIssueCount(0)).toBe('0');
    expect(formatIssueCount(4)).toBe('4');
  });

  it('renders not measured for a null last-audited', () => {
    expect(formatAudited(null)).toBe(PLACEHOLDER);
    expect(formatAudited('not-a-date')).toBe('not-a-date');
  });

  it('titleizes snake_case status tokens', () => {
    expect(statusLabel('sample_completed')).toBe('Sample Completed');
    expect(statusLabel('running')).toBe('Running');
  });
});
