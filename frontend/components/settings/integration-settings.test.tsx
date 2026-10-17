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
import { queryKeys } from '@/lib/api/query-keys';
import { mswServer } from '@/test/msw-server';
import { renderWithProviders } from '@/test/render';
import { makeProject } from '@/test/fixtures/project';
import { DISPLAY_TIME_ZONE_COOKIE } from '@/lib/display-timezone';

// Callback routes are mounted at their actual query-bearing React Router locations.
let search = '';
const replaceState = vi.spyOn(window.history, 'replaceState');
// Connect/Reconnect hard-navigates to the OAuth start 302 endpoint through the
// lib/navigate seam (jsdom can't stub Location#assign).
vi.mock('@/lib/navigation/hard-navigate', () => ({ hardNavigate: vi.fn() }));
const assignMock = vi.mocked(hardNavigate);

const WS = '11111111-1111-4111-8111-111111111111';
const GRANT_GOOGLE = '22222222-2222-4222-8222-222222222222';
const GRANT_MS = '55555555-5555-4555-8555-555555555555';
const CONN_GSC = '33333333-3333-4333-8333-333333333333';
const CONN_GA4 = '44444444-4444-4444-8444-444444444444';
const CONN_BING = '66666666-6666-4666-8666-666666666666';
const SYNC = '77777777-7777-4777-8777-777777777777';
const MAPPING_ID = '99999999-9999-4999-8999-999999999999';

const activeProject = makeProject({
  id: '88888888-8888-4888-8888-888888888888',
  workspace_id: WS,
  name: 'Example.com',
  brand_name: 'Example',
});
vi.mock('@/lib/project/project-context', () => ({
  useWorkspaceCapability: () => true,
  useActiveWorkspaceId: () => WS,
  useProjectContext: () => ({
    projects: [activeProject],
    activeProject,
    activeProjectId: activeProject.id,
    setActiveProjectId: vi.fn(),
    isLoading: false,
  }),
}));

function renderSettings() {
  return renderWithProviders(<IntegrationSettings />, {
    initialEntries: [`/settings${search ? `?${search}` : ''}`],
  });
}

import { IntegrationSettings } from './integration-settings';

// Fixture shapes from the contract suite (lib/api/integrations.test.ts):
// a connection joined to grant status + granted scopes, never a token field.
function connection(overrides: Record<string, unknown> = {}) {
  return {
    id: CONN_GSC,
    workspace_id: WS,
    grant_id: GRANT_GOOGLE,
    provider: 'gsc',
    label: 'example.com GSC',
    account_ref: 'sc-domain:example.com',
    grant_status: 'connected',
    granted_scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
    last_synced_at: '2026-07-23T04:12:00Z',
    created_at: '2026-07-20T00:00:00Z',
    updated_at: '2026-07-23T04:12:00Z',
    ...overrides,
  };
}

const gscConnection = connection();
const ga4Connection = connection({
  id: CONN_GA4,
  provider: 'ga4',
  label: 'example.com GA4',
  account_ref: 'properties/123456789',
  granted_scopes: ['https://www.googleapis.com/auth/analytics.readonly'],
  last_synced_at: '2026-07-23T04:09:00Z',
});
const bingConnection = connection({
  id: CONN_BING,
  grant_id: GRANT_MS,
  provider: 'bing',
  label: 'example.com Bing',
  account_ref: 'https://example.com/',
  grant_status: 'needs_reauth',
  granted_scopes: ['bing.webmaster.readonly'],
  last_synced_at: '2026-07-21T22:41:00Z',
});

function syncRun(overrides: Record<string, unknown> = {}) {
  return {
    id: SYNC,
    connection_id: CONN_GSC,
    sync_kind: 'on_demand',
    status: 'queued',
    window_start: '2026-07-16',
    window_end: '2026-07-22',
    row_count: 0,
    processing: false,
    resync_seq: 1,
    error_code: '',
    error_detail: '',
    created_at: '2026-07-23T04:31:00Z',
    updated_at: '2026-07-23T04:31:00Z',
    completed_at: null,
    ...overrides,
  };
}

function mockList(items: Record<string, unknown>[]) {
  mswServer.use(http.get('/api/v1/integrations', () => HttpResponse.json(items)));
}

