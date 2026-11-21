import { QueryClient } from '@tanstack/react-query';
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

import { siteHealthDashboardSchema } from '@citeladder/contracts/site-health';

import {
  AGENT_NAV_ITEMS,
  DASHBOARD_GROUPS,
  FOOT_NAV_ITEMS,
  NEW_CHAT_ITEM,
} from '@/components/layout/nav-items';
import { actionsQueries, DEFAULT_ACTION_TREE } from '@/lib/api/actions';
import { agentQueries } from '@/lib/api/agent';
import { commerceQueries } from '@/lib/api/commerce';
import { demandApi, demandQueries } from '@/lib/api/demand';
import { projectQueries } from '@/lib/api/projects';
import { queryKeys } from '@/lib/api/query-keys';
import { runsQueries } from '@/lib/api/runs';
import { siteHealthQueries } from '@/lib/api/site-health-queries';
import { INITIAL_VISIBILITY_PARAMS } from '@/lib/api/visibility';
import { visibilityQueries } from '@/lib/api/visibility-queries';
import { DEFAULT_PRODUCT_FILTERS, productSearch } from '@/lib/products/product-filters';
import { pendingOverviewHandlers, recordedProjectRead } from '@/test/fixtures/overview';
import { makeSiteCrawl } from '@/test/fixtures/site-health';
import { mswServer } from '@/test/msw-server';
import { prefetchRoute } from './route-prefetch';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const CRAWL_ID = '22222222-2222-4222-8222-222222222222';
const PROJECT = {
  projectId: PROJECT_ID,
  workspaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
};

const DASHBOARD = siteHealthDashboardSchema.parse({
  project_id: PROJECT_ID,
  crawl: makeSiteCrawl({
    id: CRAWL_ID,
    workspace_id: PROJECT.workspaceId,
    project_id: PROJECT_ID,
    status: 'completed',
  }),
  score_summary: null,
  phase: 'dashboard',
  snapshot_id: null,
  quota: { used: 1, limit: 50 },
  root_errors: [],
});
function heldAnswer() {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { held, release: () => release() };
}
const previewKey = siteHealthQueries.pages(PROJECT.workspaceId, CRAWL_ID, {
  limit: 10,
  monitored: true,
  sort: 'status',
}).queryKey;

