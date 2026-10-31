import { http, HttpResponse } from 'msw';
import { act, screen, waitFor } from '@testing-library/react';
import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vite-plus/test';

import type { BrandDiscovery } from '@/lib/api/brand-discoveries';
import { mswServer } from '@/test/msw-server';
import { makeProject } from '@/test/fixtures/project';
import { renderWithProviders } from '@/test/render';

import { OnboardingScreen } from './onboarding-screen';
import { useOnboardingFlow } from './onboarding-flow';

const { setActiveProjectId, selection } = vi.hoisted(() => ({
  setActiveProjectId: vi.fn(),
  // Mutable so a test can describe a workspace that has no project yet, which
  // is the state that decides whether leaving setup leads anywhere.
  selection: { activeProjectId: '55555555-5555-4555-8555-555555555555' as string | null },
}));

const DISCOVERY_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const ACTIVE_PROJECT_ID = '55555555-5555-4555-8555-555555555555';

let discoveryState: BrandDiscovery;
let useRealDiscovery = false;
// The URL the screen loads with. A reload mid-generation resumes straight to
// the review step, which is the only way to reach that screen without a
// `ready` discovery to click through.
let searchParams = '';
const visitedLocations: string[] = [];

const WORKSPACE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

/** What `GET /projects/{id}` returns for the project the completion creates. */
const createdProject = makeProject({
  id: PROJECT_ID,
  workspace_id: WORKSPACE_ID,
  website_url: 'https://example.com',
});

vi.mock('@/lib/project/project-context', () => ({
  useActiveWorkspaceId: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  useProjectContext: () => ({
    activeWorkspaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    activeProjectId: selection.activeProjectId,
    setActiveProjectId,
  }),
}));

vi.mock('@/lib/onboarding/use-brand-discovery', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/onboarding/use-brand-discovery')>();
  return {
    // Mirrors the real hook: a persisted `resumeId` alone is enough to resolve
    // the discovery. On reload the brand draft is hydrated FROM that row, so
    // gating on `input` only would leave the screen with no discovery at all.
    useBrandDiscovery: (...args: Parameters<typeof actual.useBrandDiscovery>) => {
      if (useRealDiscovery) return actual.useBrandDiscovery(...args);
      const [input, resumeId = null] = args;
      const resolved = input || resumeId ? discoveryState : null;
      return {
        discovery: resolved,
        isRunning: Boolean(resolved) && ['queued', 'running'].includes(discoveryState.status),
        error: null,
        retry: vi.fn(),
      };
    },
  };
});

function discovery(status: BrandDiscovery['status'], phase: BrandDiscovery['progress']['phase']) {
  return {
    id: DISCOVERY_ID,
    workspace_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    project_id: null,
    status,
    progress: {
      phase,
      completed_steps: status === 'ready' ? 4 : 2,
      total_steps: 4,
      pages_read: 3,
      competitors_found: 1,
    },
    input_data: {
      brand_name: 'Acme',
      website_url: 'https://acme.example',
      industry: 'Software',
      subindustry: 'Analytics',
      primary_market: 'US',
      language_code: 'en',
    },
    profile: {
      description: 'A commerce platform',
      positioning: 'Reliable product data',
      products_services: ['Product feeds'],
      target_audience: 'Retailers',
      industry: 'Commerce software',
      business_type: 'b2b',
      price_tier: 'premium',
      field_confidence: {},
      category: 'product feed management platform',
      category_options: [],
      category_aliases: ['feed management software'],
      category_terms: ['product feed management', 'marketplace integrations'],
      jobs_to_be_done: ['list products on marketplaces'],
      sector: 'Software',
      business_model: 'b2b_saas',
      secondary_business_models: [],
      market_scope: 'global',
      buyer_register: 'research_comparative',
      buyer_roles: ['ecommerce manager'],
      service_areas: [],
      knowledge_strength: 'strong',
    },
    domains: ['acme.example'],
    competitors: [
      {
        name: 'Globex',
        aliases: [],
        domains: ['globex.example'],
      },
    ],
    evidence: [],
    warnings: [],
    error_code: '',
    created_at: '2026-08-04T00:00:00Z',
    updated_at: '2026-08-04T00:00:00Z',
  } satisfies BrandDiscovery;
}

function catalogHandler() {
  return http.get('/api/v1/brand-discovery-catalog', () =>
    HttpResponse.json({
      maximum_competitors: 5,
      industries: ['General', 'Software'],
      subindustries: { General: [], Software: ['Analytics'] },
    }),
  );
}