/**
 * Every connection reports ONE active mapping by default.
 *
 * The card reads the mapping — not `account_ref` — to decide whether a
 * property is selected, because the two drift apart (mappings cascade with
 * their project while `account_ref` survives on the connection).
 */
function mockMappings() {
  mswServer.use(
    http.get('/api/v1/integrations/:connectionId/mappings', ({ params }) => {
      const connectionId = String(params.connectionId);
      const source = [gscConnection, ga4Connection, bingConnection].find(
        (conn) => conn.id === connectionId,
      );
      return HttpResponse.json([
        {
          // A real uuid: the mapping schema is strict and validates the shape.
          id: MAPPING_ID,
          workspace_id: WS,
          connection_id: connectionId,
          provider: source?.provider ?? 'gsc',
          property_ref: source?.account_ref ?? '',
          project_id: activeProject.id,
          status: 'active',
          created_at: '2026-07-20T00:00:00Z',
          updated_at: '2026-07-20T00:00:00Z',
        },
      ]);
    }),
  );
}

beforeAll(() => mswServer.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => mockMappings());
afterEach(() => {
  mswServer.resetHandlers();
  document.cookie = `${DISPLAY_TIME_ZONE_COOKIE}=; Path=/; Max-Age=0`;
});
afterAll(() => mswServer.close());

describe('IntegrationSettings — empty state + OAuth navigation', () => {
  beforeEach(() => {
    search = '';
    assignMock.mockClear();
    replaceState.mockClear();
  });

  it('renders the empty state and Connect CTAs hard-navigate to the OAuth start endpoints', async () => {
    const ue = userEvent.setup();
    mockList([]);
    renderSettings();

    expect(await screen.findByText('No integrations connected')).toBeInTheDocument();
    expect(screen.getByText(/Search Console and Analytics 4/)).toBeInTheDocument();

    await ue.click(screen.getByRole('button', { name: 'Connect Google' }));
    expect(assignMock).toHaveBeenCalledWith(
      `/api/v1/integrations/workspaces/${WS}/oauth/gsc/start`,
    );

    await ue.click(screen.getByRole('button', { name: 'Connect Bing' }));
    expect(assignMock).toHaveBeenCalledWith(
      `/api/v1/integrations/workspaces/${WS}/oauth/bing/start`,
    );
  });
});

