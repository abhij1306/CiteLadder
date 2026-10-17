import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vite-plus/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import {
  ACTIVE_PROJECT_STORAGE_KEY,
  ACTIVE_WORKSPACE_STORAGE_KEY,
} from '@/lib/project/active-project-storage';
import { mswServer } from '@/test/msw-server';
import { makeProject } from '@/test/fixtures/project';
import { renderWithProviders } from '@/test/render';

let search = new URLSearchParams();
import { ProjectProvider, useProjectContext } from './project-context';

const WORKSPACE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const WORKSPACE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PROJECT_1 = '11111111-1111-4111-8111-111111111111';
const PROJECT_2 = '22222222-2222-4222-8222-222222222222';

function workspace(id: string, name: string) {
  return {
    id,
    name,
    role: 'owner',
    capabilities: ['manage_credentials', 'read', 'run', 'write'],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

function project(id: string, name: string, workspaceId = WORKSPACE_A) {
  return makeProject({
    id,
    workspace_id: workspaceId,
    name,
    brand_name: name,
    website_url: 'https://example.com',
  });
}

/** The default membership answer: one workspace, which is the shipped shape. */
function workspaceList(...ids: string[]) {
  return http.get('/api/v1/workspaces', () =>
    HttpResponse.json((ids.length ? ids : [WORKSPACE_A]).map((id) => workspace(id, `WS ${id}`))),
  );
}

function Harness() {
  const {
    activeProject,
    activeProjectId,
    activeWorkspaceId,
    projects,
    status,
    setActiveProjectId,
  } = useProjectContext();
  return (
    <div>
      <div data-testid="active">{activeProject?.name ?? 'none'}</div>
      <div data-testid="active-id">{activeProjectId ?? 'none'}</div>
      <div data-testid="workspace">{activeWorkspaceId ?? 'none'}</div>
      <div data-testid="count">{projects.length}</div>
      <div data-testid="status">{status}</div>
      {projects.map((item) => (
        <button key={item.id} type="button" onClick={() => setActiveProjectId(item.id)}>
          select {item.name}
        </button>
      ))}
    </div>
  );
}

function RouterProbe({ destination }: Readonly<{ destination: string }>) {
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    navigate(destination);
  }, [destination, navigate]);
  return <output data-testid="location">{location.pathname + location.search}</output>;
}

function renderProvider(destination = `/projects${search.size ? `?${search}` : ''}`) {
  return renderWithProviders(
    <>
      <RouterProbe destination={destination} />
      <ProjectProvider>
        <Harness />
      </ProjectProvider>
    </>,
    { initialEntries: [destination] },
  );
}

beforeAll(() => mswServer.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => {
  search = new URLSearchParams();
  window.localStorage.clear();
  // No logo refresh handler: every fixture lacks a logo, and an unhandled
  // request fails the test, so opening the app must not fetch logos.
  mswServer.use(workspaceList());
});
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

