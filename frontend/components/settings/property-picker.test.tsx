import { screen, waitFor } from '@testing-library/react';
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

import type { IntegrationConnection } from '@/lib/api/integrations';

import { mswServer } from '@/test/msw-server';
import { renderWithProviders } from '@/test/render';
import { makeProject } from '@/test/fixtures/project';

const WS = '11111111-1111-4111-8111-111111111111';
const CONN = '33333333-3333-4333-8333-333333333333';
const PROJECT = '88888888-8888-4888-8888-888888888888';

const activeProject = makeProject({
  id: PROJECT,
  workspace_id: WS,
  name: 'Example.com',
});

let hasProject = true;
let mayDiscover = true;
vi.mock('@/lib/project/project-context', () => ({
  useWorkspaceCapability: () => mayDiscover,
  useActiveWorkspaceId: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  useProjectContext: () => ({
    projects: hasProject ? [activeProject] : [],
    activeProject: hasProject ? activeProject : null,
    activeProjectId: hasProject ? activeProject.id : null,
    setActiveProjectId: vi.fn(),
    isLoading: false,
  }),
}));

import { PropertyPicker } from './property-picker';

function connection(overrides: Partial<IntegrationConnection> = {}): IntegrationConnection {
  return {
    id: CONN,
    workspace_id: WS,
    grant_id: '22222222-2222-4222-8222-222222222222',
    provider: 'gsc',
    label: 'example.com GSC',
    account_ref: '',
    grant_status: 'connected',
    granted_scopes: [],
    last_synced_at: null,
    created_at: '2026-07-20T00:00:00Z',
    updated_at: '2026-07-20T00:00:00Z',
    ...overrides,
  } as IntegrationConnection;
}

// Distinct labels so a query for the label can never also match the ref.
const properties = [
  {
    property_ref: 'sc-domain:example.com',
    label: 'Example (domain property)',
    matches_project: true,
  },
  {
    property_ref: 'https://www.example.com/',
    label: 'Example (URL prefix)',
    matches_project: true,
  },
  { property_ref: 'https://other.test/', label: 'Another site', matches_project: false },
];

function mockProperties(items: unknown[] = properties) {
  mswServer.use(
    http.post(`/api/v1/integrations/${CONN}/properties`, () => HttpResponse.json(items)),
  );
}

function mapping(propertyRef: string, status = 'active', projectId = PROJECT) {
  return {
    id: '99999999-9999-4999-8999-999999999999',
    workspace_id: WS,
    connection_id: CONN,
    provider: 'gsc',
    property_ref: propertyRef,
    project_id: projectId,
    status,
    created_at: '2026-07-31T00:00:00Z',
    updated_at: '2026-07-31T00:00:00Z',
  };
}

/** The active mapping — not account_ref — is what marks a property chosen. */
function mockMappings(rows: unknown[] = []) {
  mswServer.use(http.get(`/api/v1/integrations/${CONN}/mappings`, () => HttpResponse.json(rows)));
}

beforeAll(() => mswServer.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => mockMappings());
afterEach(() => {
  mswServer.resetHandlers();
  hasProject = true;
  mayDiscover = true;
});
afterAll(() => mswServer.close());

