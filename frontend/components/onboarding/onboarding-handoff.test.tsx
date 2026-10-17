import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vite-plus/test';

import { OnboardingGate } from '@/components/layout/onboarding-gate';
import { ProjectSwitcher } from '@/components/layout/project-switcher';
import { UserMenuController } from '@/components/layout/user-menu';
import { TooltipProvider } from '@/components/ui/tooltip';
import { createAppQueryClient } from '@/lib/api/query-client';
import { SessionProvider } from '@/lib/auth/session-guard';
import { ProjectProvider, useProjectContext } from '@/lib/project/project-context';
import { makeProject } from '@/test/fixtures/project';
import { mswServer } from '@/test/msw-server';

import { OnboardingPageClient } from './onboarding-page-client';

/**
 * The first-project hand-off through the REAL selection provider.
 * `onboarding-screen.test` mocks the project context, so it cannot
 * see what the providers do to the setup route once the project exists.
 */

const WORKSPACE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DISCOVERY = '11111111-1111-4111-8111-111111111111';
const PROJECT = '22222222-2222-4222-8222-222222222222';
const created = makeProject({
  id: PROJECT,
  workspace_id: WORKSPACE,
  brand: { aliases: [], logo_url: 'https://acme.example/logo.png' },
});

let projectExists = false;

function discovery() {
  return {
    id: DISCOVERY,
    workspace_id: WORKSPACE,
    project_id: projectExists ? PROJECT : null,
    status: projectExists ? 'project_created' : 'ready',
    progress: {
      phase: projectExists ? 'complete' : 'preparing_review',
      completed_steps: 4,
      total_steps: 4,
      pages_read: 3,
      competitors_found: 0,
    },
    input_data: {
      brand_name: 'Acme',
      website_url: 'https://acme.example',
      primary_market: 'US',
      language_code: 'en',
    },
    profile: {
      description: '',
      positioning: '',
      products_services: [],
      target_audience: '',
      industry: '',
      business_type: 'b2b',
      price_tier: '',
      field_confidence: {},
      category: 'feed management software',
      category_options: [],
      category_aliases: [],
      category_terms: [],
      jobs_to_be_done: [],
      sector: '',
      business_model: 'b2b_saas',
      secondary_business_models: [],
      market_scope: 'global',
      buyer_register: 'research_comparative',
      buyer_roles: [],
      service_areas: [],
      knowledge_strength: 'strong',
    },
    domains: ['acme.example'],
    competitors: [],
    evidence: [],
    warnings: [],
    error_code: '',
    created_at: '2026-08-04T00:00:00Z',
    updated_at: '2026-08-04T00:00:00Z',
  };
}

const session = {
  user: {
    id: '00000000-0000-4000-8000-000000000001',
    email: 'owner@example.test',
    role: 'user' as const,
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
};

function Layout() {
  return (
    <ProjectProvider>
      <SessionProvider value={session}>
        <UserMenuController>
          <TooltipProvider>
            <Outlet />
          </TooltipProvider>
        </UserMenuController>
      </SessionProvider>
    </ProjectProvider>
  );
}

function OpenedProject() {
  const { activeProject } = useProjectContext();
  return (
    <>
      <h1>Opened {activeProject?.id}</h1>
      <ProjectSwitcher />
    </>
  );
}

beforeAll(() => mswServer.listen({ onUnhandledRequest: 'bypass' }));
afterAll(() => mswServer.close());
afterEach(() => mswServer.resetHandlers());
beforeEach(() => {
  projectExists = false;
  window.localStorage.clear();
  mswServer.use(
    http.get('/api/v1/workspaces', () =>
      HttpResponse.json([
        {
          id: WORKSPACE,
          name: 'Workspace',
          role: 'owner',
          capabilities: ['read', 'run', 'write'],
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      ]),
    ),
    http.get('/api/v1/projects', () => HttpResponse.json(projectExists ? [created] : [])),
    http.get(`/api/v1/projects/${PROJECT}`, () => HttpResponse.json(created)),
    http.get('/api/v1/brand-discovery-catalog', () =>
      HttpResponse.json({
        maximum_competitors: 5,
        industries: [],
        subindustries: {},
      }),
    ),
    http.get(`/api/v1/brand-discoveries/${DISCOVERY}`, () => HttpResponse.json(discovery())),
    http.post(`/api/v1/brand-discoveries/${DISCOVERY}/complete`, () => {
      projectExists = true;
      return HttpResponse.json({
        discovery_id: DISCOVERY,
        project_id: PROJECT,
        warnings: [],
      });
    }),
  );
});

function renderSetup(entry: string) {
  const router = createMemoryRouter(
    [
      {
        element: <Layout />,
        children: [
          { path: '/onboarding', element: <OnboardingPageClient /> },
          {
            path: '/projects',
            element: (
              <OnboardingGate>
                <OpenedProject />
              </OnboardingGate>
            ),
          },
        ],
      },
    ],
    { initialEntries: [entry] },
  );
  render(
    <QueryClientProvider client={createAppQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

async function createProject(router: ReturnType<typeof renderSetup>) {
  const create = await screen.findByRole('button', { name: 'Create project' });
  await waitFor(() => expect(create).toBeEnabled());
  await userEvent.setup().click(create);

  expect(await screen.findByRole('heading', { name: `Opened ${PROJECT}` })).toBeInTheDocument();
  expect(router.state.location.pathname).toBe('/projects');
  await userEvent.setup().click(screen.getByRole('button', { name: 'Acme' }));
  // No project limit: another project can be started straight away.
  expect(await screen.findByRole('menuitem', { name: 'New project' })).not.toHaveAttribute(
    'aria-disabled',
  );
  router.dispose();
}

it('opens the project a failed request committed instead of leaving setup open', async () => {
  // The server finished creating the project, but the browser never saw the
  // response (it gave up waiting, or the connection dropped).
  mswServer.use(
    http.post(`/api/v1/brand-discoveries/${DISCOVERY}/complete`, () => {
      projectExists = true;
      return HttpResponse.error();
    }),
  );
  const router = renderSetup(
    `/onboarding?workspace=${WORKSPACE}&discovery=${DISCOVERY}&step=review`,
  );
  await createProject(router);
});

it('opens the first project when setup runs start to finish in one visit', async () => {
  mswServer.use(
    http.post('/api/v1/brand-discoveries', () => HttpResponse.json(discovery(), { status: 202 })),
  );
  const router = renderSetup(`/onboarding?workspace=${WORKSPACE}`);
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText(/^Brand name/), 'Acme');
  await user.type(screen.getByLabelText(/^Website/), 'acme.example');
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  const review = await screen.findByRole('button', { name: 'Review' });
  await waitFor(() => expect(review).toBeEnabled());
  await user.click(review);
  await createProject(router);
});
