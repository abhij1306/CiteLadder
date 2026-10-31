import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vite-plus/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { mswServer } from '@/test/msw-server';
import { COMPLETE_CLASSIFICATION_PROJECTION } from '@/test/site-health-fixtures';
import { CRAWL, PROJECT, crawl, mockRoutes, renderScreen } from './site-health-screen.test-support';

describe('SiteHealthScreen — terminal states on the canonical screen', () => {
  it('renders an explicit terminal notice (not the active-progress UI) for a failed crawl', async () => {
    mockRoutes({ status: 'failed', error_message: 'Robots.txt denied crawling.' }, 'terminal');

    renderScreen();

    expect(
      await screen.findByText(/Robots\.txt denied crawling\. Re-crawl to try again\./),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run new crawl' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stop crawl' })).not.toBeInTheDocument();
    const scores = screen.getByTestId('score-section');
    expect(scores).toBeInTheDocument();
    expect(within(scores).getAllByText('Not measured').length).toBeGreaterThanOrEqual(3);
  });

  it('routes a failed crawl with a PRESENT-but-null-score summary to terminal (the failed-crawl shape)', async () => {
    mockRoutes(
      {
        status: 'failed',
        analysis_status: 'failed',
        analyzed_count: 0,
        score_summary: {
          ...COMPLETE_CLASSIFICATION_PROJECTION,
          classified_page_count: 0,
          classification_expected_page_count: 0,
          classification_coverage: null,
          classification_state: 'not_measured',
          classification_source_analysis_ids: [],
          classification_source_artifact_ids: [],
          classification_source_task_ids: [],
          scored_page_kind_set: [],
          scored_page_count_by_kind: {},
          web_fundamentals_score: null,
          web_fundamentals_coverage: 0,
          web_fundamentals_state: 'not_measured',
          aeo_readiness_score: null,
          aeo_measurement_coverage: 0,
          aeo_measurement_state: 'not_measured',
          search_eligibility: 'unknown',
          selected_count: 0,
          analyzed_count: 0,
          issue_count: 0,
          scoring_version: 's1',
          by_page_kind: {},
        },
        failure_summary: {
          code: 'http_5xx',
          message: 'The site returned HTTP 500 after 3 attempts',
          attempts: 3,
          status_code: 500,
          target_url: 'https://acme.com/',
        },
        error_message: 'The site returned HTTP 500 after 3 attempts',
      },
      'terminal',
    );

    renderScreen();

    expect(
      await screen.findByText(
        /The site returned HTTP 500 after 3 attempts\. The site is having server trouble/,
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Not measured').length).toBeGreaterThan(0);
    expect(screen.queryByText('Across 0 of 0 pages')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run new crawl' })).toBeInTheDocument();
  });

  it('renders the root-failure block on the Errors & Blocked tab for a failed crawl', async () => {
    const user = userEvent.setup();
    mockRoutes(
      {
        status: 'failed',
        analysis_status: 'failed',
        analyzed_count: 0,
        error_message: 'The site returned HTTP 404 for the start URL',
      },
      'terminal',
    );
    mswServer.use(
      http.get(`/api/v1/site-crawls/${CRAWL}/pages`, () =>
        HttpResponse.json({
          items: [],
          next_cursor: null,
          root_errors: [
            {
              method: 'GET',
              target: 'https://acme.com/',
              outcome: 'error',
              error_code: 'http_4xx',
              status_code: 404,
              latency_ms: 120,
            },
          ],
        }),
      ),
    );

    renderScreen();

    await screen.findByText(/The site returned HTTP 404 for the start URL/);
    await user.click(screen.getByRole('tab', { name: 'Errors & Blocked' }));
    const block = await screen.findByTestId('root-errors-block');
    expect(within(block).getByText('http_4xx')).toBeInTheDocument();
    expect(within(block).getByText('HTTP 404')).toBeInTheDocument();
    expect(within(block).getByText('https://acme.com/')).toBeInTheDocument();
    expect(within(block).queryByRole('link')).not.toBeInTheDocument();
  });

  it('shows generic terminal copy for a cancelled crawl with NOTHING discovered', async () => {
    mockRoutes({ status: 'cancelled', error_message: '', visible_url_count: 0 }, 'terminal');

    renderScreen();

    expect(
      await screen.findByText('This crawl was cancelled before it produced results.'),
    ).toBeInTheDocument();
  });

  it('does not resurrect the removed selection step after cancellation', async () => {
    mockRoutes({ status: 'cancelled', error_message: '', visible_url_count: 3 }, 'terminal');

    renderScreen();

    expect(
      await screen.findByText('This crawl was cancelled before it produced results.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Discovery finished/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Save selection/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Monitor https:\/\/acme\.com/)).not.toBeInTheDocument();
  });

  it('offers one Stop crawl action while discovering', async () => {
    let hiddenPagesRequests = 0;
    mockRoutes(
      {
        status: 'running',
        discovery_status: 'running',
        analysis_status: 'pending',
        score_summary: null,
      },
      'discovering',
    );
    mswServer.use(
      http.get(`/api/v1/site-crawls/${CRAWL}/pages`, () => {
        hiddenPagesRequests += 1;
        return HttpResponse.json({ items: [], next_cursor: null, root_errors: [] });
      }),
    );

    renderScreen();

    await waitFor(() => expect(screen.queryByText(/Discovering pages/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Stop crawl' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Run new crawl' })).not.toBeInTheDocument();
    expect(hiddenPagesRequests).toBe(0);
  });

  it('reveals completed pages progressively in the first active audit view', async () => {
    const user = userEvent.setup();
    const requestedStatuses: Array<string | null> = [];
    mockRoutes(
      {
        status: 'running',
        discovery_status: 'running',
        analysis_status: 'running',
        inventory_complete: false,
        partial_reason: '',
        score_summary: null,
      },
      'analyzing',
    );
    mswServer.use(
      http.get(`/api/v1/site-crawls/${CRAWL}/pages`, ({ request }) => {
        requestedStatuses.push(new URL(request.url).searchParams.get('status'));
        return HttpResponse.json({ items: [], next_cursor: null, root_errors: [] });
      }),
    );

    renderScreen();

    expect(await screen.findByRole('tab', { name: 'Audited so far' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await waitFor(() => expect(requestedStatuses).toContain('completed'));

    await user.click(screen.getByRole('tab', { name: 'All Discovered' }));
    await waitFor(() => expect(requestedStatuses).toContain(null));
    // Selecting another tab never renames this one (or shifts the strip).
    expect(screen.getByRole('tab', { name: 'Audited so far' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });

  it('defaults partial results to Overview and keeps the cancelled Pages view available', async () => {
    const user = userEvent.setup();
    const summary = {
      web_fundamentals_score: 80,
      web_fundamentals_coverage: 1,
      web_fundamentals_state: 'measured',
      aeo_readiness_score: 62,
      aeo_measurement_coverage: 0.8,
      aeo_measurement_state: 'measured',
      search_eligibility: 'eligible',
      selected_count: 10,
      analyzed_count: 4,
      issue_count: 3,
      scoring_version: 's1',
      ...COMPLETE_CLASSIFICATION_PROJECTION,
      by_page_kind: {
        article: {
          analyzed_count: 4,
          web_fundamentals_score: 80,
          web_fundamentals_coverage: 1,
          web_fundamentals_state: 'measured',
          aeo_readiness_score: 62,
          aeo_measurement_coverage: 0.8,
          aeo_measurement_state: 'measured',
          aeo_measurement_reason: '',
        },
      },
    };
    mockRoutes();
    mswServer.use(
      http.get(`/api/v1/projects/${PROJECT}/site-health`, () =>
        HttpResponse.json({
          project_id: PROJECT,
          crawl: crawl({
            status: 'cancelled',
            discovery_status: 'cancelled',
            analysis_status: 'cancelled',
            score_summary: summary,
          }),
          score_summary: summary,
          phase: 'dashboard',
          snapshot_id: null,
          quota: { used: 4, limit: 50 },
          root_errors: [],
        }),
      ),
    );

    renderScreen();

    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute(
        'aria-selected',
        'true',
      ),
    );
    expect((await screen.findAllByText('80')).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('tab', { name: 'Pages' }));
    expect(
      await screen.findByText(/This run was cancelled — showing the pages analyzed so far/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Classification completeness' }),
    ).not.toBeInTheDocument();
    const breakdown = screen.getByTestId('page-kind-scores');
    expect(breakdown).toBeInTheDocument();
    expect(within(breakdown).getByText('Article')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run new crawl' })).toBeInTheDocument();
    expect(
      screen.queryByText('This crawl was cancelled before it produced results.'),
    ).not.toBeInTheDocument();
  });
});