describe('IntegrationSettings — grant cards', () => {
  beforeEach(() => {
    search = '';
    assignMock.mockClear();
    replaceState.mockClear();
  });

  it('groups connections onto one card per grant with sub-rows and mono last-synced', async () => {
    document.cookie = `${DISPLAY_TIME_ZONE_COOKIE}=Asia%2FKolkata; Path=/`;
    mockList([gscConnection, ga4Connection, bingConnection]);
    renderSettings();

    const googleCard = await screen.findByTestId('grant-card-google');
    expect(within(googleCard).getByText('Google Search Console')).toBeInTheDocument();
    expect(within(googleCard).getByText('Google Analytics 4')).toBeInTheDocument();
    // The selected property comes from the connection's active MAPPING, which
    // is a second fetch — hence findBy rather than getBy.
    expect(await within(googleCard).findByText('sc-domain:example.com')).toBeInTheDocument();
    expect(within(googleCard).getByText('properties/123456789')).toBeInTheDocument();
    const lastSynced = googleCard.querySelector('time[datetime="2026-07-23T04:12:00Z"]');
    expect(lastSynced?.textContent).toMatch(/Jul 23, 2026.*09:42/);

    const msCard = screen.getByTestId('grant-card-microsoft');
    expect(within(msCard).getByText('Bing Webmaster Tools')).toBeInTheDocument();
    // Needs reauth → warning alert + Sync now disabled (grant not connected).
    expect(within(msCard).getByText(/requires renewed consent/i)).toBeInTheDocument();
    expect(
      within(msCard).getByRole('button', { name: 'Sync Bing Webmaster Tools now' }),
    ).toBeDisabled();
    expect(
      within(screen.getByTestId('connection-row-gsc')).getByRole('button', {
        name: 'Sync Google Search Console now',
      }),
    ).toBeEnabled();
  });

  it('renders a not-connected card for a grant family with no grant', async () => {
    assignMock.mockClear();
    const ue = userEvent.setup();
    mockList([gscConnection, ga4Connection]);
    renderSettings();

    const msCard = await screen.findByTestId('grant-card-microsoft');
    expect(within(msCard).getByText('Not connected')).toBeInTheDocument();
    await ue.click(within(msCard).getByRole('button', { name: 'Connect Bing' }));
    expect(assignMock).toHaveBeenCalledWith(
      `/api/v1/integrations/workspaces/${WS}/oauth/bing/start`,
    );
  });

  it('Reconnect hard-navigates to the family OAuth start endpoint', async () => {
    const ue = userEvent.setup();
    mockList([gscConnection, ga4Connection, bingConnection]);
    renderSettings();

    const googleCard = await screen.findByTestId('grant-card-google');
    await ue.click(within(googleCard).getByRole('button', { name: 'Reconnect' }));
    expect(assignMock).toHaveBeenCalledWith(
      `/api/v1/integrations/workspaces/${WS}/oauth/gsc/start`,
    );

    const msCard = screen.getByTestId('grant-card-microsoft');
    await ue.click(within(msCard).getByRole('button', { name: 'Reconnect' }));
    expect(assignMock).toHaveBeenCalledWith(
      `/api/v1/integrations/workspaces/${WS}/oauth/bing/start`,
    );
  });

  it('Test runs the probe and shows the inline result', async () => {
    const ue = userEvent.setup();
    mockList([gscConnection, ga4Connection]);
    mswServer.use(
      http.post(`/api/v1/integrations/${CONN_GSC}/test`, () =>
        HttpResponse.json({
          connection_id: CONN_GSC,
          status: 'ok',
          error_code: '',
          detail: '',
          tested_at: '2026-07-23T05:00:00Z',
        }),
      ),
    );
    renderSettings();

    const row = await screen.findByTestId('connection-row-gsc');
    await ue.click(within(row).getByRole('button', { name: 'Test Google Search Console' }));
    expect(await within(row).findByText('Connection succeeded.')).toBeInTheDocument();
  });
});

