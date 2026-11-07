import type { LucideIcon } from 'lucide-react';

import { ICONS } from '@/lib/icons';
import { navDestinations, type NavDestination } from '@/lib/navigation/app-routes';

/** A manifest nav entry with its glyph resolved, ready to render as a link. */
export type NavItem = Omit<NavDestination, 'icon'> & { icon: LucideIcon };

type NavGroup = {
  /** Null renders the group without a heading. */
  title: 'Analyze' | 'Act' | 'Track' | null;
  items: readonly NavItem[];
};

function navItems(placement: Parameters<typeof navDestinations>[0]): readonly NavItem[] {
  return navDestinations(placement).map((entry) => ({ ...entry, icon: ICONS[entry.icon] }));
}

/** Dashboard navigation in the order of the product loop. */
export const NAV_GROUPS: readonly NavGroup[] = [
  { title: null, items: navItems('dashboard:overview') },
  { title: 'Analyze', items: navItems('dashboard:analyze') },
  { title: 'Act', items: navItems('dashboard:act') },
  { title: 'Track', items: navItems('dashboard:track') },
];

/** Setup destinations shown below the Dashboard groups. */
export const SETUP_NAV_ITEMS = navItems('dashboard:setup');

/** Agent mode's fixed destinations, below New chat and above the chat list. */
export const AGENT_NAV_ITEMS = navItems('agent');

/** The user menu's workspace and account links. */
export const USER_MENU_ITEMS = navItems('user-menu');

const PALETTE_GROUPS = ['Overview', 'Analyze', 'Track', 'Agent', 'Settings'] as const;

/** Every shell destination, grouped for the command palette. */
export function resolveCommandGroups(): readonly {
  title: string;
  items: readonly NavItem[];
}[] {
  return PALETTE_GROUPS.map((title) => ({
    title,
    items: navItems(`palette:${title}`),
  }));
}

/**
 * A destination is current when the path is it or below it. A destination that
 * names query parameters (a settings tab) also needs each of them to match, so
 * Integrations is not current on another settings tab. Screens own their own
 * tabs: every tab of Website is still Website.
 */
export function isNavItemActive(
  pathname: string,
  searchParams: URLSearchParams,
  item: NavItem,
): boolean {
  const target = new URL(item.href, 'https://citeladder.local');
  const pathMatches = pathname === target.pathname || pathname.startsWith(`${target.pathname}/`);
  if (!pathMatches) return false;
  return [...target.searchParams].every(([key, value]) => searchParams.get(key) === value);
}
