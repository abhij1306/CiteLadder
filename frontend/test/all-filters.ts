import { screen } from '@testing-library/react';
import type userEvent from '@testing-library/user-event';

type User = ReturnType<typeof userEvent.setup>;

const filterName = (label: string, value?: string) =>
  value ? `${label}: ${value}` : new RegExp(`^${label}:`);

/**
 * Finds one filter as a reader does, named with its value ("Topic: All
 * topics"): its row inside All filters, or, where the list has only that
 * filter, its own trigger in the control row.
 */
export async function openFilterRow(user: User, label: string, value?: string) {
  const all = screen.queryByRole('button', { name: /^All filters/ });
  if (!all) return screen.findByRole('button', { name: filterName(label, value) });
  await user.click(all);
  return screen.findByRole('menuitem', { name: filterName(label, value) });
}

/** Opens one filter's options: its submenu in All filters, or a lone filter's own menu. */
export async function openFilterOptions(user: User, label: string, value?: string) {
  const row = await openFilterRow(user, label, value);
  if (row.getAttribute('role') !== 'menuitem') {
    await user.click(row);
    return;
  }
  row.focus();
  await user.keyboard('{ArrowRight}');
}

/** Opens a filter's options and activates one of its items (a radio, a check or an action). */
export async function chooseFilterOption(
  user: User,
  label: string,
  choice: string | RegExp,
  role: 'menuitemradio' | 'menuitemcheckbox' | 'menuitem' = 'menuitemradio',
) {
  await openFilterOptions(user, label);
  (await screen.findByRole(role, { name: choice })).focus();
  await user.keyboard('{Enter}');
}
