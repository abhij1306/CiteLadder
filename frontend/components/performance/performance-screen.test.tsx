import { http, HttpResponse } from 'msw';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vite-plus/test';
import { act, screen, waitFor } from '@testing-library/react';

import { makeProject } from '@/test/fixtures/project';
import { mswServer } from '@/test/msw-server';
import { renderWithProviders } from '@/test/render';
import type { PerformanceDashboard } from '@/lib/api/performance';
import { useRangeProjection } from './use-range-projection';
import type { ProjectRequestScope } from '@/lib/project/request-scope';

const WORKSPACE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PROJECT = '11111111-1111-4111-8111-111111111111';
const SNAPSHOT = '22222222-2222-4222-8222-222222222222';
const TASK = '33333333-3333-4333-8333-333333333333';
const activeProject = makeProject({ id: PROJECT, workspace_id: WORKSPACE });

vi.mock('@/components/integrations/data-source-setup', () => ({
  DataSourceSetup: ({ title }: { title: string }) => <section aria-label={title} />,
}));
vi.mock('@/lib/project/project-context', () => ({
  useActiveWorkspaceId: () => WORKSPACE,
  useProjectContext: () => ({ activeProject, isLoading: false }),
}));
vi.mock('@/lib/api/integrations', () => ({ integrationsApi: { list: vi.fn(async () => []) } }));
vi.mock('./use-performance-sync', () => ({
  usePerformanceSync: () => ({
    mutation: { mutate: vi.fn(), isPending: false },
    notice: null,
    outcome: null,
    startedAt: null,
    syncing: false,
    error: null,
  }),
}));

import { PerformanceScreen } from './performance-screen';

const emptyTotals: PerformanceDashboard['selected']['totals'] = {
  clicks: null,
  impressions: null,
  ctr: null,
  position: null,
  sessions: null,
  key_events: null,
};
const emptySeries = { clicks: [], impressions: [], ctr: [], position: [] };
const dimensionCounts = {
  query: 0,
  page: 0,
  country: 0,
  device: 0,
  search_appearance: 0,
  day: 0,
  bing_query: 0,
  bing_page: 0,
};

function dashboard(overrides: Record<string, unknown> = {}) {
  return {
    project_id: PROJECT,
    range: 'last_synced',
    granularity: 'day',
    compare: 'none',
    selected: {
      snapshot_id: null,
      window_start: '',
      window_end: '',
      evidence_state: 'not_run',
      totals: emptyTotals,
      series: emptySeries,
    },
    comparison: null,
    coverage: { earliest_date: null, latest_date: null, covered_days: 0, analytics_quality: {} },
    dimension_counts: dimensionCounts,
    unavailable_dimensions: ['search_appearance'],
    formula_version: 'traffic-formula-1',
    normalization_version: 'traffic-normalization-1',
    ...overrides,
  };
}

function measuredWindow(totals: typeof emptyTotals) {
  return {
    snapshot_id: SNAPSHOT,
    window_start: '2026-08-01',
    window_end: '2026-08-28',
    evidence_state: Object.values(totals).some((value) => value !== null && value !== 0)
      ? 'available'
      : 'observed_zero',
    totals,
    series: emptySeries,
  };
}

function tablePage(dimension: string) {
  return { dimension, items: [], next_cursor: null, total_count: 0, page_size: 25 };
}

beforeAll(() => mswServer.listen({ onUnhandledRequest: 'error' }));
const readiness = {
  project_id: PROJECT,
  stage: 'not_connected',
  connection_count: 0,
  providers: [],
  backfill_state: null,
  imported_through: null,
  has_performance_snapshot: false,
  has_demand_snapshot: false,
  opportunity_count: 0,
};
beforeEach(() =>
  mswServer.use(
    http.get(`/api/v1/projects/${PROJECT}/readiness`, () => HttpResponse.json(readiness)),
  ),
);
afterEach(() => {
  mswServer.resetHandlers();
});
afterAll(() => mswServer.close());

