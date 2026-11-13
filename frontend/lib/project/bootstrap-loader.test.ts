import { delay, http, HttpResponse, type DefaultBodyType } from 'msw';
import { waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vite-plus/test';

import { createAppQueryClient, setAppQueryClient } from '@/lib/api/query-client';
import { queryKeys } from '@/lib/api/query-keys';
import { mswServer } from '@/test/msw-server';
import {
  ACTIVE_PROJECT_STORAGE_KEY,
  ACTIVE_WORKSPACE_STORAGE_KEY,
} from '@/lib/project/active-project-storage';

import { bootstrapPrivateRoutes } from './bootstrap-loader';

const WORKSPACE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PROJECT = '11111111-1111-4111-8111-111111111111';

const USER = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'owner@example.test',
  role: 'user',
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const WORKSPACE_ROW = {
  id: WORKSPACE,
  name: 'Test Workspace',
  role: 'owner',
  capabilities: ['manage_credentials', 'read', 'run', 'write'],
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const PROJECT_ROW = {
  id: PROJECT,
  workspace_id: WORKSPACE,
  name: 'Acme',
  brand_name: 'Acme',
  website_url: 'https://acme.example',
  industry: 'software',
  subindustry: 'analytics',
  primary_market: 'US',
  country_code: 'US',
  language_code: 'en',
  benchmark_mode: 'consumer_like',
  default_repetitions: 1,
  brand: { aliases: [], logo_url: null },
  owned_domains: ['acme.example'],
  unintended_domains: [],
  competitors: [],
  prompt_sets: [],
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

/** What the workspace's list carries for the project. */
const PROJECT_SUMMARY = {
  id: PROJECT,
  name: 'Acme',
  brand_name: 'Acme',
  website_url: 'https://acme.example',
  brand: { logo_url: null },
};

function stub({ projects }: { projects: unknown[] }) {
  mswServer.use(
    http.get('/api/v1/auth/me', () => HttpResponse.json({ user: USER })),
    http.get('/api/v1/workspaces', () => HttpResponse.json([WORKSPACE_ROW])),
    http.get('/api/v1/projects', () => HttpResponse.json(projects)),
  );
}

/** A response the test releases when it chooses. */
function deferred() {
  let answer!: (response: HttpResponse<DefaultBodyType>) => void;
  const response = new Promise<HttpResponse<DefaultBodyType>>((resolve) => {
    answer = resolve;
  });
  return { response, answer };
}

/** What the loader did: a redirect's destination, or null for "let it render". */
async function run(pathname: string): Promise<string | null> {
  const request = new Request(`https://citeladder.local${pathname}`);
  try {
    await bootstrapPrivateRoutes({ request });
    return null;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown.headers.get('Location');
    throw thrown;
  }
}

beforeAll(() => mswServer.listen({ onUnhandledFrame: 'bypass' }));
afterAll(() => mswServer.close());
beforeEach(() => {
  setAppQueryClient(createAppQueryClient());
  window.localStorage.clear();
});
afterEach(() => {
  mswServer.resetHandlers();
  setAppQueryClient(undefined);
});

/**
 * The shell's opening decision, made before anything mounts.
 *
 * What these guard is the DIRECTION of each answer, and — just as much — the
 * states that must NOT produce one. A read that failed or a project that is
 * merely missing: each has a notice and a retry
 * of its own in `OnboardingGate`, and a loader that redirected or threw on any
 * of them would replace that with a bare route error.
 */
describe('bootstrapPrivateRoutes', () => {
  it('sends an empty workspace to project setup, carrying the workspace', async () => {
    stub({ projects: [] });
    expect(await run('/projects')).toBe(`/onboarding?workspace=${WORKSPACE}`);
  });

  it('starts the user and membership reads together rather than in series', async () => {
    // A degraded network multiplies every serialized round trip, and the
    // reads are independent, so the membership list must not
    // queue behind `me`. Prove both are in flight before either has answered.
    const entered: string[] = [];
    let answerMe!: (response: HttpResponse<DefaultBodyType>) => void;
    let answerWorkspaces!: (response: HttpResponse<DefaultBodyType>) => void;
    const me = new Promise<HttpResponse<DefaultBodyType>>((resolve) => {
      answerMe = resolve;
    });
    const memberships = new Promise<HttpResponse<DefaultBodyType>>((resolve) => {
      answerWorkspaces = resolve;
    });
    mswServer.use(
      http.get('/api/v1/auth/me', () => {
        entered.push('me');
        return me;
      }),
      http.get('/api/v1/workspaces', () => {
        entered.push('workspaces');
        return memberships;
      }),
      http.get('/api/v1/projects', () => HttpResponse.json([])),
    );

    const pending = run('/projects');
    await waitFor(() => expect(entered).toContain('workspaces'));
    // `me` is still unanswered (its deferred is pending by construction), so
    // the membership read can only have started alongside it.
    expect(entered).toContain('me');

    answerMe(HttpResponse.json({ user: USER }));
    answerWorkspaces(HttpResponse.json([WORKSPACE_ROW]));
    expect(await pending).toBe(`/onboarding?workspace=${WORKSPACE}`);
  });

  it('puts the resolved project in the address instead of rewriting it a frame later', async () => {
    stub({ projects: [PROJECT_SUMMARY] });
    expect(await run('/projects')).toBe(`/projects?project=${PROJECT}`);
  });

  it('leaves an address that already names its project alone', async () => {
    stub({ projects: [PROJECT_SUMMARY] });
    mswServer.use(http.get(`/api/v1/projects/${PROJECT}`, () => HttpResponse.json(PROJECT_ROW)));
    expect(await run(`/projects?project=${PROJECT}`)).toBeNull();
  });

  it('renders rather than redirects when the local user read fails', async () => {
    stub({ projects: [] });
    mswServer.use(
      http.get('/api/v1/auth/me', () =>
        HttpResponse.json({ error: { message: 'no' } }, { status: 500 }),
      ),
    );
    expect(await run('/projects')).toBeNull();
  });

  it('does not route a workspace-only destination on the projects it lacks', async () => {
    // Settings and onboarding manage the WORKSPACE. An empty one is a normal
    // place to be on those routes, not a reason to redirect.
    stub({ projects: [] });
    expect(await run('/settings')).toBeNull();
    expect(await run('/onboarding')).toBeNull();
  });

  it('renders rather than redirects when a read fails', async () => {
    // The gate owns "your workspace could not be loaded" and its retry. A
    // loader that threw here would show a route error instead and lose which
    // read actually failed.
    mswServer.use(
      http.get('/api/v1/auth/me', () => HttpResponse.json({ user: USER })),
      http.get('/api/v1/workspaces', () =>
        HttpResponse.json({ error: { message: 'nope' } }, { status: 500 }),
      ),
    );
    expect(await run('/projects')).toBeNull();
  });

  it('does not offer creation to a role that cannot write', async () => {
    mswServer.use(
      http.get('/api/v1/auth/me', () => HttpResponse.json({ user: USER })),
      http.get('/api/v1/workspaces', () =>
        HttpResponse.json([{ ...WORKSPACE_ROW, role: 'viewer', capabilities: ['read'] }]),
      ),
      http.get('/api/v1/projects', () => HttpResponse.json([])),
    );
    expect(await run('/projects')).toBeNull();
  });

  describe('a reload of a project address', () => {
    /** Every request path (with its query) the loader sends while `work` runs. */
    function recordRequests() {
      const paths: string[] = [];
      const listener = ({ request }: { request: Request }) => {
        const url = new URL(request.url);
        paths.push(url.pathname + url.search);
      };
      mswServer.events.on('request:start', listener);
      return { paths, stop: () => mswServer.events.removeListener('request:start', listener) };
    }
    const projectReads = (paths: string[]) =>
      paths.filter((path) => path === '/api/v1/projects' || path === `/api/v1/projects/${PROJECT}`);

    it.each([
      ['lists it', [PROJECT_SUMMARY]],
      ['does not list it yet', []],
    ])(
      'reads the project’s view once beside the list when the remembered workspace %s',
      async (_case, listed) => {
        window.localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, WORKSPACE);
        stub({ projects: listed });
        mswServer.use(
          http.get(`/api/v1/projects/${PROJECT}`, () => HttpResponse.json(PROJECT_ROW)),
        );
        const requests = recordRequests();

        expect(await run(`/settings?project=${PROJECT}`)).toBeNull();
        requests.stop();

        expect(projectReads(requests.paths).sort()).toEqual([
          '/api/v1/projects',
          `/api/v1/projects/${PROJECT}`,
        ]);
      },
    );

    it('starts the landing screen’s reads while the profile read is still answering', async () => {
      window.localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, WORKSPACE);
      stub({ projects: [PROJECT_SUMMARY] });
      let answer!: (response: HttpResponse<DefaultBodyType>) => void;
      const access = new Promise<HttpResponse<DefaultBodyType>>((resolve) => {
        answer = resolve;
      });
      mswServer.use(
        http.get('/api/v1/auth/me', () => access),
        http.get(`/api/v1/projects/${PROJECT}`, () => HttpResponse.json(PROJECT_ROW)),
        // What the screen reads answer is not this test's concern.
        http.get(`/api/v1/projects/${PROJECT}/*`, () =>
          HttpResponse.json({ error: { message: 'not here' } }, { status: 404 }),
        ),
      );
      const requests = recordRequests();
      let settled = false;

      const pending = run(`/ai-traffic?project=${PROJECT}`).then((location) => {
        settled = true;
        return location;
      });
      // The shell's Actions badge read rides along on every screen; this test
      // is about the screen's own reads.
      const screenReads = () =>
        requests.paths
          .filter((path) => path.startsWith(`/api/v1/projects/${PROJECT}/`))
          .filter((path) => !path.startsWith(`/api/v1/projects/${PROJECT}/actions`))
          .sort();
      await waitFor(() =>
        expect(screenReads()).toEqual([
          `/api/v1/projects/${PROJECT}/ai-traffic/insights?range=30d`,
          `/api/v1/projects/${PROJECT}/ai-traffic/overview?range=30d`,
          `/api/v1/projects/${PROJECT}/crawl-logs/sources`,
        ]),
      );
      expect(settled).toBe(false);

      answer(HttpResponse.json({ user: USER }));
      expect(await pending).toBeNull();
      requests.stop();
    });

    it('asks for the project list, the shell’s reads and the screen’s in the same round as the session', async () => {
      window.localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, WORKSPACE);
      stub({ projects: [PROJECT_SUMMARY] });
      const me = deferred();
      const memberships = deferred();
      mswServer.use(
        http.get(`/api/v1/projects/${PROJECT}`, () => HttpResponse.json(PROJECT_ROW)),
        http.get('/api/v1/auth/me', () => me.response),
        http.get('/api/v1/workspaces', () => memberships.response),
        http.get(`/api/v1/projects/${PROJECT}/*`, () =>
          HttpResponse.json({ error: { message: 'not here' } }, { status: 404 }),
        ),
      );
      const requests = recordRequests();
      const started = () => requests.paths.map((path) => path.replace(/\?.*$/u, ''));

      const pending = run(`/site?project=${PROJECT}`);
      const firstRound = [
        '/api/v1/projects',
        `/api/v1/projects/${PROJECT}`,
        `/api/v1/projects/${PROJECT}/actions`,
        `/api/v1/projects/${PROJECT}/monitored-urls`,
        `/api/v1/projects/${PROJECT}/site-health`,
      ];
      // `me` and the membership list are unanswered by construction.
      await waitFor(() =>
        expect(firstRound.filter((path) => started().includes(path))).toEqual(firstRound),
      );

      me.answer(HttpResponse.json({ user: USER }));
      memberships.answer(HttpResponse.json([WORKSPACE_ROW]));
      expect(await pending).toBeNull();
      requests.stop();
    });

    it('withdraws a remembered workspace’s guess and reads the project in its own', async () => {
      const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
      window.localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, OTHER);
      const empty = {
        project_id: PROJECT,
        crawl: null,
        score_summary: null,
        phase: 'empty',
        snapshot_id: null,
        quota: { used: 0, limit: 50 },
        root_errors: [],
      };
      stub({ projects: [] });
      mswServer.use(
        http.get('/api/v1/workspaces', () =>
          HttpResponse.json([WORKSPACE_ROW, { ...WORKSPACE_ROW, id: OTHER, name: 'Other' }]),
        ),
        http.get('/api/v1/projects', ({ request }) =>
          HttpResponse.json(
            request.headers.get('x-workspace-id') === WORKSPACE ? [PROJECT_SUMMARY] : [],
          ),
        ),
        http.get(`/api/v1/projects/${PROJECT}`, () => HttpResponse.json(PROJECT_ROW)),
        // Asked under the wrong workspace, the dashboard is still answering
        // `Project not found` when the project names its own.
        http.get(`/api/v1/projects/${PROJECT}/site-health`, async ({ request }) => {
          if (request.headers.get('x-workspace-id') === WORKSPACE) return HttpResponse.json(empty);
          await delay(200);
          return HttpResponse.json({ error: { message: 'Project not found' } }, { status: 404 });
        }),
        http.get(`/api/v1/projects/${PROJECT}/*`, () =>
          HttpResponse.json({ error: { message: 'not here' } }, { status: 404 }),
        ),
      );
      const client = createAppQueryClient();
      setAppQueryClient(client);

      expect(await run(`/site?project=${PROJECT}`)).toBeNull();

      await waitFor(() =>
        expect(
          client.getQueryData(
            queryKeys.siteHealth.dashboard({ workspaceId: WORKSPACE, projectId: PROJECT }),
          ),
        ).toEqual(empty),
      );
    });
  });

  it('keeps a stored workspace that the membership list still contains', async () => {
    window.localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, WORKSPACE);
    window.localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, PROJECT);
    stub({ projects: [PROJECT_SUMMARY] });
    mswServer.use(http.get(`/api/v1/projects/${PROJECT}`, () => HttpResponse.json(PROJECT_ROW)));
    expect(await run('/projects')).toBe(`/projects?project=${PROJECT}`);
  });
});