describe('ProjectProvider', () => {
  it('auto-selects the first project and stamps the workspace header', async () => {
    mswServer.use(
      http.get('/api/v1/projects', () =>
        HttpResponse.json([project(PROJECT_1, 'Acme'), project(PROJECT_2, 'Globex')]),
      ),
    );

    renderProvider();

    await waitFor(() => expect(screen.getByTestId('active')).toHaveTextContent('Acme'));
    expect(screen.getByTestId('active-id')).toHaveTextContent(PROJECT_1);
    expect(window.localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY)).toBe(WORKSPACE_A);
  });

  it('scopes the project list request to the resolved workspace', async () => {
    const headers: (string | null)[] = [];
    mswServer.use(
      http.get('/api/v1/projects', ({ request }) => {
        headers.push(request.headers.get('x-workspace-id'));
        return HttpResponse.json([project(PROJECT_1, 'Acme')]);
      }),
    );

    renderProvider();

    await waitFor(() => expect(screen.getByTestId('active')).toHaveTextContent('Acme'));
    // Carried ON the request, not read off a mutable global at send time — so a
    // retry cannot pick up a workspace the reader has since left.
    expect(headers).toContain(WORKSPACE_A);
  });

  it('resolves a workspace that owns no projects at all', async () => {
    // The regression this whole change exists for: the workspace used to be
    // derived from the active project, so a workspace with none had no
    // identity — and every workspace-scoped read fell back to the backend's
    // default, including the allowance check that decides whether the reader
    // may create their FIRST project.
    mswServer.use(http.get('/api/v1/projects', () => HttpResponse.json([])));

    renderProvider();

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('empty'));
    expect(screen.getByTestId('workspace')).toHaveTextContent(WORKSPACE_A);
    // Remembered so the next visit can scope its requests in the first render
    // instead of waiting a round trip for the membership list. A convenience,
    // never an authorization input — the backend still checks every request.
    expect(window.localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY)).toBe(WORKSPACE_A);
  });

  it('holds the URL workspace after the canonical replace stops naming it', async () => {
    // `projectDestination` drops `?workspace=` when it writes `?project=`, and
    // the shell does exactly that rewrite the moment a project resolves. With
    // the workspace remembered only in the address, the render in between fell
    // back to the FIRST membership and asked for its project list — a request
    // against a workspace the reader is not looking at, and a loader flash
    // before the project detail pulled it back.
    const headers: (string | null)[] = [];
    mswServer.use(
      workspaceList(WORKSPACE_A, WORKSPACE_B),
      http.get('/api/v1/projects', ({ request }) => {
        const header = request.headers.get('x-workspace-id');
        headers.push(header);
        return HttpResponse.json(
          header === WORKSPACE_B
            ? [project(PROJECT_2, 'Beta', WORKSPACE_B)]
            : [project(PROJECT_1, 'Acme')],
        );
      }),
      http.get('/api/v1/projects/:id', () =>
        HttpResponse.json(project(PROJECT_2, 'Beta', WORKSPACE_B)),
      ),
    );

    search = new URLSearchParams({ workspace: WORKSPACE_B });
    const view = renderProvider();
    await waitFor(() => expect(screen.getByTestId('active')).toHaveTextContent('Beta'));

    // The rewrite the shell performs: `?workspace=` out, `?project=` in.
    search = new URLSearchParams({ project: PROJECT_2 });
    view.rerender(
      <ProjectProvider>
        <Harness />
      </ProjectProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('active')).toHaveTextContent('Beta'));
    expect(screen.getByTestId('workspace')).toHaveTextContent(WORKSPACE_B);
    expect(headers.every((header) => header === WORKSPACE_B)).toBe(true);
  });

  it('changes the active project on selection and persists it', async () => {
    mswServer.use(
      http.get('/api/v1/projects', () =>
        HttpResponse.json([project(PROJECT_1, 'Acme'), project(PROJECT_2, 'Globex')]),
      ),
    );

    renderProvider();
    await waitFor(() => expect(screen.getByTestId('active')).toHaveTextContent('Acme'));

    await userEvent.click(screen.getByRole('button', { name: 'select Globex' }));

    await waitFor(() => expect(screen.getByTestId('active')).toHaveTextContent('Globex'));
    expect(window.localStorage.getItem(ACTIVE_PROJECT_STORAGE_KEY)).toBe(PROJECT_2);
  });

  it('restores a persisted selection when it still exists', async () => {
    window.localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, PROJECT_2);
    mswServer.use(
      http.get('/api/v1/projects', () =>
        HttpResponse.json([project(PROJECT_1, 'Acme'), project(PROJECT_2, 'Globex')]),
      ),
    );

    renderProvider();

    await waitFor(() => expect(screen.getByTestId('active')).toHaveTextContent('Globex'));
  });

  /**
   * The bug that cost a user their first project.
   *
   * Onboarding commits the project and navigates to `/projects?project=<id>`.
   * The list cached at that moment predates the project, so resolving the
   * active project FROM the list produced either the previous project or, on
   * a first project, nothing at all — which read as an empty account, bounced
   * the reader back to a blank `/onboarding`, and then refused their second
   * attempt because the first project had existed all along.
   *
   * The explicit id is now resolved directly, so a list that has not caught up
   * cannot contradict it.
   */
  it('uses an explicit ?project= that the cached list does not contain yet', async () => {
    search = new URLSearchParams({ project: PROJECT_2 });
    mswServer.use(
      // The pre-create list: settled, successful, and missing the new project.
      http.get('/api/v1/projects', () => HttpResponse.json([project(PROJECT_1, 'Acme')])),
      http.get(`/api/v1/projects/${PROJECT_2}`, () =>
        HttpResponse.json(project(PROJECT_2, 'Globex')),
      ),
    );

    renderProvider();

    await waitFor(() => expect(screen.getByTestId('active')).toHaveTextContent('Globex'));
    expect(screen.getByTestId('active-id')).toHaveTextContent(PROJECT_2);
    expect(screen.getByTestId('status')).toHaveTextContent('ready');
  });

  it('reports an explicit project that is missing or unauthorized as unavailable', async () => {
    search = new URLSearchParams({ project: PROJECT_2 });
    mswServer.use(
      http.get('/api/v1/projects', () => HttpResponse.json([project(PROJECT_1, 'Acme')])),
      http.get(`/api/v1/projects/${PROJECT_2}`, () =>
        HttpResponse.json({ error: { message: 'Project not found' } }, { status: 404 }),
      ),
    );

    renderProvider();

    // Substituting `projects[0]` here would silently show a DIFFERENT project
    // than the link asked for, which is how a shared link quietly lies.
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unavailable'));
    expect(screen.getByTestId('active')).toHaveTextContent('none');
  });

  it('rejects a URL naming a project from a different workspace', async () => {
    search = new URLSearchParams({ project: PROJECT_2, workspace: WORKSPACE_B });
    mswServer.use(
      workspaceList(WORKSPACE_A, WORKSPACE_B),
      http.get(`/api/v1/projects/${PROJECT_2}`, () =>
        HttpResponse.json(project(PROJECT_2, 'Globex', WORKSPACE_A)),
      ),
    );

    renderProvider();

    // Combining one project's id with another workspace's limits is how a
    // request ends up authorized against one tenancy and budgeted against
    // another. It is rejected rather than reconciled.
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unavailable'));
  });

  it('falls back to the first project when a settled list omits a stored one', async () => {
    // The bound on device storage: an id left behind by a deleted project must
    // not hold the context on a dead id forever.
    window.localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, PROJECT_2);
    mswServer.use(
      http.get('/api/v1/projects', () => HttpResponse.json([project(PROJECT_1, 'Acme')])),
    );

    renderProvider();

    await waitFor(() => expect(screen.getByTestId('active')).toHaveTextContent('Acme'));
    expect(window.localStorage.getItem(ACTIVE_PROJECT_STORAGE_KEY)).toBe(PROJECT_1);
  });

  it('offers a recoverable error rather than an empty account when a read fails', async () => {
    mswServer.use(
      http.get('/api/v1/workspaces', () => HttpResponse.error()),
      http.get('/api/v1/projects', () => HttpResponse.json([])),
    );

    renderProvider();

    // The shared retry policy makes two further attempts with backoff before
    // the failure is final, so this waits past that rather than racing it.
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('error'), {
      timeout: 10_000,
    });
  });
});
