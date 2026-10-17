import { describe, expect, it } from 'vite-plus/test';
import { render, screen } from '@testing-library/react';

import { StatusStrip } from './status-strip';
import type { SiteCrawl } from '@/lib/api/types';
import { COMPLETE_CLASSIFICATION_PROJECTION } from '@/test/site-health-fixtures';
import { makePageSummary as page, makeSiteCrawl } from '@/test/fixtures/site-health';

/** Mid-analysis: one of three selected pages scored, two still queued. */
function crawl(overrides: Partial<SiteCrawl> = {}): SiteCrawl {
  return makeSiteCrawl({
    project_id: '44444444-4444-4444-8444-444444444444',
    status: 'running',
    analysis_status: 'running',
    analyzed_count: 1,
    counters: {
      discovered: 3,
      selected: 3,
      queued: 2,
      running: 0,
      analyzed: 1,
      errors: 0,
      blocked: 0,
      failure_breakdown: {
        robots_denied: 0,
        http_4xx: 0,
        http_5xx: 0,
        timeout: 0,
      },
      activity: {
        state: 'working',
        reason: 'active_work',
        queue_depth: 2,
        next_available_at: null,
      },
      by_page_kind: {},
    },
    score_summary: {
      web_fundamentals_score: null,
      web_fundamentals_coverage: 0,
      web_fundamentals_state: 'not_measured',
      aeo_readiness_score: null,
      aeo_measurement_coverage: 0,
      aeo_measurement_state: 'not_measured',
      search_eligibility: 'unknown',
      selected_count: 3,
      analyzed_count: 1,
      issue_count: 0,
      scoring_version: 's1',
      ...COMPLETE_CLASSIFICATION_PROJECTION,
      classified_page_count: 1,
      classification_expected_page_count: 1,
      scored_page_kind_set: ['article'],
      scored_page_count_by_kind: { article: 1 },
      by_page_kind: {},
    },
    completed_at: null,
    ...overrides,
  });
}

function renderStrip(props: Partial<Parameters<typeof StatusStrip>[0]> = {}) {
  return render(
    <StatusStrip
      crawl={crawl()}
      phase="analyzing"
      cancelPending={false}
      startPending={false}
      pages={[]}
      selectedTotal={null}
      selectedError={false}
      {...props}
    />,
  );
}

describe('StatusStrip — analysis counters', () => {
  // The per-state breakdown — analyzed, in progress, queued — was removed from
  // this row: five numbers where two carry the story. What still matters is
  // that the totals come from the authoritative aggregate rather than the
  // bounded `pages` window, which is what these now guard.
  it('derives "Pages selected" from the server aggregate, not a truncated pages window', () => {
    // Only ONE monitored page is present in this (deliberately truncated)
    // `pages` prop, but the selected total says 3.
    renderStrip({
      pages: [page({ analysis_status: 'completed' })],
      selectedTotal: 3,
    });

    const totalLabel = screen.getByText('Pages selected');
    expect(totalLabel.parentElement?.textContent).toContain('3');
  });

  it('falls back to the persisted selected total while the monitored query loads', () => {
    renderStrip({
      crawl: crawl({ score_summary: null, analyzed_count: 0 }),
      selectedTotal: null,
    });

    const totalLabel = screen.getByText('Pages selected');
    expect(totalLabel.parentElement?.textContent).toContain('3');
  });

  it('surfaces a monitored-count fetch error instead of silently approximating', () => {
    renderStrip({ crawl: crawl({ score_summary: null }), selectedError: true });

    expect(screen.getByText(/Could not load the monitored-page count/)).toBeInTheDocument();
  });
});

