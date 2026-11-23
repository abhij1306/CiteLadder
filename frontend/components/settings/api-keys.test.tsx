import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test';

import { apiKeysApi } from '@/lib/api/api-keys';
import { makeProject } from '@/test/fixtures/project';
import { renderWithProviders, selectionAs } from '@/test/render';
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
const SHOWN_ONCE = `cl_live_Ab12Cd34${'x'.repeat(43)}`;

const { list, create, revoke, remove } = vi.hoisted(() => ({
  list: vi.fn<(workspaceId: string) => Promise<ApiKeyList>>(),
  create: vi.fn<(workspaceId: string, input: ApiKeyCreate) => Promise<ApiKeyCreated>>(),
  revoke: vi.fn<(workspaceId: string, keyId: string) => Promise<ApiKey>>(),
  remove: vi.fn<(workspaceId: string, keyId: string) => Promise<void>>(),
}));
Object.assign(apiKeysApi, { list, create, revoke, remove });

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
  return renderWithProviders(<ApiKeys />, {
    projectSelection: {
      ...selectionAs('owner'),
      projects: [makeProject({ id: ACME, name: 'Acme' }), makeProject({ id: BETA, name: 'Beta' })],
    },
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-22T12:00:00Z'));
  document.cookie = 'citeladder-display-timezone=Asia%2FKolkata; path=/';
  list.mockReset();
  create.mockReset();
  revoke.mockReset();
  remove.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  document.cookie = 'citeladder-display-timezone=; path=/; max-age=0';
});

async function openCreate(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Create key' }));
  const dialog = screen.getByRole('dialog', { name: 'Create an API key' });
  await user.type(within(dialog).getByLabelText(/Name/u), 'CI export');
  return dialog;
}

it('defaults to 30 days, sends that day’s end in the display zone and bounds Custom at today', async () => {
  const user = userEvent.setup();
  list.mockResolvedValue({ keys: [] });
  create.mockResolvedValue({ key: ciKey, secret: SHOWN_ONCE });
  renderTab();
  const dialog = await openCreate(user);
  expect(dialog).toHaveTextContent('Ends at midnight, Asia/Kolkata');
  const expires = within(dialog).getByRole('combobox', { name: 'Expires' });
  expect(expires).toHaveTextContent('30 days (Tue, Dec 22)');

  await user.click(expires);
  await user.click(screen.getByRole('option', { name: 'Custom' }));
  const day = within(dialog).getByRole('textbox', { name: 'Expiry date' });
  await user.type(day, '2026-11-21');
  expect(dialog).toHaveTextContent('Choose today or a later date.');
  expect(within(dialog).getByRole('button', { name: 'Create key' })).toBeDisabled();
  await user.clear(day);
  await user.type(day, '2026-11-22');
  await user.click(within(dialog).getByRole('button', { name: 'Create key' }));
  expect(create).toHaveBeenLastCalledWith(
    WORKSPACE,
    expect.objectContaining({ expires_at: '2026-11-22T18:29:59.000Z' }),
  );
});

it('sends the 30-day preset unless Never is chosen', async () => {
  const user = userEvent.setup();
  list.mockResolvedValue({ keys: [] });
  create.mockResolvedValue({ key: ciKey, secret: SHOWN_ONCE });
  renderTab();
  const dialog = await openCreate(user);
  await user.click(within(dialog).getByRole('button', { name: 'Create key' }));
  expect(create).toHaveBeenLastCalledWith(
    WORKSPACE,
    expect.objectContaining({ expires_at: '2026-12-22T18:29:59.000Z' }),
  );
  await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Done' }));

  const again = await openCreate(user);
  await user.click(within(again).getByRole('combobox', { name: 'Expires' }));
  await user.click(screen.getByRole('option', { name: 'Never' }));
  await user.click(within(again).getByRole('button', { name: 'Create key' }));
  expect(create).toHaveBeenLastCalledWith(WORKSPACE, expect.objectContaining({ expires_at: null }));
});

it('lists a key by name, prefix, access, projects and expiry without its ID', async () => {
  list.mockResolvedValue({
    keys: [ciKey, { ...ciKey, id: BETA, name: 'Reader', scopes: ['read'], project_ids: null }],
  });
  renderTab();
  const row = (await screen.findByText('Acme')).closest('tr');
  expect(row).toHaveTextContent(
    'CI exportcl_live_Ab12Cd34…ActiveRead and writeAcmeNeverNot used yet',
  );
  expect(screen.getByText('Reader').closest('tr')).toHaveTextContent('ReadAll projects');
  expect(row?.textContent).not.toContain(KEY);
  expect(screen.getByText('2 keys in use')).toBeInTheDocument();
});

it('creates a read and write key for chosen projects and shows its secret once', async () => {
  const user = userEvent.setup();
  list.mockResolvedValue({ keys: [] });
  create.mockResolvedValue({ key: ciKey, secret: SHOWN_ONCE });
  renderTab();
  const dialog = await openCreate(user);
  await user.click(within(dialog).getByRole('radio', { name: 'Read and write' }));
  await user.click(within(dialog).getByRole('radio', { name: 'Chosen projects' }));
  await user.click(within(dialog).getByRole('checkbox', { name: 'Acme' }));
  await user.click(within(dialog).getByRole('combobox', { name: 'Expires' }));
  await user.click(screen.getByRole('option', { name: 'Never' }));
  await user.click(within(dialog).getByRole('button', { name: 'Create key' }));

  expect(create).toHaveBeenCalledWith(WORKSPACE, {
    name: 'CI export',
    scopes: [
      'read',
      'prompts:write',
      'competitors:write',
      'audits:run',
      'schedules:write',
      'actions:write',
    ],
    project_ids: [ACME],
    expires_at: null,
  });
  const shown = await screen.findByRole('dialog', {
    name: 'Copy your API key',
  });
  expect(shown).toHaveTextContent(SHOWN_ONCE);
  expect(shown).toHaveTextContent('Shown once.');
  await user.click(within(shown).getByRole('button', { name: 'Done' }));
  expect(screen.queryByText(SHOWN_ONCE)).toBeNull();
});

it('deletes a key only after confirmation and offers a revoked key Delete alone', async () => {
  const user = userEvent.setup();
  list.mockResolvedValue({
    keys: [ciKey, { ...ciKey, id: BETA, name: 'Old', state: 'revoked' }],
  });
  renderTab();
  await user.click(await screen.findByRole('button', { name: 'Old actions' }));
  expect(screen.queryByRole('menuitem', { name: 'Revoke' })).toBeNull();
  await user.keyboard('{Escape}');

  await user.click(screen.getByRole('button', { name: 'CI export actions' }));
  expect(screen.getByRole('menuitem', { name: 'Revoke' })).toBeInTheDocument();
  await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
  const confirm = screen.getByRole('alertdialog', { name: 'Delete CI export?' });
  expect(confirm).toHaveTextContent('Stops the key working');
  expect(remove).not.toHaveBeenCalled();
  await user.click(within(confirm).getByRole('button', { name: 'Delete' }));
  expect(remove).toHaveBeenCalledWith(WORKSPACE, KEY);
  expect(revoke).not.toHaveBeenCalled();
});