describe('PerformanceScreen evidence states', () => {
  it.each(['window', 'project'])(
    'ignores a late range response after the selected %s changes',
    async (change) => {
      let release!: () => void;
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      let enqueued = 0;
      const polled: string[] = [];
      const latestTask = '33333333-3333-4333-8333-333333333334';
      const nextProject = change === 'project' ? '11111111-1111-4111-8111-111111111112' : PROJECT;
      mswServer.use(
        http.post('/api/v1/projects/:projectId/performance/range', async ({ request }) => {
          const index = ++enqueued;
          const params = new URL(request.url).searchParams;
          if (index === 1) await pending;
          return HttpResponse.json({
            task_id: index === 1 ? TASK : latestTask,
            status: 'queued',
            window_start: params.get('from'),
            window_end: params.get('to'),
          });
        }),
        http.get('/api/v1/projects/:projectId/performance/range/:taskId', ({ params }) => {
          polled.push(String(params.taskId));
          return HttpResponse.json({
            task_id: params.taskId,
            status: 'running',
            window_start: '2026-08-02',
            window_end: '2026-08-28',
          });
        }),
      );
      function Harness({ scope, from }: { scope: ProjectRequestScope; from: string }) {
        const data = dashboard({
          selected: { ...measuredWindow(emptyTotals), snapshot_id: null, window_start: from },
        }) as PerformanceDashboard;
        const { projecting } = useRangeProjection(scope, data);
        return <output>{projecting ? 'Projecting' : 'Idle'}</output>;
      }
      const { rerender, queryClient } = renderWithProviders(
        <Harness
          scope={{ workspaceId: WORKSPACE, projectId: PROJECT, enabled: true }}
          from="2026-08-01"
        />,
      );
      await waitFor(() => expect(enqueued).toBe(1));
      rerender(
        <Harness
          scope={{ workspaceId: WORKSPACE, projectId: nextProject, enabled: true }}
          from="2026-08-02"
        />,
      );
      await waitFor(() => expect(polled).toContain(latestTask));
      release();
      await waitFor(() => expect(queryClient.isMutating()).toBe(0));
      expect(polled).not.toContain(TASK);
      expect(screen.getByText('Projecting')).toBeVisible();
    },
  );
  it('starts readiness alongside the dashboard and presents one settled first-use state', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    let dashboardRead = false;
    let readinessRead = false;
    mswServer.use(
      http.get(`/api/v1/projects/${PROJECT}/performance`, async () => {
        dashboardRead = true;
        await pending;
        return HttpResponse.json(dashboard());
      }),
      http.get(`/api/v1/projects/${PROJECT}/readiness`, async () => {
        readinessRead = true;
        await pending;
        return HttpResponse.json(readiness);
      }),
    );
    renderWithProviders(<PerformanceScreen />);
    await waitFor(() => expect(dashboardRead && readinessRead).toBe(true));
    // The `status` announcement is held back until the spinner becomes visible.
    expect(await screen.findByRole('status', { name: 'Loading performance…' })).toBeInTheDocument();
    expect(screen.queryByText('No search performance evidence yet')).not.toBeInTheDocument();
    act(() => release());
    expect(await screen.findByText('No search performance evidence yet')).toBeVisible();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('paints the dashboard while a slow readiness read is still pending', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    mswServer.use(
      http.get(`/api/v1/projects/${PROJECT}/performance`, () => HttpResponse.json(dashboard())),
      http.get(`/api/v1/projects/${PROJECT}/readiness`, async () => {
        await pending;
        // A settled stage the ladder renders visibly, so the final assertion
        // can only pass once the released response has updated the screen.
        return HttpResponse.json({ ...readiness, stage: 'importing' });
      }),
    );
    renderWithProviders(<PerformanceScreen />);

    // The dashboard alone controls first paint: the advisory readiness ladder
    // must not hold the whole surface on the slowest of two independent reads.
    expect(await screen.findByText('No search performance evidence yet')).toBeVisible();
    expect(screen.queryByTestId('readiness-ladder')).not.toBeInTheDocument();

    act(() => release());
    expect(await screen.findByTestId('readiness-ladder')).toBeVisible();
  });

  it('shows first-use guidance without metric or table scaffolding', async () => {
    let tableReads = 0;
    mswServer.use(
      http.get(`/api/v1/projects/${PROJECT}/performance`, () => HttpResponse.json(dashboard())),
      http.get(`/api/v1/projects/${PROJECT}/performance/table`, ({ request }) => {
        tableReads += 1;
        return HttpResponse.json(tablePage(new URL(request.url).searchParams.get('dimension')!));
      }),
    );

    renderWithProviders(<PerformanceScreen />);

    expect(await screen.findByText('No search performance evidence yet')).toBeVisible();
    expect(screen.queryByTestId('metric-card-strip')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('tablist', { name: 'Performance breakdowns' }),
    ).not.toBeInTheDocument();
    expect(tableReads).toBe(0);
  });

  it('renders measured zero and requests its exact Search Console snapshot', async () => {
    let tableSnapshot: string | null = null;
    const selected = measuredWindow({ ...emptyTotals, clicks: 0, impressions: 0 });
    mswServer.use(
      http.get(`/api/v1/projects/${PROJECT}/performance`, () =>
        HttpResponse.json(
          dashboard({
            selected,
            coverage: { earliest_date: '2026-08-01', latest_date: '2026-08-28', covered_days: 28 },
          }),
        ),
      ),
      http.get(`/api/v1/projects/${PROJECT}/performance/table`, ({ request }) => {
        const params = new URL(request.url).searchParams;
        tableSnapshot = params.get('snapshot_id');
        return HttpResponse.json(tablePage(params.get('dimension')!));
      }),
    );

    renderWithProviders(<PerformanceScreen />);

    expect(await screen.findByTestId('metric-card-strip')).toBeVisible();
    await waitFor(() => expect(tableSnapshot).toBe(SNAPSHOT));
    expect(screen.queryByText('No search performance evidence yet')).not.toBeInTheDocument();
  });

  it('keeps GA4-only evidence visible without empty GSC tables', async () => {
    const tableDimensions: string[] = [];
    const response = dashboard({
      selected: measuredWindow({ ...emptyTotals, sessions: 0, key_events: 0 }),
      coverage: { earliest_date: '2026-08-01', latest_date: '2026-08-28', covered_days: 28 },
    });
    mswServer.use(
      http.get(`/api/v1/projects/${PROJECT}/performance`, () => HttpResponse.json(response)),
      http.get(`/api/v1/projects/${PROJECT}/performance/table`, ({ request }) => {
        const dimension = new URL(request.url).searchParams.get('dimension')!;
        tableDimensions.push(dimension);
        return HttpResponse.json(tablePage(dimension));
      }),
    );

    renderWithProviders(<PerformanceScreen />);
    expect(await screen.findByTestId('ga4-summary')).toBeVisible();
    expect(screen.queryByTestId('metric-card-strip')).not.toBeInTheDocument();
    expect(tableDimensions).toEqual([]);
  });

  it('renders persisted Search Console dimensions when headline totals are unavailable', async () => {
    const tableDimensions: string[] = [];
    mswServer.use(
      http.get(`/api/v1/projects/${PROJECT}/performance`, () =>
        HttpResponse.json(
          dashboard({
            selected: { ...measuredWindow(emptyTotals), evidence_state: 'available' },
            dimension_counts: { ...dimensionCounts, query: 1 },
            coverage: { earliest_date: '2026-08-01', latest_date: '2026-08-28', covered_days: 28 },
          }),
        ),
      ),
      http.get(`/api/v1/projects/${PROJECT}/performance/table`, ({ request }) => {
        const dimension = new URL(request.url).searchParams.get('dimension')!;
        tableDimensions.push(dimension);
        return HttpResponse.json(tablePage(dimension));
      }),
    );

    renderWithProviders(<PerformanceScreen />);

    expect(await screen.findByRole('tablist', { name: 'Performance breakdowns' })).toBeVisible();
    await waitFor(() => expect(tableDimensions).toContain('query'));
    expect(screen.queryByTestId('metric-card-strip')).not.toBeInTheDocument();
  });

  it('keeps Bing-only evidence visible without empty GSC tables', async () => {
    const tableDimensions: string[] = [];
    const response = dashboard({
      selected: { ...measuredWindow(emptyTotals), evidence_state: 'not_run' },
      dimension_counts: { ...dimensionCounts, bing_query: 1 },
      coverage: { earliest_date: null, latest_date: null, covered_days: 0 },
    });
    mswServer.use(
      http.get(`/api/v1/projects/${PROJECT}/performance`, () => HttpResponse.json(response)),
      http.get(`/api/v1/projects/${PROJECT}/performance/table`, ({ request }) => {
        const dimension = new URL(request.url).searchParams.get('dimension')!;
        tableDimensions.push(dimension);
        return HttpResponse.json(tablePage(dimension));
      }),
    );

    renderWithProviders(<PerformanceScreen />);

    expect(await screen.findByTestId('bing-panel')).toBeVisible();
    await waitFor(() => expect(tableDimensions).toContain('bing_query'));
    expect(tableDimensions).not.toContain('query');
  });

  it('does not present Bing without evidence in the selected snapshot', async () => {
    mswServer.use(
      http.get(`/api/v1/projects/${PROJECT}/performance`, () => HttpResponse.json(dashboard())),
    );

    renderWithProviders(<PerformanceScreen />);

    expect(await screen.findByText('No search performance evidence yet')).toBeVisible();
    expect(screen.queryByTestId('bing-panel')).not.toBeInTheDocument();
  });

  it('keeps range projection mounted through completion', async () => {
    let ready = false;
    let enqueueCount = 0;
    const missing = dashboard({
      selected: {
        snapshot_id: null,
        window_start: '2026-08-01',
        window_end: '2026-08-28',
        evidence_state: 'not_run',
        totals: emptyTotals,
        series: emptySeries,
      },
      coverage: { earliest_date: '2026-08-01', latest_date: '2026-08-28', covered_days: 28 },
    });
    const complete = dashboard({
      selected: measuredWindow({ ...emptyTotals, clicks: 0, impressions: 0 }),
      coverage: { earliest_date: '2026-08-01', latest_date: '2026-08-28', covered_days: 28 },
    });
    mswServer.use(
      http.get(`/api/v1/projects/${PROJECT}/performance`, () =>
        HttpResponse.json(ready ? complete : missing),
      ),
      http.post(`/api/v1/projects/${PROJECT}/performance/range`, () => {
        enqueueCount += 1;
        return HttpResponse.json({
          task_id: TASK,
          status: 'queued',
          window_start: '2026-08-01',
          window_end: '2026-08-28',
        });
      }),
      http.get(`/api/v1/projects/${PROJECT}/performance/range/${TASK}`, () => {
        ready = true;
        return HttpResponse.json({
          task_id: TASK,
          status: 'succeeded',
          window_start: '2026-08-01',
          window_end: '2026-08-28',
        });
      }),
      http.get(`/api/v1/projects/${PROJECT}/performance/table`, ({ request }) =>
        HttpResponse.json(tablePage(new URL(request.url).searchParams.get('dimension')!)),
      ),
    );

    renderWithProviders(<PerformanceScreen />);

    expect(await screen.findByTestId('metric-card-strip')).toBeVisible();
    expect(enqueueCount).toBe(1);
  });
});
