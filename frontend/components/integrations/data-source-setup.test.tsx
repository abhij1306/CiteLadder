import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

import { hardNavigate } from '@/lib/navigation/hard-navigate';
import { mswServer } from '@/test/msw-server';
import { renderWithProviders } from '@/test/render';
import { makeProject } from '@/test/fixtures/project';

const WS = '11111111-1111-4111-8111-111111111111';
const GRANT = '22222222-2222-4222-8222-222222222222';
const GSC = '33333333-3333-4333-8333-333333333333';
const GA4 = '44444444-4444-4444-8444-444444444444';
const PROJECT = '88888888-8888-4888-8888-888888888888';
const OTHER_PROJECT = '77777777-7777-4777-8777-777777777777';

const activeProject = makeProject({ id: PROJECT, workspace_id: WS, name: 'Example' });
let canManage = true;

vi.mock('@/lib/navigation/hard-navigate', () => ({ hardNavigate: vi.fn() }));
vi.mock('@/lib/project/project-context', () => ({
  useWorkspaceCapability: () => canManage,
  useActiveWorkspaceId: () => WS,
  useProjectContext: () => ({ activeProject, activeWorkspaceId: WS, isLoading: false }),
}));

import { DataSourceSetup } from './data-source-setup';

function connection(id: string, provider: 'gsc' | 'ga4', grantStatus = 'connected') {
  return {
    id,
    workspace_id: WS,
    grant_id: GRANT,
    provider,
    label: '',
    account_ref: '',
    grant_status: grantStatus,
    granted_scopes: [],
    last_synced_at: null,
    created_at: '2026-07-20T00:00:00Z',
    updated_at: '2026-07-20T00:00:00Z',
  };
}

function mapping(connectionId: string, projectId: string) {
  return {
    id: '99999999-9999-4999-8999-999999999999',
    workspace_id: WS,
    connection_id: connectionId,
    provider: 'gsc',
    property_ref: 'sc-domain:example.com',
    project_id: projectId,
    status: 'active',
    created_at: '2026-07-20T00:00:00Z',
    updated_at: '2026-07-20T00:00:00Z',
  };
}

function serve(connections: unknown[], mappings: Record<string, unknown[]> = {}) {
  mswServer.use(
    http.get('/api/v1/integrations', () => HttpResponse.json(connections)),
    http.get('/api/v1/integrations/:id/mappings', ({ params }) =>
      HttpResponse.json(mappings[String(params.id)] ?? []),
    ),
  );
}

function renderSetup(path = `/performance?project=${PROJECT}`, whenReady?: string) {
  return renderWithProviders(
    <DataSourceSetup
      required={['gsc']}
      optional={['ga4']}
      title="Connect Search Console"
      description="Performance reads this project's own search data."
      whenReady={whenReady}
    />,
    { initialEntries: [path] },
  );
}

beforeAll(() => mswServer.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => vi.mocked(hardNavigate).mockClear());
afterEach(() => {
  mswServer.resetHandlers();
  canManage = true;
});
afterAll(() => mswServer.close());

