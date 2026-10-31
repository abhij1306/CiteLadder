import { http, HttpResponse, type DefaultBodyType } from 'msw';
import { waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vite-plus/test';

import { createAppQueryClient, setAppQueryClient } from '@/lib/api/query-client';
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

function stub({ projects }: { projects: unknown[] }) {
  mswServer.use(
    http.get('/api/v1/auth/me', () => HttpResponse.json({ user: USER })),
    http.get('/api/v1/workspaces', () => HttpResponse.json([WORKSPACE_ROW])),
    http.get('/api/v1/projects', () => HttpResponse.json(projects)),
  );
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
    stub({ projects: [PROJECT_ROW] });
    expect(await run('/projects')).toBe(`/projects?project=${PROJECT}`);
  });

  it('leaves an address that already names its project alone', async () => {
    stub({ projects: [PROJECT_ROW] });
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

  it('keeps a stored workspace that the membership list still contains', async () => {
    window.localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, WORKSPACE);
    window.localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, PROJECT);
    stub({ projects: [PROJECT_ROW] });
    expect(await run('/projects')).toBe(`/projects?project=${PROJECT}`);
  });
});
