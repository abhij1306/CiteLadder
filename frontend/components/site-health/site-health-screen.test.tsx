import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vite-plus/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { mswServer } from '@/test/msw-server';
import { COMPLETE_CLASSIFICATION_PROJECTION } from '@/test/site-health-fixtures';
import type { SiteHealthDashboard } from '@/lib/api/types';
import { queryKeys } from '@/lib/api/query-keys';
import {
  CRAWL,
  PROJECT,
  crawl,
  inventoryRow,
  mockRoutes,
  overview,
  project,
  renderScreen,
  setSearch,
} from './site-health-screen.test-support';

describe('SiteHealthScreen — Website tab deep links', () => {
  it('preserves Architecture from the URL on initial load', async () => {
    setSearch('tab=architecture');
    mockRoutes();
    mswServer.use(
      http.get(`/api/v1/projects/${PROJECT}/site-health/architecture`, () =>
        HttpResponse.json({
          state: 'unavailable',
          crawl_id: CRAWL,
          coverage_state: 'unknown',
          page_count: 0,
          page_kinds: [],
          nodes: [],
          internal_linking: {
            internal_link_count: 0,
            content_link_count: 0,
            pages_with_incoming_count: 0,
            pages_with_incoming_percentage: null,
            orphan_page_count: null,
          },
          structure_depth: {
            measured_page_count: 0,
            unmeasured_page_count: 0,
            buckets: [],
          },
          architecture_formula_version: 'sh-architecture-1',
          limitations: ['Architecture is not available yet.'],
        }),
      ),
    );

    renderScreen();

    expect(await screen.findByRole('tab', { name: 'Architecture' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(await screen.findByText('Architecture is not available yet.')).toBeVisible();
  });

  it('defaults to Overview after the crawl projection resolves', async () => {
    setSearch('tab=unknown');
    mockRoutes();

    renderScreen();

    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute(
        'aria-selected',
        'true',
      ),
    );
  });
});

describe('SiteHealthScreen — loading failures', () => {
  it('retries an initial dashboard read without starting a crawl', async () => {
    const user = userEvent.setup();
    let available = false;
    let reads = 0;
    mockRoutes();
    mswServer.use(
      http.get(`/api/v1/projects/${PROJECT}/site-health`, () => {
        reads += 1;
        return available
          ? HttpResponse.json({
              project_id: PROJECT,
              crawl: crawl(),
              score_summary: null,
              phase: 'dashboard',
              snapshot_id: null,
              quota: { used: 3, limit: 50 },
              root_errors: [],
            })
          : HttpResponse.json({ error: { message: 'Dashboard unavailable' } }, { status: 404 });
      }),
    );

    renderScreen();

    expect(await screen.findByText('Dashboard unavailable')).toBeVisible();
    expect(screen.queryByRole('tablist', { name: 'Website analysis' })).not.toBeInTheDocument();
    available = true;
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('tablist', { name: 'Website analysis' })).toBeVisible();
    expect(reads).toBe(2);
  });

  it('keeps same-project evidence visible when a background refresh fails', async () => {
    let available = true;
    mockRoutes();
    mswServer.use(
      http.get(`/api/v1/projects/${PROJECT}/site-health`, () =>
        available
          ? HttpResponse.json({
              project_id: PROJECT,
              crawl: crawl(),
              score_summary: null,
              phase: 'dashboard',
              snapshot_id: null,
              quota: { used: 3, limit: 50 },
              root_errors: [],
            })
          : HttpResponse.json({ error: { message: 'Dashboard refresh failed' } }, { status: 404 }),
      ),
    );

    const { queryClient } = renderScreen();
    expect(await screen.findByRole('tablist', { name: 'Website analysis' })).toBeVisible();

    available = false;
    void queryClient.invalidateQueries({ queryKey: queryKeys.siteHealth.dashboard(PROJECT) });

    expect(await screen.findByText('Dashboard refresh failed')).toBeVisible();
    expect(screen.getByRole('tablist', { name: 'Website analysis' })).toBeVisible();
  });
});

describe('SiteHealthScreen — recrawl', () => {
  it('reruns the shown crawl through its own recrawl route', async () => {
    const user = userEvent.setup();
    const recrawled: string[] = [];
    mockRoutes();
    mswServer.use(
      http.post('/api/v1/site-crawls/:crawlId/recrawl', ({ params }) => {
        recrawled.push(String(params.crawlId));
        return HttpResponse.json(
          crawl({ status: 'queued', discovery_status: 'pending', analysis_status: 'pending' }),
        );
      }),
    );

    renderScreen();

    const button = await screen.findByRole('button', { name: 'Recrawl' });
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);
    await waitFor(() => expect(recrawled).toEqual([CRAWL]));
  });
});