function onboardingUrl() {
  return `/onboarding${searchParams ? `?${searchParams}` : ''}`;
}

function RouterProbe({ destination }: Readonly<{ destination: string }>) {
  const navigate = useNavigate();
  const location = useLocation();
  const lastDestination = useRef<string>(destination);
  useEffect(() => {
    visitedLocations.push(location.pathname + location.search);
  }, [location]);
  useEffect(() => {
    if (lastDestination.current === destination) return;
    lastDestination.current = destination;
    navigate(destination);
  }, [destination, navigate]);
  return <output data-testid="location">{location.pathname + location.search}</output>;
}

function renderOnboarding(destination = onboardingUrl()) {
  return renderWithProviders(
    <>
      <RouterProbe destination={destination} />
      <OnboardingScreen />
    </>,
    { initialEntries: [destination] },
  );
}

async function enterBrand() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/^Brand name/), 'Acme');
  await user.type(screen.getByLabelText(/^Website/), 'acme.example');
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  await waitFor(() =>
    expect(screen.getByTestId('location')).toHaveTextContent(
      `/onboarding?discovery=${DISCOVERY_ID}&step=discovery`,
    ),
  );
  return user;
}

beforeAll(() => mswServer.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  mswServer.resetHandlers();
  vi.clearAllMocks();
  searchParams = '';
  useRealDiscovery = false;
  selection.activeProjectId = ACTIVE_PROJECT_ID;
  visitedLocations.length = 0;
  window.sessionStorage.clear();
});
afterAll(() => mswServer.close());

