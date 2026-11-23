import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vite-plus/test';

import { mswServer } from '@/test/msw-server';
import { focusByKeyboard } from '@/test/keyboard-focus';
import { renderWithProviders } from '@/test/render';

import { ReportPage } from '@/components/templates/report-page';

import { AppShell } from './app-shell';

beforeAll(() => mswServer.listen({ onUnhandledFrame: 'error' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

function renderShell() {
  mswServer.use(http.get('/api/v1/*', () => HttpResponse.json({ items: [], next_cursor: null })));
  return renderWithProviders(
    <AppShell>
      <ReportPage title="Website">
        <p>Page content</p>
      </ReportPage>
    </AppShell>,
    { initialEntries: ['/site'] },
  );
}

const SIDEBAR_WIDTH_KEY = 'citeladder:app:sidebar-width';

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

    fireEvent.pointerDown(handle, { button: 0, pointerId: 4, clientX: 200 });
    fireEvent.pointerMove(handle, { pointerId: 4, clientX: 308 });
    expect(sidebarWidth()).toBe('308px');
    expect(window.localStorage.getItem(SIDEBAR_WIDTH_KEY)).toBeNull();
    expect(document.body.style.userSelect).toBe('none');

    fireEvent.pointerUp(handle, { pointerId: 4 });
    expect(window.localStorage.getItem(SIDEBAR_WIDTH_KEY)).toBe('308');
    expect(document.body.style.userSelect).toBe('');
  });

  it('resizes from the keyboard within its bounds, down to the compact width, and resets on double-click', async () => {
    const user = userEvent.setup();
    window.innerWidth = 1000;
    renderShell();
    const handle = screen.getByRole('separator', { name: 'Resize sidebar' });

    handle.focus();
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(handle).toHaveAttribute('aria-valuenow', '232');
    expect(sidebarWidth()).toBe('232px');

    await user.keyboard('{ArrowLeft}');
    expect(handle).toHaveAttribute('aria-valuenow', '216');

    await user.keyboard('{End}');
    expect(handle).toHaveAttribute('aria-valuenow', '400');
    expect(handle).toHaveAttribute('aria-valuemax', '400');

    await user.keyboard('{Home}');
    expect(handle).toHaveAttribute('aria-valuenow', '200');
    expect(handle).toHaveAttribute('aria-valuemin', '200');
    expect(window.localStorage.getItem(SIDEBAR_WIDTH_KEY)).toBeNull();

    await user.keyboard('{ArrowLeft}');
    expect(handle).toHaveAttribute('aria-valuenow', '200');

    await user.keyboard('{ArrowRight}');
    await user.dblClick(handle);
    expect(handle).toHaveAttribute('aria-valuenow', '200');
    expect(sidebarWidth()).toBe('');
  });

  it('steps through preset widths on a click that does not drag, wrapping to the compact width', async () => {
    const user = userEvent.setup();
    window.innerWidth = 1000;
    renderShell();
    const handle = screen.getByRole('separator', { name: 'Resize sidebar' });

    const widths = [];
    for (let step = 0; step < 4; step += 1) {
      await user.click(handle);
      widths.push(handle.getAttribute('aria-valuenow'));
    }
    expect(widths).toEqual(['224', '288', '360', '200']);

    fireEvent.pointerDown(handle, { button: 0, pointerId: 5, clientX: 200 });
    fireEvent.pointerMove(handle, { pointerId: 5, clientX: 250 });
    fireEvent.pointerUp(handle, { pointerId: 5 });
    fireEvent.click(handle, { detail: 1 });
    expect(handle).toHaveAttribute('aria-valuenow', '250');
  });

  it('collapses to the rail and back from its toggle and the keyboard, and keeps the choice', async () => {
    const user = userEvent.setup();
    const { unmount } = renderShell();
    const frame = () => screen.getByRole('main').parentElement;
    expect(frame()).toHaveAttribute('data-sidebar-state', 'expanded');
    const toggle = screen.getByRole('button', { name: 'Collapse sidebar' });
    const sidebar = screen.getByRole('complementary', { name: 'Sidebar' });
    const controls = [...sidebar.querySelectorAll('a, button')];
    expect(controls.slice(-2)).toEqual([
      toggle,
      screen.getByRole('button', { name: 'Account menu for test.user@example.test' }),
    ]);

    await user.click(toggle);
    expect(frame()).toHaveAttribute('data-sidebar-state', 'collapsed');
    expect(screen.queryByRole('separator', { name: 'Resize sidebar' })).not.toBeInTheDocument();
    unmount();

    renderShell();
    expect(frame()).toHaveAttribute('data-sidebar-state', 'collapsed');
    await user.keyboard('{Control>}\\{/Control}');
    expect(frame()).toHaveAttribute('data-sidebar-state', 'expanded');
    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toBeVisible();
  });

  it('collapses to one rail button per group, few enough to fit a window 520 high', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem('citeladder:app:sidebar-collapsed', '1');
    renderShell();
    const sidebar = screen.getByRole('complementary', { name: 'Sidebar' });
    const buttons = [
      ...within(sidebar).getAllByRole('button'),
      ...within(sidebar).getAllByRole('link'),
    ];
    expect(buttons).toHaveLength(12);
    const controls = [...sidebar.querySelectorAll('a, button')];
    expect(controls.at(-2)).toBe(within(sidebar).getByRole('button', { name: 'Expand sidebar' }));
    expect(2 * 8 + buttons.length * 40 + 4 * 4).toBeLessThanOrEqual(520);

    const analyze = within(sidebar).getByRole('button', { name: 'Website' });
    expect(analyze).toHaveAttribute('aria-current', 'true');
    analyze.focus();
    await user.keyboard('{ArrowRight}');
    const flyout = await screen.findByRole('menu', { name: 'Website' });
    expect(within(flyout).getByRole('menuitem', { name: 'Site health' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(analyze).toHaveFocus();
  });

  it('names the account in a tooltip only in the rail, never when labelled', async () => {
    const user = userEvent.setup();
    renderShell();
    const account = () =>
      screen.getByRole('button', { name: 'Account menu for test.user@example.test' });
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(1000);

    focusByKeyboard(account());
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    act(() => account().blur());

    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    focusByKeyboard(account());
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
    expect(within(drawer).getByRole('link', { name: 'Keyword research' })).toBeVisible();
    expect(within(drawer).getByRole('link', { name: 'Sources' })).toBeVisible();
    expect(menu).toHaveAttribute('aria-expanded', 'true');

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Open navigation' })).toHaveFocus();
  });

  it('opens one account menu from the drawer, not a second one for the hidden desktop sidebar', async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole('button', { name: 'Open navigation' }));
    const drawer = screen.getByRole('dialog', { name: 'Navigation' });
    await user.click(
      within(drawer).getByRole('button', { name: 'Account menu for test.user@example.test' }),
    );

    expect(await screen.findAllByRole('menu')).toHaveLength(1);
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
