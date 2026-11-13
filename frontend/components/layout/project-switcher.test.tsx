import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vite-plus/test';

import { ProjectSwitcher } from '@/components/layout/project-switcher';
import { TooltipProvider } from '@/components/ui/tooltip';
import { createAppQueryClient } from '@/lib/api/query-client';
import { SessionProvider } from '@/lib/auth/session-guard';
import { ProjectProvider, useProjectContext } from '@/lib/project/project-context';
import { makeProject } from '@/test/fixtures/project';
import { mswServer } from '@/test/msw-server';

const WORKSPACE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACME = makeProject({ id: '11111111-1111-4111-8111-111111111111', name: 'Acme' });
const GLOBEX = makeProject({
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Globex',
  brand_name: 'Globex',
  website_url: 'https://globex.example',
});

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

function Opened() {
  const { activeProject } = useProjectContext();
  return (
    <>
      <h1>Opened {activeProject?.name ?? 'nothing'}</h1>
      <ProjectSwitcher />
    </>
  );
}

let paths: string[] = [];
const record = ({ request }: { request: Request }) => {
  paths.push(new URL(request.url).pathname);
};

beforeAll(() => mswServer.listen({ onUnhandledFrame: 'bypass' }));
afterAll(() => mswServer.close());
afterEach(() => {
  mswServer.events.removeListener('request:start', record);
  mswServer.resetHandlers();
});
beforeEach(() => {
  window.localStorage.clear();
  paths = [];
  mswServer.events.on('request:start', record);
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
    // The list carries the switcher's fields only; each view is its own read.
    http.get('/api/v1/projects', () =>
      HttpResponse.json(
        [ACME, GLOBEX].map(({ id, name, brand_name, website_url }) => ({
          id,
          name,
          brand_name,
          website_url,
          brand: { logo_url: null },
        })),
      ),
    ),
    http.get('/api/v1/projects/:id', ({ params }) =>
      HttpResponse.json([ACME, GLOBEX].find((project) => project.id === params.id)),
    ),
  );
});

function renderSwitcher() {
  const router = createMemoryRouter(
    [
      {
        path: '/projects',
        element: (
          <ProjectProvider>
            <SessionProvider value={session}>
              <TooltipProvider>
                <Opened />
              </TooltipProvider>
            </SessionProvider>
          </ProjectProvider>
        ),
      },
    ],
    { initialEntries: ['/projects'] },
  );
  render(
    <QueryClientProvider client={createAppQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

it('asks for a project’s view while its row is highlighted, so choosing it reads nothing more', async () => {
  const router = renderSwitcher();
  const user = userEvent.setup();
  expect(await screen.findByRole('heading', { name: 'Opened Acme' })).toBeInTheDocument();
  const globexView = `/api/v1/projects/${GLOBEX.id}`;
  expect(paths).not.toContain(globexView);

  screen.getByRole('button', { name: 'Acme' }).focus();
  await user.keyboard('{Enter}');
  expect(await screen.findByRole('menuitem', { name: 'Globex' })).toBeInTheDocument();
  await user.keyboard('{ArrowDown}');
  await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Globex' })).toHaveFocus());
  await waitFor(() => expect(paths).toContain(globexView));

  await user.keyboard('{Enter}');

  expect(await screen.findByRole('heading', { name: 'Opened Globex' })).toBeInTheDocument();
  expect(router.state.location.search).toBe(`?project=${GLOBEX.id}`);
  expect(paths.filter((path) => path === globexView)).toEqual([globexView]);
  router.dispose();
});
