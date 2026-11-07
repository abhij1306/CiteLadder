import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vite-plus/test';

import { mswServer } from '@/test/msw-server';
import { renderWithProviders } from '@/test/render';

import { AppShell } from './app-shell';
import { ListScreen } from './page-shell';

beforeAll(() => mswServer.listen({ onUnhandledFrame: 'error' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

function renderShell() {
  // The shell's own reads (the open-Actions count, chats) answer empty.
  mswServer.use(http.get('/api/v1/*', () => HttpResponse.json({ items: [], next_cursor: null })));
  return renderWithProviders(
    <AppShell>
      <ListScreen title="Website">
        <p>Page content</p>
      </ListScreen>
    </AppShell>,
    { initialEntries: ['/site'] },
  );
}

describe('AppShell navigation drawer', () => {
  it('opens the labelled navigation from the header, closes on Escape and returns focus to the menu button', async () => {
    const user = userEvent.setup();
    renderShell();

    const menu = screen.getByRole('button', { name: 'Open navigation' });
    expect(menu).toHaveAttribute('aria-expanded', 'false');
    await user.click(menu);

    const drawer = screen.getByRole('dialog', { name: 'Navigation' });
    expect(within(drawer).getByRole('link', { name: 'Keyword Research' })).toBeVisible();
    expect(within(drawer).getByRole('link', { name: 'AI Visibility' })).toBeVisible();
    // The page behind the modal drawer is hidden from assistive technology.
    expect(menu).toHaveAttribute('aria-expanded', 'true');

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Open navigation' })).toHaveFocus();
  });

  it('closes once a destination is chosen', async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole('button', { name: 'Open navigation' }));
    const drawer = screen.getByRole('dialog', { name: 'Navigation' });
    await user.click(within(drawer).getByRole('link', { name: 'Prompts' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