describe('DataSourceSetup', () => {
  it('starts one Google consent for both sources and returns to this screen', async () => {
    const ue = userEvent.setup();
    serve([]);
    renderSetup('/performance?project=' + PROJECT + '&range=28d');

    const connect = await screen.findByRole('button', { name: 'Connect Google' });
    expect(screen.getAllByRole('button', { name: /^Connect/ })).toHaveLength(1);
    await ue.click(connect);
    const target = new URL(vi.mocked(hardNavigate).mock.calls[0]![0], 'https://app.test');
    expect(target.pathname).toBe(`/api/v1/integrations/workspaces/${WS}/oauth/gsc/start`);
    const back = new URL(target.searchParams.get('return_to')!, 'https://app.test');
    expect(back.pathname).toBe('/performance');
    expect(back.searchParams.get('project')).toBe(PROJECT);
    expect(back.searchParams.get('range')).toBe('28d');
  });

  it('after consent, lists the properties and offers the matching one as one click', async () => {
    const ue = userEvent.setup();
    let mapped: unknown = null;
    serve([connection(GSC, 'gsc'), connection(GA4, 'ga4')]);
    mswServer.use(
      http.post(`/api/v1/integrations/${GSC}/properties`, () =>
        HttpResponse.json([
          { property_ref: 'https://other.test/', label: 'Other', matches_project: false },
          { property_ref: 'sc-domain:example.com', label: 'example.com', matches_project: true },
        ]),
      ),
      http.post(`/api/v1/integrations/${GSC}/mappings`, async ({ request }) => {
        mapped = await request.json();
        return HttpResponse.json(mapping(GSC, PROJECT), { status: 201 });
      }),
      http.post(`/api/v1/integrations/${GSC}/run`, () => new HttpResponse(null, { status: 200 })),
      http.post(`/api/v1/integrations/${GA4}/properties`, () =>
        HttpResponse.json([{ property_ref: '123', label: 'Main GA4', matches_project: null }]),
      ),
    );
    renderSetup(`/performance?project=${PROJECT}&connected=gsc`);

    expect(await screen.findByText('Google connected.')).toBeInTheDocument();
    // Discovery starts by itself on return, for every source the consent covered.
    await ue.click(
      await screen.findByRole('button', { name: 'Use example.com for Google Search Console' }),
    );
    await waitFor(() =>
      expect(mapped).toEqual({
        provider: 'gsc',
        property_ref: 'sc-domain:example.com',
        project_id: PROJECT,
      }),
    );
    // GA4 exposes no site to match, so its only property is the suggestion.
    expect(
      screen.getByRole('button', { name: 'Use Main GA4 for Google Analytics 4' }),
    ).toBeInTheDocument();
  });

  it("treats another project's property as unchosen and a refused grant as reconnect", async () => {
    serve([connection(GSC, 'gsc'), connection(GA4, 'ga4', 'needs_reauth')], {
      [GSC]: [mapping(GSC, OTHER_PROJECT)],
    });
    renderSetup();

    expect(
      await screen.findByRole('button', { name: 'Choose Search Console property' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reconnect Google' })).toBeInTheDocument();
  });

  it('asks a member to involve an admin instead of offering consent', async () => {
    canManage = false;
    serve([]);
    renderSetup();

    const setup = await screen.findByTestId('data-source-setup');
    expect(await within(setup).findByText('Ask a workspace owner or admin')).toBeInTheDocument();
    expect(within(setup).queryByRole('button', { name: 'Connect Google' })).toBeNull();
  });

  it('disappears once the required source imports into this project', async () => {
    serve([connection(GSC, 'gsc')], { [GSC]: [mapping(GSC, PROJECT)] });
    mswServer.use(
      http.get(`/api/v1/integrations/${GSC}/syncs/progress`, () =>
        HttpResponse.json({
          connection_id: GSC,
          state: 'complete',
          total_windows: 1,
          completed_windows: 1,
          failed_windows: 0,
          covered_from: '2026-01-01',
          covered_through: '2026-07-20',
        }),
      ),
    );
    renderSetup();

    // It shows while loading, then nothing: the screen keeps it mounted without noise.
    expect(screen.getByTestId('data-source-setup')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('data-source-setup')).toBeNull());
  });

  it('shows the ready content in place of the setup card once sources are ready', async () => {
    serve([connection(GSC, 'gsc')], { [GSC]: [mapping(GSC, PROJECT)] });
    mswServer.use(
      http.get(`/api/v1/integrations/${GSC}/syncs/progress`, () =>
        HttpResponse.json({
          connection_id: GSC,
          state: 'complete',
          total_windows: 1,
          completed_windows: 1,
          failed_windows: 0,
          covered_from: '2026-01-01',
          covered_through: '2026-07-20',
        }),
      ),
    );
    renderSetup(undefined, 'Waiting for the first import.');

    expect(screen.getByTestId('data-source-setup')).toBeInTheDocument();
    expect(await screen.findByText('Waiting for the first import.')).toBeInTheDocument();
    expect(screen.queryByTestId('data-source-setup')).toBeNull();
  });
});
