import type { LucideIcon } from 'lucide-react';

import { ICONS } from '@/lib/icons';
import type { NavigationMode } from '@/lib/navigation/mode-memory';

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  /** A live count shown beside the label. */
  badge?: 'open-actions';
  /** Project is the default; workspace destinations never inherit a project. */
  scope?: 'project' | 'workspace';
};

export type NavGroup = {
  /** Null renders the group without a heading. */
  title: 'Analyze' | 'Act' | 'Track' | null;
  items: readonly NavItem[];
};

export const AGENT_HOME = '/agent';

const ACTIONS = {
  label: 'Actions',
  href: '/agent/actions',
  icon: ICONS.opportunities,
  badge: 'open-actions',
} as const satisfies NavItem;

/** Dashboard navigation in the order of the product loop. */
export const NAV_GROUPS = [
  {
    title: null,
    items: [{ label: 'Overview', href: '/projects', icon: ICONS.overview }],
  },
  {
    title: 'Analyze',
    items: [
      { label: 'Website', href: '/site', icon: ICONS.site },
      { label: 'Search Demand', href: '/demand', icon: ICONS.demand },
      { label: 'Issues', href: '/issues', icon: ICONS.issues },
      {
        label: 'Search Intelligence',
        href: '/search-intelligence',
        icon: ICONS.searchIntelligence,
      },
      { label: 'Performance', href: '/performance', icon: ICONS.performance },
      { label: 'Commerce Suite', href: '/products', icon: ICONS.products },
    ],
  },
  {
    title: 'Act',
    items: [ACTIONS],
  },
  {
    title: 'Track',
    items: [
      { label: 'Prompts', href: '/prompts', icon: ICONS.prompts },
      { label: 'AI Visibility', href: '/visibility', icon: ICONS.visibility },
      { label: 'Runs', href: '/runs', icon: ICONS.runs },
      { label: 'AI Traffic', href: '/ai-traffic', icon: ICONS.aiTraffic },
    ],
  },
] as const satisfies readonly NavGroup[];

/** Setup destinations shown below the Dashboard groups. */
export const SETUP_NAV_ITEMS = [
  {
    label: 'Integrations',
    href: '/settings?tab=integrations',
    icon: ICONS.setup,
    scope: 'workspace',
  },
] as const satisfies readonly NavItem[];

/** Agent mode's fixed destinations, below New chat and above the chat list. */
export const AGENT_NAV_ITEMS = [
  ACTIONS,
  { label: 'Skills', href: '/agent/skills', icon: ICONS.skills },
  { label: 'Context', href: '/agent/context', icon: ICONS.context },
] as const satisfies readonly NavItem[];

export function navigationMode(pathname: string): NavigationMode {
  return pathname === AGENT_HOME || pathname.startsWith(`${AGENT_HOME}/`) ? 'agent' : 'dashboard';
}

const SUPPORT_NAV_ITEMS = [
  ...SETUP_NAV_ITEMS,
  {
    label: 'Providers',
    href: '/settings?tab=providers',
    icon: ICONS.settings,
    scope: 'workspace',
  },
  { label: 'Settings', href: '/settings', icon: ICONS.settings, scope: 'workspace' },
] as const satisfies readonly NavItem[];

/** Every shell destination, grouped for the command palette. */
export function resolveCommandGroups(): readonly {
  title: string;
  items: readonly NavItem[];
}[] {
  return [
    // Actions is listed once, under Agent.
    ...NAV_GROUPS.filter((group) => group.title !== 'Act').map((group) => ({
      title: group.title ?? 'Overview',
      items: group.items,
    })),
    {
      title: 'Agent',
      items: [{ label: 'New chat', href: AGENT_HOME, icon: ICONS.newChat }, ...AGENT_NAV_ITEMS],
    },
    {
      title: 'Settings',
      items: SUPPORT_NAV_ITEMS,
    },
  ];
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