describe('StatusStrip — analysis activity', () => {
  it('keeps the audit copy and live pulse while analysis is genuinely running', () => {
    renderStrip({
      crawl: crawl({
        status: 'running',
        analysis_status: 'running',
        score_summary: null,
      }),
      selectedTotal: 3,
    });

    expect(screen.getByText(/Auditing monitored pages/i)).toBeInTheDocument();
    expect(screen.getByTestId('activity-pulse')).toBeInTheDocument();
  });

  it('names blocked and failed categories from persisted task evidence', () => {
    renderStrip({
      crawl: crawl({
        score_summary: null,
        counters: {
          ...crawl().counters,
          blocked: 36,
          errors: 3,
          failure_breakdown: {
            robots_denied: 36,
            http_4xx: 1,
            http_5xx: 2,
            timeout: 0,
          },
        },
      }),
    });

    expect(screen.getByText('Blocked by robots.txt').parentElement?.textContent).toContain('36');
    expect(screen.getByText('HTTP 4XX').parentElement?.textContent).toContain('1');
    expect(screen.getByText('HTTP 5XX').parentElement?.textContent).toContain('2');
  });

  it('explains a persisted host-gate wait without calling it stalled', () => {
    renderStrip({
      crawl: crawl({
        score_summary: null,
        counters: {
          ...crawl().counters,
          activity: {
            state: 'waiting',
            reason: 'host_gate',
            queue_depth: 4,
            next_available_at: null,
          },
        },
      }),
    });

    expect(screen.getByText(/Waiting for the site host gate/i)).toBeInTheDocument();
  });

  it('prefers the cancelling narration over the link-check copy', () => {
    renderStrip({
      crawl: crawl({ status: 'running', analysis_status: 'completed' }),
      cancelPending: true,
      selectedTotal: 3,
    });

    expect(screen.getByText(/Cancelling/i)).toBeInTheDocument();
    expect(screen.queryByTestId('activity-pulse')).not.toBeInTheDocument();
  });
});

describe('StatusStrip — lifecycle content', () => {
  it('shows actionable paused copy without leaking a missing value', () => {
    renderStrip({
      phase: 'terminal',
      crawl: crawl({
        status: 'paused',
        analysis_status: 'stopped',
        analyzed_count: 0,
        score_summary: null,
      }),
    });

    expect(screen.getByText(/no completed score yet/i)).toBeInTheDocument();
    expect(screen.getByText(/Run a new crawl/i)).toBeInTheDocument();
    expect(screen.queryByText(/undefined/i)).not.toBeInTheDocument();
  });

  it('shows paused partial results with an explicit refresh action', () => {
    renderStrip({
      phase: 'dashboard',
      crawl: crawl({ status: 'paused', analysis_status: 'stopped' }),
    });

    expect(screen.getByText(/showing the pages analyzed so far/i)).toBeInTheDocument();
    expect(screen.getByText(/Run a new crawl/i)).toBeInTheDocument();
    expect(screen.queryByText(/undefined/i)).not.toBeInTheDocument();
  });

  it('narrates discovery with provisional copy while scanning', () => {
    renderStrip({
      phase: 'discovering',
      crawl: crawl({
        status: 'running',
        discovery_status: 'running',
        analysis_status: 'pending',
        inventory_complete: false,
        partial_reason: '',
        score_summary: null,
      }),
    });

    expect(screen.getByText(/3 pages discovered so far/)).toBeInTheDocument();
  });

  it('freezes behind a starting notice while a fresh crawl create is in flight', () => {
    // The old crawl's phase must not stay in view while a new crawl is being
    // created — a single notice covers the in-flight window.
    renderStrip({
      startPending: true,
      phase: 'terminal',
      crawl: crawl({ status: 'cancelled' }),
    });

    expect(screen.getByText(/Starting a fresh crawl/)).toBeInTheDocument();
    expect(screen.queryByText(/Discovery cancelled/)).not.toBeInTheDocument();
  });

  it('keeps the strip container mounted in every phase (canonical-screen invariant)', () => {
    const { rerender } = renderStrip({ phase: 'empty', crawl: null });
    const strip = screen.getByTestId('status-strip');

    for (const [phase, c] of [
      ['discovering', crawl({ discovery_status: 'running', score_summary: null })],
      ['analyzing', crawl({ score_summary: null })],
      ['dashboard', crawl({ status: 'completed' })],
      ['terminal', crawl({ status: 'failed', score_summary: null })],
    ] as const) {
      rerender(
        <StatusStrip
          crawl={c}
          phase={phase}
          cancelPending={false}
          startPending={false}
          pages={[]}
          selectedTotal={null}
          selectedError={false}
        />,
      );
      expect(screen.getByTestId('status-strip')).toBe(strip);
    }
  });
});
