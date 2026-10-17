import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vite-plus/test';

import { createAppQueryClient } from '@/lib/api/query-client';
import type {
  ApiKey,
  ApiKeyCreate,
  ApiKeyCreated,
  ApiKeyList,
} from '@citeladder/contracts/api-keys';

const WORKSPACE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACME = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const BETA = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const KEY = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
/** A fixture shaped like a key, deliberately low-entropy so it reads as fake. */
const SHOWN_ONCE = `cl_live_Ab12Cd34${'x'.repeat(43)}`;

const { list, create, revoke } = vi.hoisted(() => ({
  list: vi.fn<(workspaceId: string) => Promise<ApiKeyList>>(),
  create: vi.fn<(workspaceId: string, input: ApiKeyCreate) => Promise<ApiKeyCreated>>(),
  revoke: vi.fn<(workspaceId: string, keyId: string) => Promise<ApiKey>>(),
}));
vi.mock('@/lib/api/api-keys', () => ({ apiKeysApi: { list, create, revoke } }));
vi.mock('@/lib/project/project-context', () => ({
  useProjectContext: () => ({
    activeWorkspaceId: WORKSPACE,
    projects: [
      { id: ACME, name: 'Acme' },
      { id: BETA, name: 'Beta' },
    ],
  }),
}));

import { ApiKeys } from './api-keys';

const ciKey: ApiKey = {
  id: KEY,
  name: 'CI export',
  prefix: 'cl_live_Ab12Cd34',
  scopes: ['read', 'audits:run'],
  project_ids: [ACME],
  created_by_email: 'ana@example.test',
  created_at: '2026-10-01T12:00:00Z',
  expires_at: null,
  last_used_at: null,
  revoked_at: null,
  state: 'active',
};

function renderTab() {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={createAppQueryClient()}>
        <ApiKeys />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  list.mockReset();
  create.mockReset();
  revoke.mockReset();
});

it('lists a key by name, prefix, scopes and projects without its ID', async () => {
  list.mockResolvedValue({ keys: [ciKey] });
  renderTab();
  const row = (await screen.findByText('Acme')).closest('li');
  expect(row).toHaveTextContent('CI export · cl_live_Ab12Cd34… · Active');
  expect(row).toHaveTextContent('readaudits:run');
  expect(row).toHaveTextContent('Created by ana@example.test · Created Oct 1, 2026 · Not used yet');
  expect(row?.textContent).not.toContain(KEY);
  expect(screen.getByText('1 key in use')).toBeInTheDocument();
});

it('creates a key for chosen projects and shows its secret once', async () => {
  const user = userEvent.setup();
  list.mockResolvedValue({ keys: [] });
  create.mockResolvedValue({ key: ciKey, secret: SHOWN_ONCE });
  renderTab();
  await user.click(await screen.findByRole('button', { name: 'Create key' }));
  const dialog = screen.getByRole('dialog', { name: 'Create an API key' });
  await user.type(within(dialog).getByLabelText(/Name/u), 'CI export');
  await user.click(within(dialog).getByRole('checkbox', { name: 'Launch and cancel audits' }));
  await user.click(within(dialog).getByRole('radio', { name: 'Chosen projects' }));
  await user.click(within(dialog).getByRole('checkbox', { name: 'Acme' }));
  await user.click(within(dialog).getByRole('button', { name: 'Create key' }));

  expect(create).toHaveBeenCalledWith(WORKSPACE, {
    name: 'CI export',
    scopes: ['read', 'audits:run'],
    project_ids: [ACME],
    expires_at: null,
  });
  const shown = await screen.findByRole('dialog', { name: 'Copy your API key' });
  expect(shown).toHaveTextContent(SHOWN_ONCE);
  expect(shown).toHaveTextContent('You won’t see this key again.');
  await user.click(within(shown).getByRole('button', { name: 'Done' }));
  expect(screen.queryByText(SHOWN_ONCE)).toBeNull();
});