describe('SiteHealthScreen — before the first crawl', () => {
  it('shows one Run new crawl placeholder instead of empty metrics', async () => {
    const user = userEvent.setup();
    let createBody: unknown = null;
    let monitoredRequests = 0;
    mockRoutes();
    mswServer.use(
      http.get(`/api/v1/projects/${PROJECT}/site-health`, () =>
        HttpResponse.json({
          project_id: PROJECT,
          crawl: null,
          score_summary: null,
          phase: 'empty',
          snapshot_id: null,
          quota: { used: 0, limit: 50 },
          root_errors: [],
        }),
      ),
      http.get(`/api/v1/projects/${PROJECT}/monitored-urls`, () => {
        monitoredRequests += 1;
        return HttpResponse.json({
          project_id: PROJECT,
          selection_version: 1,
          monitored_urls: [],
          quota: { used: 0, limit: 50 },
        });
      }),
      http.post('/api/v1/site-crawls', async ({ request }) => {
        createBody = await request.json();
        return HttpResponse.json(
          crawl({
            status: 'queued',
            discovery_status: 'pending',
            analysis_status: 'pending',
            completed_at: null,
          }),
        );
      }),
    );

    renderScreen();

    expect(await screen.findByText('Run your first site crawl')).toBeVisible();
    expect(screen.queryByTestId('score-section')).not.toBeInTheDocument();
    const runButtons = screen.getAllByRole('button', { name: 'Run new crawl' });
    expect(runButtons).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Export' })).not.toBeInTheDocument();

    await waitFor(() => expect(monitoredRequests).toBe(1));
    await user.click(runButtons[0]!);
    await waitFor(() => expect(createBody).toEqual({ project_id: PROJECT }));
    await waitFor(() => expect(monitoredRequests).toBeGreaterThanOrEqual(2));
  });
});

