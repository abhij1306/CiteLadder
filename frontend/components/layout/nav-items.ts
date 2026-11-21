import {
  DASHBOARD_SIDEBAR_GROUPS,
  isAgentPath,
  MODE_HOMES,
  navDestinations,
} from '@/lib/navigation/app-routes';
import { ICONS, type IconGlyph } from '@/lib/icons';
import type { NavDestination } from '@/lib/navigation/route-types';

export type NavItem = Omit<NavDestination, 'icon'> & { icon: IconGlyph };

type DashboardGroup = (typeof DASHBOARD_SIDEBAR_GROUPS)[number];

export type NavGroup = Readonly<
  DashboardGroup & {
    icon: IconGlyph;
    items: readonly NavItem[];
  }
>;

function navItems(placement: Parameters<typeof navDestinations>[0]): readonly NavItem[] {
  return navDestinations(placement).map((entry) => ({ ...entry, icon: ICONS[entry.icon] }));
}

const GROUP_ICONS = {
  home: ICONS.overview,
  brand: ICONS.insights,
  tracking: ICONS.prompts,
  website: ICONS.site,
  search: ICONS.searchIntelligence,
  commerce: ICONS.products,
} satisfies Record<DashboardGroup['group'], IconGlyph>;

export const DASHBOARD_GROUPS: readonly NavGroup[] = DASHBOARD_SIDEBAR_GROUPS.map((entry) => ({
  ...entry,
  icon: GROUP_ICONS[entry.group],
  items: navItems(`sidebar:${entry.group}`),
}));

const agentEntries = navItems('sidebar:agent');

export const NEW_CHAT_ITEM: NavItem = agentEntries.find(
  (item) => item.href === MODE_HOMES.agent,
) ?? { label: 'New chat', icon: ICONS.newChat, href: MODE_HOMES.agent, scope: 'project' };

export const AGENT_NAV_ITEMS = agentEntries.filter((item) => item !== NEW_CHAT_ITEM);

export const FOOT_NAV_ITEMS = navItems('sidebar:foot');

export const ACCOUNT_MENU_ITEMS = navItems('account');

const SIDEBAR_ITEMS: readonly NavItem[] = [
  ...DASHBOARD_GROUPS.flatMap((entry) => entry.items),
  NEW_CHAT_ITEM,
  ...AGENT_NAV_ITEMS,
  ...FOOT_NAV_ITEMS,
].filter((item, index, all) => all.findIndex((other) => other.href === item.href) === index);

const SIDEBAR_PATHS = SIDEBAR_ITEMS.map(
  (item) => new URL(item.href, 'https://citeladder.local').pathname,
);

const AGENT_HREFS = new Set([NEW_CHAT_ITEM, ...AGENT_NAV_ITEMS].map((item) => item.href));

export function resolveCommandGroups(): readonly {
  title: string;
  items: readonly NavItem[];
}[] {
  const settings = [...FOOT_NAV_ITEMS, ...ACCOUNT_MENU_ITEMS, ...navItems('palette')];
  return [
    ...DASHBOARD_GROUPS.map(({ group, title, items }) => ({
      title,
      items: [
        ...items.filter((item) => !AGENT_HREFS.has(item.href)),
        ...navItems(`palette:${group}`),
      ],
    })),
    { title: 'Agent', items: [NEW_CHAT_ITEM, ...AGENT_NAV_ITEMS] },
    { title: 'Settings', items: settings },
  ];
}

const atOrBelow = (pathname: string, base: string) =>
  pathname === base || pathname.startsWith(`${base}/`);

const ACCOUNT_PATHS = ACCOUNT_MENU_ITEMS.map(
  (item) => new URL(item.href, 'https://citeladder.local').pathname,
);

export function isAccountCurrent(pathname: string, searchParams: URLSearchParams): boolean {
  if (SIDEBAR_ITEMS.some((item) => isNavItemActive(pathname, searchParams, item))) return false;
  return ACCOUNT_PATHS.some((base) => atOrBelow(pathname, base));
}

export function isNavItemActive(
  pathname: string,
  searchParams: URLSearchParams,
  item: Pick<NavItem, 'href'>,
): boolean {
  const target = new URL(item.href, 'https://citeladder.local');
  if (target.pathname === MODE_HOMES.agent) return pathname === MODE_HOMES.agent;
  if (!atOrBelow(pathname, target.pathname)) return false;
  const deeper = SIDEBAR_PATHS.some(
    (path) => path.length > target.pathname.length && atOrBelow(pathname, path),
  );
  if (deeper) return false;
  return [...target.searchParams].every(([key, value]) => searchParams.get(key) === value);
}

export function pageSection(
  pathname: string,
  searchParams: URLSearchParams,
): Readonly<{ title: string }> {
  if (isAgentPath(pathname)) return { title: 'Agent' };
  const group = DASHBOARD_GROUPS.find(({ items }) =>
    items.some((item) => isNavItemActive(pathname, searchParams, item)),
  );
  return { title: group?.title ?? 'Workspace' };
}