describe('OnboardingScreen', () => {
  it('retries a failed progress read without starting another discovery', async () => {
    useRealDiscovery = true;
    searchParams = `discovery=${DISCOVERY_ID}&step=discovery`;
    let failRead = false;
    let creations = 0;
    mswServer.use(
      catalogHandler(),
      http.post(`/api/v1/brand-discoveries/${DISCOVERY_ID}/run`, () =>
        HttpResponse.json(discovery('queued', 'opening_website')),
      ),
      http.get(`/api/v1/brand-discoveries/${DISCOVERY_ID}`, () => {
        if (failRead)
          return HttpResponse.json({ error: { message: 'Unavailable' } }, { status: 400 });
        failRead = true;
        return HttpResponse.json(discovery('queued', 'opening_website'));
      }),
      http.post('/api/v1/brand-discoveries', () => {
        creations += 1;
        return HttpResponse.json(discovery('queued', 'opening_website'));
      }),
    );
    renderOnboarding();
    expect(await screen.findByText('Waiting to start website research')).toBeInTheDocument();
    const retry = await screen.findByRole('button', { name: 'Retry' }, { timeout: 3000 });
    expect(retry).toBeEnabled();
    mswServer.use(
      http.get(`/api/v1/brand-discoveries/${DISCOVERY_ID}`, () =>
        HttpResponse.json(discovery('ready', 'preparing_review')),
      ),
    );
    await userEvent.setup().click(retry);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Review' })).toBeEnabled());
    expect(creations).toBe(0);
  });

  it('starts research once while polling persisted progress during the bounded request', async () => {
    useRealDiscovery = true;
    searchParams = `discovery=${DISCOVERY_ID}&step=discovery`;
    discoveryState = discovery('queued', 'opening_website');
    let starts = 0;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    mswServer.use(
      catalogHandler(),
      http.get(`/api/v1/brand-discoveries/${DISCOVERY_ID}`, () =>
        HttpResponse.json(discoveryState),
      ),
      http.post(`/api/v1/brand-discoveries/${DISCOVERY_ID}/run`, async ({ request }) => {
        expect(request.headers.get('x-workspace-id')).toBe(WORKSPACE_ID);
        starts += 1;
        discoveryState = discovery('running', 'finding_competitors');
        await pending;
        discoveryState = discovery('ready', 'preparing_review');
        return HttpResponse.json(discoveryState);
      }),
    );
    renderOnboarding();
    try {
      await waitFor(() => expect(screen.getByText('Opened your website')).toBeInTheDocument(), {
        timeout: 3000,
      });
      expect(screen.getByRole('button', { name: 'Searching…' })).toBeDisabled();
    } finally {
      release();
    }
    await waitFor(() => expect(screen.getByRole('button', { name: 'Review' })).toBeEnabled());
    expect(starts).toBe(1);
  });

  it('opens a committed project without waiting for a second project-detail read', async () => {
    discoveryState = discovery('ready', 'preparing_review');
    searchParams = `discovery=${DISCOVERY_ID}&step=review`;
    let detailReads = 0;
    mswServer.use(
      catalogHandler(),
      http.post(`/api/v1/brand-discoveries/${DISCOVERY_ID}/complete`, () =>
        HttpResponse.json({
          discovery_id: DISCOVERY_ID,
          project_id: PROJECT_ID,
          warnings: [],
        }),
      ),
      http.get(`/api/v1/projects/${PROJECT_ID}`, () => {
        detailReads += 1;
        return HttpResponse.error();
      }),
    );
    renderOnboarding();
    const button = await screen.findByRole('button', { name: 'Create project' });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.setup().click(button);
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(`/projects?project=${PROJECT_ID}`),
    );
    expect(detailReads).toBe(0);
  });

  it('keeps draft URL updates paused while completion is in flight', async () => {
    discoveryState = discovery('ready', 'preparing_review');
    const destination = `/onboarding?discovery=${DISCOVERY_ID}&step=review`;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    mswServer.use(
      catalogHandler(),
      http.post(`/api/v1/brand-discoveries/${DISCOVERY_ID}/complete`, async () => {
        await pending;
        return HttpResponse.json({ discovery_id: DISCOVERY_ID, project_id: null, warnings: [] });
      }),
    );
    let flow!: ReturnType<typeof useOnboardingFlow>;
    function FlowProbe() {
      const current = useOnboardingFlow('completion-test');
      useEffect(() => {
        flow = current;
      });
      return null;
    }
    renderWithProviders(
      <>
        <RouterProbe destination={destination} />
        <FlowProbe />
      </>,
      {
        initialEntries: [destination],
      },
    );
    await waitFor(() => expect(flow.profile).not.toBeNull());
    act(() => flow.complete.mutate());
    await waitFor(() => expect(flow.complete.isPending).toBe(true));
    act(() => flow.setStep(1));
    expect(screen.getByTestId('location')).toHaveTextContent(destination);
    act(() => release());
    await waitFor(() => expect(flow.complete.isPending).toBe(false));
  });

  it('keeps the research screen and entered basics when the discovery URL is persisted', async () => {
    useRealDiscovery = true;
    discoveryState = discovery('running', 'finding_competitors');
    let releaseDiscovery!: () => void;
    const pendingDiscovery = new Promise<void>((resolve) => {
      releaseDiscovery = resolve;
    });
    let creations = 0;
    mswServer.use(
      catalogHandler(),
      http.post(`/api/v1/brand-discoveries/${DISCOVERY_ID}/run`, () =>
        HttpResponse.json(discoveryState),
      ),
      http.post('/api/v1/brand-discoveries', async ({ request }) => {
        creations += 1;
        discoveryState = {
          ...discoveryState,
          input_data: (await request.json()) as Record<string, unknown>,
        };
        await pendingDiscovery;
        return HttpResponse.json(discoveryState);
      }),
      http.get(`/api/v1/brand-discoveries/${DISCOVERY_ID}`, () =>
        HttpResponse.json(discoveryState),
      ),
    );
    renderOnboarding();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/^Brand name/), 'Acme');
    await user.type(screen.getByLabelText(/^Website/), 'acme.example');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    const research = await screen.findByRole('heading', { name: 'Finding what to track' });
    act(() => releaseDiscovery());
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(`discovery=${DISCOVERY_ID}`),
    );

    // Persisting the resumable URL must not replay the progress screen.
    expect(screen.getByRole('heading', { name: 'Finding what to track' })).toBe(research);
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByLabelText(/^Brand name/)).toHaveValue('Acme');
    expect(screen.getByLabelText(/^Website/)).toHaveValue('acme.example');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('button', { name: 'Searching…' })).toBeDisabled();
    expect(creations).toBe(1);
  });

  it('keeps settings reachable from first-time setup', async () => {
    // `/onboarding` mounts outside the application chrome, so for an empty
    // workspace this flow bar's menu is the only way to reach settings.
    const user = userEvent.setup();
    mswServer.use(catalogHandler());
    renderOnboarding();

    await screen.findByLabelText(/^Brand name/);
    expect(screen.queryByRole('link', { name: 'Exit' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /account menu/i }));
    expect(await screen.findByRole('menuitem', { name: 'Settings' })).toBeVisible();
  });

  it('offers no way out of an additional-project flow that has nowhere to go', async () => {
    // "Add project" on the empty state also sets `?new=1` — it says the reader
    // asked for a project, not that they already have one. Offering Exit there
    // sent them to `/projects`, which is exactly the address that returns an
    // empty workspace to setup: a flicker, and back in the flow they were
    // trying to leave.
    searchParams = `new=1&workspace=${WORKSPACE_ID}`;
    selection.activeProjectId = null;
    mswServer.use(catalogHandler());
    renderOnboarding();

    await screen.findByLabelText(/^Brand name/);
    expect(screen.queryByRole('link', { name: 'Exit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Cancel' })).not.toBeInTheDocument();
  });

  it('keeps a way back to the projects it came from when adding another project', async () => {
    searchParams = `new=1&workspace=${WORKSPACE_ID}`;
    const user = userEvent.setup();
    mswServer.use(catalogHandler());
    renderOnboarding();

    // An additional project has somewhere to go back TO, so this flow keeps
    // its exit — and keeps the menu beside it rather than instead of it.
    expect(await screen.findByRole('link', { name: 'Exit' })).toHaveAttribute(
      'href',
      `/projects?project=${ACTIVE_PROJECT_ID}`,
    );
    await user.click(screen.getByRole('button', { name: /account menu/i }));
    expect(await screen.findByRole('menuitem', { name: 'Settings' })).toBeVisible();
  });

  it('keeps the active project in an additional-project cancellation URL', async () => {
    searchParams = `new=1&workspace=${WORKSPACE_ID}`;
    mswServer.use(catalogHandler());
    renderOnboarding();

    expect(await screen.findByRole('link', { name: 'Cancel' })).toHaveAttribute(
      'href',
      `/projects?project=${ACTIVE_PROJECT_ID}`,
    );
  });

  it('starts a fresh draft when Add project replaces a retained review URL', async () => {
    discoveryState = discovery('ready', 'preparing_review');
    searchParams = `new=1&discovery=${DISCOVERY_ID}&step=review`;
    mswServer.use(catalogHandler());
    const { rerender } = renderOnboarding();
    await screen.findByRole('button', { name: 'Create project' });

    searchParams = `new=1&workspace=${WORKSPACE_ID}`;
    rerender(
      <>
        <RouterProbe destination={onboardingUrl()} />
        <OnboardingScreen />
      </>,
    );
    expect(await screen.findByRole('button', { name: 'Continue' })).toBeVisible();
    expect(screen.getByLabelText(/brand name/i)).toHaveValue('');
    expect(screen.queryByRole('button', { name: 'Create project' })).not.toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent(onboardingUrl());
  });

  it('discards a cached onboarding transaction when navigating away and back', async () => {
    discoveryState = discovery('ready', 'preparing_review');
    mswServer.use(catalogHandler());
    const { rerender } = renderOnboarding();
    const user = await enterBrand();
    await user.click(screen.getByRole('button', { name: 'Review' }));
    await screen.findByRole('button', { name: 'Create project' });

    rerender(
      <>
        <RouterProbe destination="/projects" />
        <OnboardingScreen />
      </>,
    );
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/projects'));

    searchParams = `new=1&workspace=${WORKSPACE_ID}`;
    rerender(
      <>
        <RouterProbe destination={onboardingUrl()} />
        <OnboardingScreen />
      </>,
    );
    expect(await screen.findByRole('button', { name: 'Continue' })).toBeVisible();
    expect(screen.getByLabelText(/brand name/i)).toHaveValue('');
  });

  it('renders persisted discovery facts in human language without raw diagnostics', async () => {
    discoveryState = discovery('running', 'finding_competitors');
    mswServer.use(catalogHandler());
    renderOnboarding();

    await enterBrand();

    expect(screen.getByText('Opened your website')).toBeInTheDocument();
    expect(screen.getByText('Finding comparable brands')).toBeInTheDocument();
    expect(screen.getByText('3 pages read')).toBeInTheDocument();
    expect(screen.getByText(/learning what you offer/i)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(
      /finding_competitors|lease|attempt_count|error_detail|provider/i,
    );
  });

  it('submits one confirmed ICP completion and redirects to the command center', async () => {
    discoveryState = discovery('ready', 'preparing_review');
    let completionBody: unknown;
    mswServer.use(
      catalogHandler(),
      http.post(`/api/v1/brand-discoveries/${DISCOVERY_ID}/complete`, async ({ request }) => {
        completionBody = await request.json();
        // A completion whose project already exists (the replay path) carries
        // its id straight back, so the redirect needs no poll.
        return HttpResponse.json(
          {
            discovery_id: DISCOVERY_ID,
            project_id: PROJECT_ID,
            warnings: [],
          },
          { status: 202 },
        );
      }),
      // The committed creation is resolved through the project-detail read
      // before the shell is navigated to, so the destination is usable on
      // arrival rather than waiting on a list that predates the project.
      http.get(`/api/v1/projects/${PROJECT_ID}`, () => HttpResponse.json(createdProject)),
      http.post(`/api/v1/projects/${PROJECT_ID}/logos/refresh`, () =>
        HttpResponse.json(createdProject),
      ),
    );
    renderOnboarding();

    const user = await enterBrand();
    await user.click(screen.getByRole('button', { name: 'Review' }));
    const createProject = await screen.findByRole('button', { name: 'Create project' });
    await waitFor(() => expect(createProject).toBeEnabled());
    await user.click(createProject);

    await waitFor(() => expect(completionBody).toBeDefined());
    expect(completionBody).toMatchObject({
      profile: {
        positioning: 'Reliable product data',
        products_services: ['Product feeds'],
        target_audience: 'Retailers',
      },
      // Discovered competitors start selected up to the cap.
      competitors: [expect.objectContaining({ name: 'Globex' })],
    });
    // The destination NAMES the project. The shell resolves that exact id
    // instead of inferring one from a list fetched before it existed — which
    // is what used to land people on their previous project, or on an empty
    // account that then refused to create the one they had just made.
    expect(setActiveProjectId).toHaveBeenCalledWith(PROJECT_ID);
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(`/projects?project=${PROJECT_ID}`),
    );
  });

  it('shows page-level creation progress before opening the created project', async () => {
    discoveryState = discovery('ready', 'preparing_review');
    let releaseCompletion!: () => void;
    const completionSettled = new Promise<void>((resolve) => {
      releaseCompletion = resolve;
    });
    mswServer.use(
      catalogHandler(),
      http.post(`/api/v1/brand-discoveries/${DISCOVERY_ID}/complete`, async () => {
        await completionSettled;
        return HttpResponse.json({
          discovery_id: DISCOVERY_ID,
          project_id: PROJECT_ID,
          warnings: [],
        });
      }),
      // The committed creation is resolved through the project-detail read
      // before the shell is navigated to, so the destination is usable on
      // arrival rather than waiting on a list that predates the project.
      http.get(`/api/v1/projects/${PROJECT_ID}`, () => HttpResponse.json(createdProject)),
      http.post(`/api/v1/projects/${PROJECT_ID}/logos/refresh`, () =>
        HttpResponse.json(createdProject),
      ),
    );
    renderOnboarding();

    const user = await enterBrand();
    await user.click(screen.getByRole('button', { name: 'Review' }));
    const createProject = await screen.findByRole('button', { name: 'Create project' });
    await waitFor(() => expect(createProject).toBeEnabled());
    await user.click(createProject);

    expect(await screen.findByRole('heading', { name: 'Creating your project' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Create project' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Does this look right?' })).toBeNull();
    expect(screen.getByText('Next, choose the questions you want to track.')).toBeVisible();

    act(() => releaseCompletion());
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(`/projects?project=${PROJECT_ID}`),
    );
    expect(setActiveProjectId).toHaveBeenCalledWith(PROJECT_ID);
  });

  it('opens the committed project of a created discovery after reload', async () => {
    searchParams = `discovery=${DISCOVERY_ID}`;
    discoveryState = { ...discovery('project_created', 'complete'), project_id: PROJECT_ID };
    mswServer.use(
      catalogHandler(),
      // The committed creation is resolved through the project-detail read
      // before the shell is navigated to, so the destination is usable on
      // arrival rather than waiting on a list that predates the project.
      http.get(`/api/v1/projects/${PROJECT_ID}`, () => HttpResponse.json(createdProject)),
      http.post(`/api/v1/projects/${PROJECT_ID}/logos/refresh`, () =>
        HttpResponse.json(createdProject),
      ),
    );
    renderOnboarding();

    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(`/projects?project=${PROJECT_ID}`),
    );
    expect(setActiveProjectId).toHaveBeenCalledWith(PROJECT_ID);
    expect(visitedLocations).toEqual([onboardingUrl(), `/projects?project=${PROJECT_ID}`]);
  });

  it('starts fresh when a completion has lost its deleted project', async () => {
    searchParams = `discovery=${DISCOVERY_ID}&step=review`;
    discoveryState = discovery('project_created', 'complete');
    mswServer.use(catalogHandler());
    renderOnboarding();

    // The retry keeps the workspace the discarded draft belonged to, so it is
    // not silently re-targeted at whichever workspace resolves by default.
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(
        `/onboarding?new=1&workspace=${WORKSPACE_ID}`,
      ),
    );
    expect(screen.queryByRole('button', { name: 'Create project' })).not.toBeInTheDocument();
  });

  it('reports a queued generation failure without replaying the failed job', async () => {
    searchParams = `discovery=${DISCOVERY_ID}&step=review`;
    discoveryState = {
      ...discovery('failed', 'preparing_review'),
      project_id: PROJECT_ID,
    };
    mswServer.use(catalogHandler());
    renderOnboarding();

    expect(await screen.findByText(/project creation did not finish/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create project' })).toBeDisabled();
    expect(screen.getByTestId('location')).toHaveTextContent(onboardingUrl());
  });

  it('gates creation on the one thing the confirm screen asks for', async () => {
    // Brand knowledge moved to the app, so a blank category -- not a blank
    // positioning statement -- is what should block project creation.
    const ready = discovery('ready', 'preparing_review');
    discoveryState = {
      ...ready,
      profile: { ...ready.profile, category: '', category_options: [], category_aliases: [] },
    };
    mswServer.use(catalogHandler());
    renderOnboarding();

    const user = await enterBrand();
    await user.click(screen.getByRole('button', { name: 'Review' }));
    const createProject = await screen.findByRole('button', { name: 'Create project' });
    expect(createProject).toBeDisabled();

    await user.click(screen.getByRole('radio', { name: 'Other' }));
    await user.type(screen.getByLabelText(/describe what you sell/i), 'mattress brand');
    expect(createProject).toBeEnabled();
  });

  it('never asks the user to write brand prose', async () => {
    mswServer.use(catalogHandler());
    renderOnboarding();

    const user = await enterBrand();
    await user.click(screen.getByRole('button', { name: 'Review' }));
    await screen.findByRole('button', { name: 'Create project' });

    expect(screen.queryByLabelText(/positioning/i)).toBeNull();
    expect(screen.queryByLabelText(/target audience/i)).toBeNull();
    expect(screen.queryByLabelText(/^description/i)).toBeNull();
  });

  it('focuses each new stage heading and keeps review edits across a reload', async () => {
    discoveryState = discovery('ready', 'preparing_review');
    mswServer.use(catalogHandler());
    const first = renderOnboarding();

    const user = await enterBrand();
    expect(screen.getByRole('heading', { level: 1, name: 'Finding what to track' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Review' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Does this look right?' }),
    ).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Globex' }));
    await user.click(screen.getByRole('button', { name: 'acme.example' }));
    first.unmount();

    searchParams = `discovery=${DISCOVERY_ID}&step=review`;
    renderOnboarding();

    expect(await screen.findByRole('button', { name: 'Globex' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByRole('button', { name: 'acme.example' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    // A reload leaves focus where the page load put it.
    expect(
      screen.getByRole('heading', { level: 1, name: 'Does this look right?' }),
    ).not.toHaveFocus();
  });

  it('preselects suggestions up to the cap and keeps every choice reversible', async () => {
    discoveryState = {
      ...discovery('ready', 'preparing_review'),
      competitors: Array.from({ length: 6 }, (_, index) => ({
        name: `Peer ${index + 1}`,
        aliases: [],
        domains: [`peer-${index + 1}.example`],
      })),
    };
    mswServer.use(catalogHandler());
    renderOnboarding();

    const user = await enterBrand();
    await user.click(screen.getByRole('button', { name: 'Review' }));

    const sixth = await screen.findByRole('button', { name: 'Peer 6' });
    expect(screen.getByRole('button', { name: 'Peer 1' })).toHaveAttribute('aria-pressed', 'true');
    expect(sixth).toHaveAttribute('aria-pressed', 'false');
    expect(sixth).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Peer 1' }));
    expect(screen.getByRole('button', { name: 'Peer 1' })).toHaveAttribute('aria-pressed', 'false');
    expect(sixth).toBeEnabled();
  });
});
