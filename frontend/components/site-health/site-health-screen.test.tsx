import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vite-plus/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { mswServer } from '@/test/msw-server';
import { COMPLETE_CLASSIFICATION_PROJECTION } from '@/test/site-health-fixtures';
import type { SiteHealthDashboard } from '@citeladder/contracts';
import { queryKeys } from '@/lib/api/query-keys';
import { refreshSiteHealthDashboard } from '@/lib/api/site-health-queries';
import {
  CRAWL,
  PROJECT,
  crawl,
  crawlSchedule,
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
    // The pages export belongs to the Pages table's toolbar: another tab has none.
    expect(screen.getByRole('button', { name: 'Run new crawl' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export CSV' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Pages' }));
    expect(await screen.findByRole('button', { name: 'Export CSV' })).toBeInTheDocument();
  });

  it('opens on Pages for a finished crawl, from the loading frame onward', async () => {
    setSearch('tab=unknown');
    const dashboard = held();
    mockRoutes();
    mswServer.use(
      http.get(`/api/v1/projects/${PROJECT}/site-health`, async () => {
        await dashboard.released;
        return HttpResponse.json(finishedDashboard());
      }),
    );

    renderScreen();

    // The loading frame already selects Pages, so the selection never moves.
    expect(await screen.findByRole('tab', { name: 'Pages' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    dashboard.release();
    expect(await screen.findByTestId('site-health-canonical')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Pages' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByTestId('site-health-overview')).not.toBeInTheDocument();
  });

  it('keeps a tab the reader picked while a new crawl starts', async () => {
    const user = userEvent.setup();
    const started: unknown[] = [];
    mockRoutes();
    mswServer.use(
      http.post('/api/v1/site-crawls', async ({ request }) => {
        started.push(await request.json());
        return HttpResponse.json(crawl({ status: 'running', analysis_status: 'pending' }));
      }),
    );

    renderScreen();
    await user.click(await screen.findByRole('tab', { name: 'Overview' }));
    expect(
      await screen.findByRole('img', { name: 'Web Fundamentals score: 80 out of 100' }),
    ).toBeInTheDocument();

    const start = screen.getByRole('button', { name: 'Run new crawl' });
    await waitFor(() => expect(start).toBeEnabled());
    await user.click(start);
    await waitFor(() => expect(started).toEqual([{ project_id: PROJECT }]));
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    expect(new URLSearchParams(window.location.search).get('tab')).toBe('overview');
  });
});

describe('SiteHealthScreen — Pages tab reads', () => {
  it('reads the first Monitored page once for the progress strip and the page browser', async () => {
    setSearch('tab=pages');
    mockRoutes();
    const reads: string[] = [];
    mswServer.use(
      http.get(`/api/v1/site-crawls/${CRAWL}/pages`, ({ request }) => {
        const params = new URL(request.url).searchParams;
        reads.push(`${params.get('monitored')}|${params.get('sort')}|${params.get('limit')}`);
        return HttpResponse.json({ items: [], next_cursor: null, root_errors: [] });
      }),
    );

    renderScreen();

    expect(await screen.findByText('No pages in this view')).toBeVisible();
    expect(reads).toEqual(['true|status|10']);
  });

  it('draws the page views and page-kind filter from the address, only on Pages', async () => {
    const user = userEvent.setup();
    setSearch('tab=pages&pages_view=errors&page_kind=faq');
    mockRoutes();

    renderScreen();

    const views = await screen.findByRole('radiogroup', { name: 'Page inventory views' });
    expect(within(views).getByRole('radio', { name: 'Errors & Blocked' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('button', { name: /^Page kind: (?!All page kinds)/ })).toBeVisible();

    await user.click(screen.getByRole('tab', { name: 'Overview' }));
    const params = new URLSearchParams(window.location.search);
    expect([params.get('tab'), params.get('pages_view'), params.get('page_kind')]).toEqual([
      'overview',
      null,
      null,
    ]);
    expect(screen.queryByRole('radiogroup', { name: 'Page inventory views' })).toBeNull();
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
    // The crawl's own controls mean the evidence has loaded; the tab row alone
    // is already drawn by the loading frame.
    expect(await screen.findByRole('button', { name: 'Run new crawl' })).toBeVisible();

    available = false;
    void refreshSiteHealthDashboard(queryClient, PROJECT);

    expect(await screen.findByText('Dashboard refresh failed')).toBeVisible();
    expect(screen.getByRole('tablist', { name: 'Website analysis' })).toBeVisible();
  });
});

/** A response the test releases when it chooses, so a loading frame can be inspected. */
function held() {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { release, released };
}

function finishedDashboard() {
  return {
    project_id: PROJECT,
    crawl: crawl(),
    score_summary: null,
    phase: 'dashboard',
    snapshot_id: null,
    quota: { used: 3, limit: 50 },
    root_errors: [],
  };
}

function loadingRegions() {
  return document.querySelectorAll('[data-query-state="loading"]');
}

describe('SiteHealthScreen — loading frames', () => {
  it('shows one loading box under the tab row until the Overview arrives, never a lone score row', async () => {
    setSearch('tab=overview');
    const dashboard = held();
    const snapshot = held();
    mockRoutes();
    mswServer.use(
      http.get(`/api/v1/projects/${PROJECT}/site-health`, async () => {
        await dashboard.released;
        return HttpResponse.json(finishedDashboard());
      }),
      http.get(`/api/v1/projects/${PROJECT}/site-health/overview`, async () => {
        await snapshot.released;
        return HttpResponse.json(overview());
      }),
    );

    renderScreen();

    // The crawl is still being read: the loaded page's tab row, one box.
    expect(await screen.findByRole('tablist', { name: 'Website analysis' })).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    expect(loadingRegions()).toHaveLength(1);
    expect(screen.queryByTestId('overview-metrics')).not.toBeInTheDocument();

    // The crawl is known but its Overview is not: still the one box, no scores.
    dashboard.release();
    expect(await screen.findByRole('button', { name: 'Run new crawl' })).toBeVisible();
    expect(loadingRegions()).toHaveLength(1);
    expect(screen.queryByTestId('overview-metrics')).not.toBeInTheDocument();

    snapshot.release();
    expect(
      await screen.findByRole('img', { name: 'Web Fundamentals score: 80 out of 100' }),
    ).toBeInTheDocument();
    expect(loadingRegions()).toHaveLength(0);
  });

  it('keeps the loaded Overview on screen while a refresh is in flight', async () => {
    setSearch('tab=overview');
    let refresh: ReturnType<typeof held> | null = null;
    mockRoutes();
    mswServer.use(
      http.get(`/api/v1/projects/${PROJECT}/site-health`, async () => {
        await refresh?.released;
        return HttpResponse.json(finishedDashboard());
      }),
      http.get(`/api/v1/projects/${PROJECT}/site-health/overview`, async () => {
        await refresh?.released;
        return HttpResponse.json(overview());
      }),
    );

    const { queryClient } = renderScreen();
    expect(
      await screen.findByRole('img', { name: 'Web Fundamentals score: 80 out of 100' }),
    ).toBeInTheDocument();

    refresh = held();
    void queryClient.invalidateQueries({ queryKey: queryKeys.siteHealth.all });
    await waitFor(() =>
      expect(queryClient.isFetching({ queryKey: queryKeys.siteHealth.all })).toBeGreaterThan(0),
    );

    expect(
      screen.getByRole('img', { name: 'Web Fundamentals score: 80 out of 100' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Website analysis' })).toBeVisible();
    expect(loadingRegions()).toHaveLength(0);
    refresh.release();
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
    expect(screen.queryByTestId('status-strip')).not.toBeInTheDocument();
    const runButtons = screen.getAllByRole('button', { name: 'Run new crawl' });
    expect(runButtons).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Export CSV' })).not.toBeInTheDocument();

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
      http.get(`/api/v1/projects/${PROJECT}`, () => HttpResponse.json(project)),
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
    expect(screen.getByRole('tab', { name: 'Pages' })).toHaveAttribute('aria-selected', 'true');

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
    // Finishing the crawl never moves the reader off Pages (owner, 2026-11-02).
    expect(screen.getByRole('tab', { name: 'Pages' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('site-health-canonical')).toBe(canonical);
    expect(screen.queryByTestId('site-health-overview')).not.toBeInTheDocument();
  });
});

describe('SiteHealthScreen — crawl schedule', () => {
  /** Opens the schedule menu of a schedule that is off, once it has loaded. */
  async function openOffSchedule() {
    const trigger = await screen.findByRole('button', { name: 'Crawl schedule: Off' });
    await waitFor(() => expect(trigger).toBeEnabled());
    await userEvent.click(trigger);
    return screen.findByRole('menu');
  }

  it('turns on a weekly crawl beside Run new crawl and shows the next run', async () => {
    mockRoutes();
    const saved: unknown[] = [];
    mswServer.use(
      http.put(`/api/v1/projects/${PROJECT}/crawl-schedule`, async ({ request }) => {
        saved.push(await request.json());
        return HttpResponse.json(
          crawlSchedule({ enabled: true, next_run_at: '2027-01-11T09:00:00Z' }),
        );
      }),
    );

    renderScreen();

    await openOffSchedule();
    await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Weekly' }));

    await waitFor(() => expect(saved).toEqual([{ enabled: true, cadence: 'weekly' }]));
    await userEvent.click(await screen.findByRole('button', { name: 'Crawl schedule: Weekly' }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByText(/Next crawl/)).toHaveTextContent('Next crawl Jan 11, 2027');
  });

  it('says why a schedule that kept failing turned itself off', async () => {
    mockRoutes();
    mswServer.use(
      http.get(`/api/v1/projects/${PROJECT}/crawl-schedule`, () =>
        HttpResponse.json(crawlSchedule({ last_outcome: 'failed' })),
      ),
    );

    renderScreen();

    const menu = await openOffSchedule();
    expect(
      within(menu).getByText('Turned off: scheduled crawls kept failing to start.'),
    ).toBeVisible();
    expect(within(menu).queryByText(/Next crawl/)).not.toBeInTheDocument();
  });

  it('says scheduled crawls keep the latest crawl’s choice to ignore robots.txt', async () => {
    mockRoutes({
      robots: {
        handling: 'ignore',
        decided_by_email: 'owner@example.test',
        decided_at: '2026-01-02T03:04:05.000Z',
      },
    });

    renderScreen();

    expect(
      within(await openOffSchedule()).getByText(
        'Ignores robots.txt (confirmed by owner@example.test)',
      ),
    ).toBeVisible();
  });

  it('tells an unreadable schedule apart from one that is off', async () => {
    mockRoutes();
    mswServer.use(
      http.get(`/api/v1/projects/${PROJECT}/crawl-schedule`, () =>
        HttpResponse.json(
          {
            error: {
              code: 'internal_error',
              message: 'unavailable',
              request_id: 'req-1',
              retryable: false,
            },
          },
          { status: 500 },
        ),
      ),
    );

    renderScreen();

    expect(await screen.findByRole('button', { name: 'Schedule unavailable' })).toBeDisabled();
  });
});
