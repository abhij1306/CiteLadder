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

import { actionsQueries } from '@/lib/api/actions';
import { agentQueries } from '@/lib/api/agent';
import { commerceQueries } from '@/lib/api/commerce';
import { demandApi, demandQueries } from '@/lib/api/demand';
import { projectQueries } from '@/lib/api/projects';
import { queryKeys } from '@/lib/api/query-keys';
import { searchIntelligenceQueries } from '@/lib/api/search-intelligence';
import { siteHealthQueries } from '@/lib/api/site-health-queries';
import { INITIAL_VISIBILITY_PARAMS } from '@/lib/api/visibility';
import { visibilityQueries } from '@/lib/api/visibility-queries';
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
/** A response held back so the read it races clearly answers first. */
/** A response held until the test lets it go, so "answers last" is a fact, not a timing race. */
function heldAnswer() {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { held, release: () => release() };
}
// The Website page browser's first Monitored page, as the screen asks for it.
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
    prefetchRoute(client, '/demand', null);
    expect(demandApi.getLatest).not.toHaveBeenCalled();
  });

  it('warms the Search Demand snapshot on intent', async () => {
    prefetchRoute(client, '/demand', PROJECT);
    await vi.waitFor(() => expect(demandApi.getLatest).toHaveBeenCalledTimes(1));
  });

  /**
   * Search Demand renders a settled "no snapshot exists yet" alert from a 404.
   * Re-driving that key would reset `error` → `pending`, so the alert would be
   * replaced by the full-page skeleton for the length of the repeat request.
   */
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

    // The page browser's first page names its default sort, so the warmed
    // preview must too or it fills an entry the browser never reads.
    await vi.waitFor(() => expect(asked).toEqual(['pages ?limit=10&monitored=true&sort=status']));
  });

  it('asks for a cold Website preview beside the dashboard and files it under the crawl it names', async () => {
    const asked: string[] = [];
    const page = { items: [], next_cursor: null, root_errors: [] };
    const dashboard = heldAnswer();
    mswServer.use(
      http.get(`/api/v1/projects/${PROJECT_ID}/site-health`, async () => {
        asked.push('dashboard');
        // Held until the preview is filed: the preview must not wait for it.
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
        // The dashboard fails, so every hover takes the cold path again.
        return HttpResponse.json({ error: { message: 'down' } }, { status: 500 });
      }),
      http.get(`/api/v1/projects/${PROJECT_ID}/site-health/pages`, async () => {
        asked.push('latest pages');
        await latest.held;
        return HttpResponse.json({ ...page, crawl_id: CRAWL_ID, crawl_status: 'completed' });
      }),
    );

    // Hover, focus, hover again while the first answer is still on its way.
    prefetchRoute(client, '/site', PROJECT);
    prefetchRoute(client, '/site', PROJECT);
    await vi.waitFor(() => expect(asked).toContain('latest pages'));
    prefetchRoute(client, '/site', PROJECT);
    latest.release();
    await vi.waitFor(() => expect(client.getQueryData(previewKey)).toEqual(page));
    // And once more after it was filed: the fresh answer is reused.
    prefetchRoute(client, '/site', PROJECT);
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });

    expect(asked.filter((request) => request === 'latest pages')).toEqual(['latest pages']);
  });

  it('asks for a cold issue catalog once however often the reader hovers', async () => {
    const asked: string[] = [];
    mswServer.use(
      // The dashboard fails, so every hover takes the cold path again.
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
    // A read that failed is not asked again from intent; the screen retries it.
    prefetchRoute(client, '/issues', PROJECT);
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });

    expect(asked).toEqual(['latest issues']);
  });

  it.each([
    ['/search-intelligence', [searchIntelligenceQueries.readiness(PROJECT).queryKey]],
    ['/agent', [actionsQueries.list(PROJECT).queryKey]],
    ['/agent/skills', [agentQueries.skills(PROJECT.workspaceId).queryKey]],
    [
      '/agent/context',
      [projectQueries.brandFacts(PROJECT).queryKey, projectQueries.brandProfile(PROJECT).queryKey],
    ],
    [
      '/products',
      [
        commerceQueries.buyerPrompts(PROJECT).queryKey,
        commerceQueries.catalog(PROJECT).queryKey,
        commerceQueries.competitors(PROJECT).queryKey,
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

  it('files a cold issue catalog under the crawl the project read names, before the dashboard lands', async () => {
    const page = {
      items: [],
      next_cursor: null,
      summary: {
        issue_count: 0,
        defect_issue_type_count: 0,
        advisory_issue_type_count: 0,
        occurrence_count: 0,
        severity_counts: {},
        dimension_counts: {},
        affected_url_count: 0,
        monitored_affected_url_count: 0,
      },
    };
    // Held until the catalog is filed: the catalog must not wait for it.
    const dashboard = heldAnswer();
    mswServer.use(
      http.get(`/api/v1/projects/${PROJECT_ID}/site-health`, async () => {
        await dashboard.held;
        return HttpResponse.json(DASHBOARD);
      }),
      http.get(`/api/v1/projects/${PROJECT_ID}/site-health/issues`, () =>
        HttpResponse.json({ ...page, crawl_id: CRAWL_ID }),
      ),
    );
    prefetchRoute(client, '/issues', PROJECT);

    await vi.waitFor(() =>
      expect(
        client
          .getQueryCache()
          .findAll({ queryKey: queryKeys.siteHealth.crawlIssues(CRAWL_ID) })
          .map((query) => query.state.data),
      ).toEqual([page]),
    );
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
      // The command center never answers: everything else is asked beside it.
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

    prefetchRoute(client, '/demand', PROJECT);
    await Promise.resolve();

    expect(vi.mocked(demandApi.getLatest).mock.calls).toHaveLength(callsAfterFailure);
    expect(query?.state.status).toBe('error');
  });
});