describe('PropertyPicker', () => {
  it('shows saved mappings without discovery controls for members and viewers', async () => {
    mayDiscover = false;
    mockMappings([mapping('sc-domain:example.com')]);
    renderWithProviders(<PropertyPicker connection={connection()} />);
    expect(await screen.findByText('sc-domain:example.com')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change Search Console property' })).toBeNull();
  });
  it('flags an unselected connection instead of showing an empty ref', () => {
    renderWithProviders(<PropertyPicker connection={connection()} />);

    // The state that made syncs fail silently must be visible, not blank.
    expect(screen.getByText('No Search Console property selected')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Select Search Console property' }),
    ).toBeInTheDocument();
  });

  it('does not call the provider until the dialog opens', async () => {
    const ue = userEvent.setup();
    let calls = 0;
    mswServer.use(
      http.post(`/api/v1/integrations/${CONN}/properties`, () => {
        calls += 1;
        return HttpResponse.json(properties);
      }),
    );
    renderWithProviders(<PropertyPicker connection={connection()} />);

    // Discovery is a live upstream call — it must be lazy, not on mount.
    expect(calls).toBe(0);

    await ue.click(screen.getByRole('button', { name: 'Select Search Console property' }));
    await waitFor(() => expect(calls).toBe(1));
  });

  it('selects a property and posts the mapping for the active project', async () => {
    const ue = userEvent.setup();
    mockProperties();
    let body: Record<string, unknown> | null = null;
    mswServer.use(
      http.post(`/api/v1/integrations/${CONN}/mappings`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          {
            id: '99999999-9999-4999-8999-999999999999',
            workspace_id: WS,
            connection_id: CONN,
            provider: 'gsc',
            property_ref: 'sc-domain:example.com',
            project_id: PROJECT,
            status: 'active',
            created_at: '2026-07-31T00:00:00Z',
            updated_at: '2026-07-31T00:00:00Z',
          },
          { status: 201 },
        );
      }),
    );
    renderWithProviders(<PropertyPicker connection={connection()} />);

    await ue.click(screen.getByRole('button', { name: 'Select Search Console property' }));
    await ue.click(await screen.findByText('Example (domain property)'));

    await waitFor(() => expect(body).not.toBeNull());
    expect(body).toEqual({
      provider: 'gsc',
      property_ref: 'sc-domain:example.com',
      project_id: PROJECT,
    });
  });

  it('blocks duplicate discovery while the provider request is pending', async () => {
    const ue = userEvent.setup();
    let complete!: (response: Response) => void;
    const response = new Promise<Response>((resolve) => {
      complete = resolve;
    });
    let calls = 0;
    mswServer.use(
      http.post(`/api/v1/integrations/${CONN}/properties`, () => {
        calls++;
        return response;
      }),
    );
    renderWithProviders(<PropertyPicker connection={connection()} />);
    try {
      await ue.click(screen.getByRole('button', { name: 'Select Search Console property' }));
      await waitFor(() => expect(calls).toBe(1));
      await ue.click(screen.getByRole('button', { name: 'Close dialog' }));
      const select = screen.getByRole('button', { name: 'Select Search Console property' });
      expect(select).toBeDisabled();
      await ue.click(select);
      expect(calls).toBe(1);
    } finally {
      complete(HttpResponse.json(properties));
    }
  });

  it('shows a provider failure rather than an empty property list', async () => {
    const ue = userEvent.setup();
    mswServer.use(
      http.post(`/api/v1/integrations/${CONN}/properties`, () =>
        // A rejected grant: the envelope's `retryable: false` is what stops
        // the shared query policy from retrying a 5xx, so the error surfaces
        // immediately instead of after a backoff chain.
        HttpResponse.json(
          {
            detail: 'grant rejected',
            error: {
              code: 'grant_auth_failed',
              message: 'grant rejected',
              request_id: 'test',
              retryable: false,
            },
          },
          { status: 502 },
        ),
      ),
    );
    renderWithProviders(<PropertyPicker connection={connection()} />);

    await ue.click(screen.getByRole('button', { name: 'Select Search Console property' }));

    // A broken upstream must never read as "you own no properties".
    expect(await screen.findByText(/Could not load your properties/)).toBeInTheDocument();
    expect(screen.queryByText(/has no Search Console property available/)).toBeNull();
  });

  it('blocks selection when there is no active project to import into', async () => {
    const ue = userEvent.setup();
    hasProject = false;
    mockProperties();
    renderWithProviders(<PropertyPicker connection={connection()} />);

    await ue.click(screen.getByRole('button', { name: 'Select Search Console property' }));

    expect(await screen.findByText(/No active project/)).toBeInTheDocument();
    const option = await screen.findByText('Example (domain property)');
    expect(option.closest('button')).toBeDisabled();
  });

  it('offers a change for an already-selected property', async () => {
    mockMappings([mapping('sc-domain:example.com')]);
    renderWithProviders(<PropertyPicker connection={connection()} />);

    expect(await screen.findByText('sc-domain:example.com')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Change Search Console property' }),
    ).toBeInTheDocument();
  });

  it('reports no selection when account_ref outlives its mapping', async () => {
    // Mappings cascade away with their project while account_ref lives on the
    // connection. Trusting account_ref showed a confidently "selected"
    // property whose every sync was failing `unmapped_property`.
    mockMappings([mapping('sc-domain:example.com', 'disabled')]);
    renderWithProviders(
      <PropertyPicker connection={connection({ account_ref: 'sc-domain:example.com' })} />,
    );

    expect(await screen.findByText('No Search Console property selected')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Select Search Console property' }),
    ).toBeInTheDocument();
  });

  it("shows only the active project's property, and refuses another site's property", async () => {
    const ue = userEvent.setup();
    // The connection also serves another project; that mapping is not this row's.
    mockMappings([
      mapping('https://other.test/', 'active', '77777777-7777-4777-8777-777777777777'),
    ]);
    mockProperties();
    renderWithProviders(<PropertyPicker connection={connection()} />);

    expect(await screen.findByText('No Search Console property selected')).toBeInTheDocument();
    await ue.click(screen.getByRole('button', { name: 'Select Search Console property' }));
    const foreign = await screen.findByText('Another site');
    expect(foreign.closest('button')).toBeDisabled();
    expect(screen.getByText('Example (domain property)').closest('button')).toBeEnabled();
  });
});
