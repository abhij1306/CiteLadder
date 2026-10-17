import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';

import { TooltipProvider } from '@/components/ui/tooltip';

const WORKSPACE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

vi.mock('@/lib/auth/session-guard', () => ({
  useSession: () => ({
    user: {
      id: '00000000-0000-4000-8000-000000000001',
      email: 'local@citeladder.local',
      role: 'admin',
      is_active: true,
      created_at: '2026-01-03T00:00:00Z',
      updated_at: '2026-07-14T09:22:00Z',
    },
  }),
}));

vi.mock('@/lib/project/project-context', () => ({
  useProjectContext: () => ({ activeWorkspaceId: WORKSPACE }),
}));

import { UserMenuController, UserMenuTrigger } from './user-menu';

function renderMenu(presenters: readonly ('sidebar' | 'compact')[]) {
  return render(
    <MemoryRouter initialEntries={['/visibility']}>
      <TooltipProvider>
        <UserMenuController>
          <>
            {presenters.map((presenter) => (
              <UserMenuTrigger key={presenter} presenter={presenter} />
            ))}
          </>
        </UserMenuController>
      </TooltipProvider>
    </MemoryRouter>,
  );
}

describe('UserMenu', () => {
  afterEach(() => window.localStorage.clear());

  it('links to Settings and to connecting AI assistants, in that order', async () => {
    const user = userEvent.setup();
    renderMenu(['sidebar']);

    await user.click(screen.getByRole('button', { name: /local@citeladder\.local/i }));

    const items = within(await screen.findByRole('menu')).getAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual(['Settings', 'Connect AI assistants']);
    // asChild renders the menuitem as the Link anchor itself.
    expect(items[0]).toHaveAttribute('href', `/settings?workspace=${WORKSPACE}`);
    expect(items[1]).toHaveAttribute('href', `/settings?tab=connections&workspace=${WORKSPACE}`);
  });

  it('restores focus to the trigger that opened the menu', async () => {
    const user = userEvent.setup();
    renderMenu(['sidebar', 'compact']);

    const compactTrigger = screen.getByRole('button', { name: /account menu/i });
    await user.click(compactTrigger);
    expect(await screen.findByRole('menu')).toBeVisible();
    await user.keyboard('{Escape}');
    await vi.waitFor(() => expect(compactTrigger).toHaveFocus());
  });
});
