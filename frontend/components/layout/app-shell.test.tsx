import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vite-plus/test';

import { mswServer } from '@/test/msw-server';
import { focusByKeyboard } from '@/test/keyboard-focus';
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

const SIDEBAR_WIDTH_KEY = 'citeladder:app:sidebar-width';

/** The width the shell's grid gives the sidebar column, or '' for the token's default. */
function sidebarWidth() {
  const frame = screen.getByRole('main').parentElement;
  if (!frame) throw new Error('The shell frame is missing.');
  return frame.style.getPropertyValue('--sidebar-width');
}

describe('AppShell resizable sidebar', () => {
  const windowWidth = window.innerWidth;
  afterEach(() => {
    window.localStorage.clear();
    window.innerWidth = windowWidth;
    vi.restoreAllMocks();
  });

  it('opens at the width this browser stored, from the first frame', () => {
    window.localStorage.setItem(SIDEBAR_WIDTH_KEY, '320');
    renderShell();

    expect(screen.getByRole('separator', { name: 'Resize sidebar' })).toHaveAttribute(
      'aria-valuenow',
      '320',
    );
    expect(sidebarWidth()).toBe('320px');
  });

  it('follows a drag live and keeps the width it settles on', () => {
    renderShell();
    const handle = screen.getByRole('separator', { name: 'Resize sidebar' });
    expect(sidebarWidth()).toBe('');

    fireEvent.pointerDown(handle, { button: 0, pointerId: 4, clientX: 248 });
    fireEvent.pointerMove(handle, { pointerId: 4, clientX: 308 });
    expect(sidebarWidth()).toBe('308px');
    expect(window.localStorage.getItem(SIDEBAR_WIDTH_KEY)).toBeNull();
    expect(document.body.style.userSelect).toBe('none');

    fireEvent.pointerUp(handle, { pointerId: 4 });
    expect(window.localStorage.getItem(SIDEBAR_WIDTH_KEY)).toBe('308');
    expect(document.body.style.userSelect).toBe('');
  });

  it('resizes from the keyboard within its bounds and resets on Home and double-click', async () => {
    const user = userEvent.setup();
    // 40% of a 1000px window is 400, below the 480 ceiling.
    window.innerWidth = 1000;
    renderShell();
    const handle = screen.getByRole('separator', { name: 'Resize sidebar' });

    handle.focus();
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(handle).toHaveAttribute('aria-valuenow', '280');
    expect(sidebarWidth()).toBe('280px');

    await user.keyboard('{End}');
    expect(handle).toHaveAttribute('aria-valuenow', '400');
    expect(handle).toHaveAttribute('aria-valuemax', '400');

    await user.keyboard('{Home}');
    expect(handle).toHaveAttribute('aria-valuenow', '248');
    expect(window.localStorage.getItem(SIDEBAR_WIDTH_KEY)).toBeNull();

    await user.keyboard('{ArrowLeft}');
    expect(handle).toHaveAttribute('aria-valuenow', '248');

    await user.keyboard('{ArrowRight}');
    await user.dblClick(handle);
    expect(handle).toHaveAttribute('aria-valuenow', '248');
    expect(sidebarWidth()).toBe('');
  });

  it('shows the whole account email in a tooltip when the sidebar cuts it', async () => {
    // The full, labelled sidebar (from 1280px), where the email shows as text.
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query) =>
        ({
          matches: true,
          media: query,
          addEventListener: () => {},
          removeEventListener: () => {},
        }) as unknown as MediaQueryList,
    );
    renderShell();
    const account = screen.getByRole('button', { name: 'Account menu for test.user@example.test' });

    // Uncut, the row's own text says it all.
    focusByKeyboard(account);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    act(() => account.blur());

    // jsdom lays nothing out; report every line as wider than the sidebar.
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(1000);
    focusByKeyboard(account);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('test.user@example.test');
  });
});

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