beforeAll(() => mswServer.listen({ onUnhandledFrame: 'error' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

describe('prefetchRoute', () => {
  let client: QueryClient;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(demandApi, 'getLatest').mockResolvedValue({ id: 'snapshot' } as never);
    client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } });
  });

  it('does nothing without an active project', () => {
    prefetchRoute(client, '/search-intelligence', null);
    expect(demandApi.getLatest).not.toHaveBeenCalled();
  });

  it('warms the Search Demand snapshot the Keywords page opens on', async () => {
    prefetchRoute(client, '/search-intelligence', PROJECT);
    await vi.waitFor(() => expect(demandApi.getLatest).toHaveBeenCalledTimes(1));
  });

  it('warms the Website page preview under a cached dashboard’s crawl', async () => {
    client.setQueryData(siteHealthQueries.dashboard(PROJECT).queryKey, DASHBOARD);
    const asked: string[] = [];
    mswServer.use(
      http.get(`/api/v1/projects/${PROJECT_ID}/site-health`, () => {
        asked.push('dashboard');
        return HttpResponse.json(DASHBOARD);
      }),
      http.get(`/api/v1/site-crawls/${CRAWL_ID}/pages`, ({ request }) => {
        asked.push('pages ' + new URL(request.url).search);
        return HttpResponse.json({ error: { message: 'not here' } }, { status: 404 });
      }),
    );
    prefetchRoute(client, '/site', PROJECT);

    await vi.waitFor(() => expect(asked).toEqual(['pages ?limit=10&monitored=true&sort=status']));
  });

  it('asks for a cold Website preview beside the dashboard and files it under the crawl it names', async () => {
    const asked: string[] = [];
    const page = { items: [], next_cursor: null, root_errors: [] };
    const dashboard = heldAnswer();
    mswServer.use(
      http.get(`/api/v1/projects/${PROJECT_ID}/site-health`, async () => {
        asked.push('dashboard');
        await dashboard.held;
        return HttpResponse.json(DASHBOARD);
      }),
      http.get(`/api/v1/projects/${PROJECT_ID}/site-health/pages`, ({ request }) => {
        asked.push('latest pages ' + new URL(request.url).search);
        return HttpResponse.json({ ...page, crawl_id: CRAWL_ID, crawl_status: 'completed' });
      }),
    );
    prefetchRoute(client, '/site', PROJECT);

    await vi.waitFor(() => expect(client.getQueryData(previewKey)).toEqual(page));
    expect([...asked].sort()).toEqual([
      'dashboard',
      'latest pages ?limit=10&monitored=true&sort=status',
    ]);
    dashboard.release();
  });

  it('asks for a cold Website preview once however often the reader hovers', async () => {
    const asked: string[] = [];
    const page = { items: [], next_cursor: null, root_errors: [] };
    const latest = heldAnswer();
    mswServer.use(
      http.get(`/api/v1/projects/${PROJECT_ID}/site-health`, () => {
        asked.push('dashboard');
        return HttpResponse.json({ error: { message: 'down' } }, { status: 500 });
      }),
      http.get(`/api/v1/projects/${PROJECT_ID}/site-health/pages`, async () => {
        asked.push('latest pages');
        await latest.held;
        return HttpResponse.json({ ...page, crawl_id: CRAWL_ID, crawl_status: 'completed' });
      }),
    );

    prefetchRoute(client, '/site', PROJECT);
    prefetchRoute(client, '/site', PROJECT);
    await vi.waitFor(() => expect(asked).toContain('latest pages'));
    prefetchRoute(client, '/site', PROJECT);
    latest.release();
    await vi.waitFor(() => expect(client.getQueryData(previewKey)).toEqual(page));
    prefetchRoute(client, '/site', PROJECT);
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });

    expect(asked.filter((request) => request === 'latest pages')).toEqual(['latest pages']);
  });

  it('asks for a cold issue catalog once however often the reader hovers', async () => {
    const asked: string[] = [];
    mswServer.use(
      http.get(`/api/v1/projects/${PROJECT_ID}/site-health`, () =>
        HttpResponse.json({ error: { message: 'down' } }, { status: 500 }),
      ),
      http.get(`/api/v1/projects/${PROJECT_ID}/site-health/issues`, () => {
        asked.push('latest issues');
        return HttpResponse.json({ error: { message: 'not here' } }, { status: 404 });
      }),
    );

    prefetchRoute(client, '/issues', PROJECT);
    prefetchRoute(client, '/issues', PROJECT);
    await vi.waitFor(() => expect(asked).toEqual(['latest issues']));
    prefetchRoute(client, '/issues', PROJECT);
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });

    expect(asked).toEqual(['latest issues']);
  });

  const visibilitySelectionKeys = [
    runsQueries.list(PROJECT).queryKey,
    projectQueries.markets(PROJECT).queryKey,
    visibilityQueries.project(PROJECT, INITIAL_VISIBILITY_PARAMS).queryKey,
  ];
  it.each([
    ['/insights', visibilitySelectionKeys],
    ['/competitors', visibilitySelectionKeys],
    ['/agent', [actionsQueries.list(PROJECT).queryKey]],
    ['/actions', [actionsQueries.tree(PROJECT, DEFAULT_ACTION_TREE).queryKey]],
    ['/agent/skills', [agentQueries.skills(PROJECT.workspaceId).queryKey]],
    [
      '/agent/context',
      [projectQueries.brandFacts(PROJECT).queryKey, projectQueries.brandProfile(PROJECT).queryKey],
    ],
    [
      '/products',
      [
        commerceQueries.catalog(PROJECT).queryKey,
        commerceQueries.products(PROJECT, productSearch(DEFAULT_PRODUCT_FILTERS), null).queryKey,
      ],
    ],
    [
      '/products/overview',
      [
        commerceQueries.catalog(PROJECT).queryKey,
        commerceQueries.overview(PROJECT, 'window=30').queryKey,
      ],
    ],
  ])('warms %s under the exact keys its screen reads', async (href, keys) => {
    const asked: string[] = [];
    mswServer.use(
      http.get('/api/v1/*', ({ request }) => {
        asked.push(new URL(request.url).pathname);
        return HttpResponse.json({ error: { message: 'not here' } }, { status: 404 });
      }),
    );

    prefetchRoute(client, href, PROJECT);

    await vi.waitFor(() => expect(asked).toHaveLength(keys.length));
    const warmed = client
      .getQueryCache()
      .getAll()
      .map((query) => JSON.stringify(query.queryKey))
      .sort();
    expect(warmed).toEqual(keys.map((key) => JSON.stringify(key)).sort());
  });

  it('files a cold issue catalog under the crawl the project read names, then asks that crawl for its summary, before the dashboard lands', async () => {
    const summary = {
      issue_count: 0,
      defect_issue_type_count: 0,
      advisory_issue_type_count: 0,
      occurrence_count: 0,
      severity_counts: {},
      dimension_counts: {},
      affected_url_count: 0,
      monitored_affected_url_count: 0,
      section_counts: { technical: 0, content: 0, aeo: 0 },
    };
    const page = { items: [], next_cursor: null, summary };
    const worst = { items: [], next_cursor: null, summary: { ...summary, issue_count: 3 } };
    const asked: string[] = [];
    const dashboard = heldAnswer();
    mswServer.use(
      http.get(`/api/v1/projects/${PROJECT_ID}/site-health`, async () => {
        await dashboard.held;
        return HttpResponse.json(DASHBOARD);
      }),
      http.get(`/api/v1/projects/${PROJECT_ID}/site-health/issues`, () =>
        HttpResponse.json({ ...page, crawl_id: CRAWL_ID }),
      ),
      http.get(`/api/v1/site-crawls/${CRAWL_ID}/issues`, ({ request }) => {
        asked.push(new URL(request.url).search);
        return HttpResponse.json(worst);
      }),
    );
    prefetchRoute(client, '/issues', PROJECT);

    await vi.waitFor(() => {
      const filed = client
        .getQueryCache()
        .findAll({ queryKey: queryKeys.siteHealth.crawlIssues(CRAWL_ID) })
        .map((query) => query.state.data);
      expect(filed).toHaveLength(2);
      expect(filed).toEqual(expect.arrayContaining([page, worst]));
    });
    expect(asked).toEqual(['?limit=3']);
    dashboard.release();
  });

  it('warms the Overview layout beside the command center, then the reads its widgets make', async () => {
    const asked: string[] = [];
    const widgets = [
      'project_state',
      'missing_prompts',
      'visibility_trend',
      'ai_traffic',
      'search_console',
    ] as const;
    mswServer.use(
      ...pendingOverviewHandlers(PROJECT_ID, widgets, asked),
      recordedProjectRead(PROJECT_ID, 'visibility/prompts', 'prompts', asked, []),
      recordedProjectRead(PROJECT_ID, 'visibility/trends', 'trends', asked, []),
      recordedProjectRead(PROJECT_ID, 'ai-traffic/overview', 'traffic', asked, {}),
      recordedProjectRead(PROJECT_ID, 'performance', 'performance', asked, {}),
    );

    prefetchRoute(client, '/projects', PROJECT);

    await vi.waitFor(() =>
      expect([...asked].sort()).toEqual([
        'command-center',
        'layout',
        'performance?range=last_synced&granularity=day&compare=none',
        'prompts',
        'traffic?range=30d',
        'trends?cohort=core',
      ]),
    );
  });

  it('does not ask for a widget read that needs a measured run when there is none', async () => {
    const asked: string[] = [];
    mswServer.use(
      ...pendingOverviewHandlers(PROJECT_ID, ['perception'], asked),
      http.get(`/api/v1/projects/${PROJECT_ID}/visibility`, () => {
        asked.push('visibility');
        return HttpResponse.json(
          {
            error: { code: 'visibility_not_measured', message: 'No completed audit for project' },
          },
          { status: 404 },
        );
      }),
      recordedProjectRead(PROJECT_ID, 'visibility/perception', 'perception', asked, {}),
    );

    prefetchRoute(client, '/projects', PROJECT);

    const latest = visibilityQueries.project(PROJECT, INITIAL_VISIBILITY_PARAMS).queryKey;
    await vi.waitFor(() => expect(client.getQueryData(latest)).toBeNull());
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    expect([...asked].sort()).toEqual(['command-center', 'layout', 'visibility']);
  });

  it('leaves an already-failed query untouched so a settled error cannot flicker', async () => {
    vi.mocked(demandApi.getLatest).mockRejectedValueOnce(new Error('404'));
    const latest = demandQueries.latest(PROJECT);
    await client.fetchQuery(latest).catch(() => undefined);

    const query = client.getQueryCache().find({ queryKey: latest.queryKey });
    expect(query?.state.status).toBe('error');
    const callsAfterFailure = vi.mocked(demandApi.getLatest).mock.calls.length;

    prefetchRoute(client, '/search-intelligence', PROJECT);
    await Promise.resolve();

    expect(vi.mocked(demandApi.getLatest).mock.calls).toHaveLength(callsAfterFailure);
    expect(query?.state.status).toBe('error');
  });

  describe('every sidebar destination', () => {
    function recordRequests() {
      const paths: string[] = [];
      const listener = ({ request }: { request: Request }) => {
        paths.push(new URL(request.url).pathname);
      };
      mswServer.use(
        http.all('*', () => HttpResponse.json({ error: { message: 'not here' } }, { status: 404 })),
      );
      mswServer.events.on('request:start', listener);
      return { paths, stop: () => mswServer.events.removeListener('request:start', listener) };
    }

    it('warms Settings’ always-mounted panels and the tab the address opens', async () => {
      const requests = recordRequests();
      await prefetchRoute(client, '/settings?tab=integrations', PROJECT);
      await vi.waitFor(() =>
        expect([...new Set(requests.paths)].sort()).toEqual([
          '/api/v1/auth/security',
          '/api/v1/integrations',
          '/api/v1/provider-catalog',
          '/api/v1/provider-connections',
          '/api/v1/provider-connections/states',
        ]),
      );
      requests.stop();
    });

    it.each(
      [
        ...DASHBOARD_GROUPS.flatMap((group) => group.items),
        NEW_CHAT_ITEM,
        ...AGENT_NAV_ITEMS,
        ...FOOT_NAV_ITEMS,
      ].map((item) => item.href),
    )('warms a read for %s', async (href) => {
      const requests = recordRequests();
      expect(client.getQueryCache().getAll()).toHaveLength(0);
      await prefetchRoute(client, href, PROJECT);
      expect(client.getQueryCache().getAll().length).toBeGreaterThan(0);
      requests.stop();
    });
  });
});
