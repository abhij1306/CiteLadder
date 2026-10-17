import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { projectsApi } from '@/lib/api/projects';
import { renderWithProviders as render } from '@/test/render';

import { ProjectMarkets } from './project-markets';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const US = {
  id: null,
  label: 'United States · English',
  country_code: 'US',
  language_code: 'en',
  is_default: true,
  created_at: null,
};
const DE = {
  id: '55555555-5555-4555-8555-555555555555',
  label: 'Germany · German',
  country_code: 'DE',
  language_code: 'de',
  is_default: false,
  created_at: '2026-10-10T00:00:00Z',
};

async function choose(name: string, typed: string, option: RegExp) {
  const user = userEvent.setup();
  const input = screen.getByRole('combobox', { name });
  await user.click(input);
  await user.type(input, typed);
  await user.click(screen.getByRole('option', { name: option }));
}

describe('Project markets', () => {
  afterEach(() => vi.restoreAllMocks());

  it('adds a market from a chosen country and language', async () => {
    vi.spyOn(projectsApi, 'listMarkets').mockResolvedValue([US]);
    const add = vi.spyOn(projectsApi, 'addMarket').mockResolvedValue([US, DE]);
    render(<ProjectMarkets projectId={PROJECT_ID} workspaceId={WORKSPACE_ID} />);
    const button = screen.getByRole('button', { name: 'Add market' });
    expect(button).toBeDisabled();
    await choose('Market country', 'germ', /Germany/);
    await choose('Market language', 'germ', /German/);
    await userEvent.setup().click(button);
    await waitFor(() =>
      expect(add).toHaveBeenCalledWith(
        PROJECT_ID,
        { country_code: 'DE', language_code: 'de' },
        { workspaceId: WORKSPACE_ID },
      ),
    );
    expect(await screen.findByText('Germany · German')).toBeInTheDocument();
  });

  it('lists additional markets, never the default, and removes one', async () => {
    vi.spyOn(projectsApi, 'listMarkets').mockResolvedValue([US, DE]);
    const remove = vi.spyOn(projectsApi, 'deleteMarket').mockResolvedValue(undefined);
    render(<ProjectMarkets projectId={PROJECT_ID} workspaceId={WORKSPACE_ID} />);
    await userEvent
      .setup()
      .click(await screen.findByRole('button', { name: 'Remove Germany · German' }));
    await waitFor(() =>
      expect(remove).toHaveBeenCalledWith(PROJECT_ID, DE.id, { workspaceId: WORKSPACE_ID }),
    );
    expect(screen.queryByText('United States · English')).not.toBeInTheDocument();
  });
});