describe('SiteHealthScreen — canonical single-screen flow (regression)', () => {
  it('walks discover → stop → new crawl → finish without resurrecting selection', async () => {
    const user = userEvent.setup();
    let createBody: unknown = null;
    const NEW_CRAWL = '99999999-9999-4999-8999-999999999999';
    const URL_ID = '66666666-6666-4666-8666-666666666666';
    const summary = {
      web_fundamentals_score: 80,
      web_fundamentals_coverage: 1,
      web_fundamentals_state: 'measured',
      aeo_readiness_score: 62,
      aeo_measurement_coverage: 0.8,
      aeo_measurement_state: 'measured',
      search_eligibility: 'eligible',
      selected_count: 1,
      analyzed_count: 1,
      issue_count: 3,
      scoring_version: 's1',
      ...COMPLETE_CLASSIFICATION_PROJECTION,
      classified_page_count: 1,
      classification_expected_page_count: 1,
      scored_page_kind_set: ['other'],
      scored_page_count_by_kind: { other: 1 },
      by_page_kind: {
        other: {
          analyzed_count: 1,
          web_fundamentals_score: 80,
          web_fundamentals_coverage: 1,
          web_fundamentals_state: 'measured',
          aeo_readiness_score: null,
          aeo_measurement_coverage: null,
          aeo_measurement_state: 'not_measured',
          aeo_measurement_reason: 'page_purpose_unresolved',
        },
      },
    };

    let serverCrawl = crawl({
      status: 'running',
      discovery_status: 'running',
      analysis_status: 'pending',
      inventory_complete: false,
      partial_reason: '',
      score_summary: null,
      completed_at: null,
    });
    let serverPhase: SiteHealthDashboard['phase'] = 'discovering';
    const monitored: Array<Record<string, unknown>> = [
      {
        site_url_id: URL_ID,
        normalized_url: 'https://acme.com/pricing',
        display_url: 'https://acme.com/pricing',
        title: null,
        active: true,
        selection_source: 'bootstrap',
        selected_at: '2026-07-16T00:00:00Z',
        deselected_at: null,
      },
    ];

    mswServer.use(
      http.get('/api/v1/projects', () => HttpResponse.json([project])),
      http.get(`/api/v1/projects/${PROJECT}/site-health`, () =>
        HttpResponse.json({
          project_id: PROJECT,
          crawl: serverCrawl,
          score_summary: serverCrawl.score_summary,
          phase: serverPhase,
          snapshot_id: null,
          quota: { used: monitored.length, limit: 50 },
          root_errors: [],
        }),
      ),
      http.get(`/api/v1/projects/${PROJECT}/monitored-urls`, () =>
        HttpResponse.json({
          project_id: PROJECT,
          selection_version: 1,
          monitored_urls: monitored,
          quota: { used: monitored.length, limit: 50 },
        }),
      ),
      http.post(`/api/v1/site-crawls/${serverCrawl.id}/cancel`, () => {
        serverCrawl = crawl({
          status: 'cancelled',
          discovery_status: 'cancelled',
          analysis_status: 'cancelled',
          score_summary: null,
          completed_at: null,
        });
        serverPhase = 'terminal';
        return HttpResponse.json(serverCrawl);
      }),
      http.post('/api/v1/site-crawls', async ({ request }) => {
        serverCrawl = crawl({
          id: NEW_CRAWL,
          status: 'running',
          discovery_status: 'running',
          analysis_status: 'pending',
          inventory_complete: false,
          partial_reason: '',
          score_summary: null,
          completed_at: null,
        });
        serverPhase = 'analyzing';
        createBody = await request.json();
        return HttpResponse.json(serverCrawl);
      }),
      http.get('/api/v1/site-crawls/:id/pages', () =>
        HttpResponse.json({ items: [], next_cursor: null, root_errors: [] }),
      ),
      http.get('/api/v1/site-crawls/:id/inventory', () =>
        HttpResponse.json({
          items: [inventoryRow(URL_ID, 'https://acme.com/pricing')],
          next_cursor: null,
        }),
      ),
      http.get('/api/v1/site-crawls/:id/events', () => HttpResponse.text('', { status: 200 })),
      http.get(`/api/v1/projects/${PROJECT}/site-health/overview`, () =>
        HttpResponse.json(overview(serverCrawl.id)),
      ),
    );

    const { queryClient } = renderScreen();

    await waitFor(() => expect(screen.queryByTestId('site-health-canonical')).toBeInTheDocument());
    const canonical = screen.getByTestId('site-health-canonical');
    expect(screen.getByText(/pages discovered so far/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Stop crawl' }));
    expect(
      await screen.findByText('This crawl was cancelled before it produced results.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Save selection/ })).not.toBeInTheDocument();
    expect(screen.getByTestId('site-health-canonical')).toBe(canonical);

    const recrawl = screen.getByRole('button', { name: 'Run new crawl' });
    await waitFor(() => expect(recrawl).toBeEnabled());
    await user.click(recrawl);

    await waitFor(() => expect(createBody).toMatchObject({ project_id: PROJECT }));

    expect(
      await screen.findByText(
        'Auditing monitored pages while discovery re-scans the site in the background',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Monitor https://acme.com/pricing')).not.toBeInTheDocument();
    expect(screen.getByTestId('site-health-canonical')).toBe(canonical);

    serverCrawl = crawl({
      id: NEW_CRAWL,
      status: 'completed',
      discovery_status: 'completed',
      analysis_status: 'completed',
      score_summary: summary,
    });
    serverPhase = 'dashboard';
    await queryClient.invalidateQueries();

    expect((await screen.findAllByText('80')).length).toBeGreaterThan(0);
    expect(
      screen.queryByText('Could not load Site Health. Please refresh.'),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run new crawl' })).toBeInTheDocument();
    expect(screen.getByTestId('site-health-overview')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
  });
});