describe('IntegrationSettings — disconnect and remove', () => {
  beforeEach(() => {
    search = '';
    assignMock.mockClear();
    replaceState.mockClear();
  });

  it('disconnects the whole grant after confirmation, keeping imported data', async () => {
    const ue = userEvent.setup();
    let deleted = '';
    mockList([gscConnection, ga4Connection]);
    mswServer.use(
      http.delete('/api/v1/integrations/:id', ({ params }) => {
        deleted = String(params.id);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderSettings();

    const card = await screen.findByTestId('grant-card-google');
    await ue.click(within(card).getByRole('button', { name: 'Disconnect Google' }));
    const dialog = await screen.findByRole('dialog');
    await ue.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(deleted).toBe('');

    await ue.click(within(card).getByRole('button', { name: 'Disconnect Google' }));
    await ue.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Disconnect' }),
    );
    await waitFor(() => expect(deleted).toBe(CONN_GSC));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it("removes only this project's property from a row", async () => {
    const ue = userEvent.setup();
    let removed = '';
    mockList([gscConnection, ga4Connection]);
    mswServer.use(
      http.delete('/api/v1/integrations/mappings/:id', ({ params }) => {
        removed = String(params.id);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderSettings();

    const row = await screen.findByTestId('connection-row-gsc');
    await ue.click(
      await within(row).findByRole('button', {
        name: 'Remove Google Search Console property from this project',
      }),
    );
    await waitFor(() => expect(removed).toBe(MAPPING_ID));
  });
});

describe('IntegrationSettings — sync polling', () => {
  beforeEach(() => {
    search = '';
    assignMock.mockClear();
    replaceState.mockClear();
  });

  it('Sync now enqueues, polls the run until its reports are built, then refreshes the connections list', async () => {
    const ue = userEvent.setup();
    let runStatus = 'running';
    let processing = false;
    let listCalls = 0;
    let syncBody: unknown = null;
    mswServer.use(
      http.get('/api/v1/integrations', () => {
        listCalls += 1;
        return HttpResponse.json([gscConnection, ga4Connection]);
      }),
      http.post(`/api/v1/integrations/${CONN_GSC}/sync`, async ({ request }) => {
        syncBody = await request.json();
        return HttpResponse.json(
          { sync_run_id: SYNC, connection_id: CONN_GSC, status: 'queued' },
          { status: 202 },
        );
      }),
      http.get(`/api/v1/integrations/${CONN_GSC}/syncs/${SYNC}`, () =>
        HttpResponse.json(
          syncRun({
            status: runStatus,
            processing,
            row_count: 2148,
            completed_at: runStatus === 'succeeded' ? '2026-07-23T04:33:00Z' : null,
          }),
        ),
      ),
    );
    const { queryClient } = renderWithProviders(<IntegrationSettings />);

    const row = await screen.findByTestId('connection-row-gsc');
    const syncName = 'Sync Google Search Console now';
    const syncButton = within(row).getByRole('button', { name: syncName });
    await waitFor(() => expect(listCalls).toBe(1));
    // Sync is gated on the connection having an active property mapping, so
    // it only enables once that fetch lands.
    await waitFor(() => expect(syncButton).toBeEnabled());
    await ue.click(syncButton);
    // A connection can serve several projects, so the sync names this one.
    await waitFor(() => expect(syncBody).toEqual({ project_id: activeProject.id }));

    // The enqueued run is polled and surfaced as a run-status badge; Sync now
    // stays disabled while the run is non-terminal.
    expect(await within(row).findByText('Running')).toBeInTheDocument();
    expect(within(row).getByText(/2,148 rows · window Jul 16–Jul 22/)).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: syncName })).toBeDisabled();

    // The import finishes while the project's reports are still rebuilding:
    // Sync now stays disabled so a second click cannot queue a duplicate.
    runStatus = 'succeeded';
    processing = true;
    await queryClient.invalidateQueries({ queryKey: queryKeys.integrations.sync(CONN_GSC, SYNC) });
    expect(await within(row).findByText('Processing')).toBeInTheDocument();
    expect(within(row).getByText('2,148 rows imported · updating reports')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: syncName })).toBeDisabled();

    // Reports rebuilt: the result stays visible, the connections list
    // refreshes (last_synced_at), and Sync now is available again.
    processing = false;
    await queryClient.invalidateQueries({ queryKey: queryKeys.integrations.sync(CONN_GSC, SYNC) });
    expect(await within(row).findByText('Succeeded')).toBeInTheDocument();
    expect(within(row).getByText('2,148 rows imported · window Jul 16–Jul 22')).toBeInTheDocument();
    await waitFor(() => expect(listCalls).toBeGreaterThan(1));
    expect(within(row).getByRole('button', { name: syncName })).toBeEnabled();
  });
});

describe('IntegrationSettings — OAuth callback notice (C2)', () => {
  beforeEach(() => {
    assignMock.mockClear();
    replaceState.mockClear();
  });

  it('shows the success notice for ?connected= and strips the params from the URL', async () => {
    search = 'tab=integrations&connected=gsc';
    mockList([gscConnection, ga4Connection]);
    renderSettings();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Google connected.');
    expect(alert.textContent).toMatch(/shared OAuth grant/i);
    await waitFor(() =>
      expect(replaceState).toHaveBeenCalledWith(null, '', '/settings?tab=integrations'),
    );
  });

  it('explains a failed callback in words, never the raw code', async () => {
    search = 'tab=integrations&error=oauth_exchange_failed';
    mockList([]);
    renderSettings();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Connection failed.');
    expect(alert).not.toHaveTextContent('oauth_exchange_failed');
    // The empty state still renders beneath the notice.
    expect(await screen.findByText('No integrations connected')).toBeInTheDocument();
    await waitFor(() =>
      expect(replaceState).toHaveBeenCalledWith(null, '', '/settings?tab=integrations'),
    );
  });

  it('renders no notice and does not touch the URL without callback params', async () => {
    search = 'tab=integrations';
    mockList([gscConnection, ga4Connection]);
    renderSettings();

    await screen.findByTestId('grant-card-google');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(replaceState).not.toHaveBeenCalled();
  });
});
