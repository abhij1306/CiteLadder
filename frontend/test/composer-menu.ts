import { screen } from '@testing-library/react';
import type userEvent from '@testing-library/user-event';

/**
 * Opens one of the Agent composer's + submenus by keyboard: the keys every
 * reader has, and jsdom cannot follow a pointer into a Radix submenu.
 */
export async function openComposerSubmenu(
  user: ReturnType<typeof userEvent.setup>,
  submenu: RegExp,
) {
  await user.click(await screen.findByRole('button', { name: 'Add a skill or Action' }));
  (await screen.findByRole('menuitem', { name: submenu })).focus();
  await user.keyboard('{ArrowRight}');
}

export async function pickFromComposerMenu(
  user: ReturnType<typeof userEvent.setup>,
  submenu: RegExp,
  row: Readonly<{ role: 'menuitem' | 'menuitemradio'; name: string }>,
) {
  await openComposerSubmenu(user, submenu);
  (await screen.findByRole(row.role, { name: row.name })).focus();
  await user.keyboard('{Enter}');
}
