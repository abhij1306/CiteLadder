import { useLocation, useSearchParams } from 'react-router-dom';

import { SidebarNavGroup, SidebarScrollList } from '@/components/ui/sidebar';
import { scopedNavigationDestination } from '@/lib/navigation/project-destination';
import { setGroupFolded, useGroupFolded } from '@/lib/navigation/sidebar-folds';
import { useRouteIntent } from '@/lib/navigation/use-route-intent';
import { useProjectContext } from '@/lib/project/project-context';

import { NavLink } from './nav-link';
import {
  DASHBOARD_GROUPS,
  FOOT_NAV_ITEMS,
  isNavItemActive,
  type NavGroup,
  type NavItem,
} from './nav-items';
import { RailGroupMenu, RailLink } from './sidebar-rail';

export function useDestinations() {
  const { pathname = '', search = '' } = useLocation();
  const searchParams = useSearchParams()[0];
  const { activeProjectId, activeWorkspaceId } = useProjectContext();
  const isActive = (item: Pick<NavItem, 'href'>) => isNavItemActive(pathname, searchParams, item);
  const href = (item: NavItem) =>
    scopedNavigationDestination(item.href, item.scope, activeProjectId, activeWorkspaceId);
  return { isActive, href, location: `${pathname}${search}` };
}

export function DestinationRows({ items }: Readonly<{ items: readonly NavItem[] }>) {
  const { isActive, href } = useDestinations();
  const onIntent = useRouteIntent();
  return items.map((item) => (
    <li key={item.href}>
      <NavLink item={{ ...item, href: href(item) }} active={isActive(item)} onIntent={onIntent} />
    </li>
  ));
}

function FoldingGroup({ group }: Readonly<{ group: NavGroup }>) {
  const folded = useGroupFolded(group.group);
  const { isActive } = useDestinations();
  const rows = folded ? group.items.filter(isActive) : group.items;
  return (
    <SidebarNavGroup
      title={group.title}
      expanded={!folded}
      onToggle={() => setGroupFolded(group.group, !folded)}
    >
      <DestinationRows items={rows} />
    </SidebarNavGroup>
  );
}

export function DashboardNav() {
  const { location } = useDestinations();
  return (
    <SidebarScrollList label="Dashboard" revealKey={location}>
      {DASHBOARD_GROUPS.map((group) => (
        <FoldingGroup key={group.group} group={group} />
      ))}
    </SidebarScrollList>
  );
}

export function DashboardRail() {
  const { isActive, href } = useDestinations();
  return DASHBOARD_GROUPS.map((group) => (
    <li key={group.group}>
      <RailGroupMenu
        label={group.title}
        icon={group.icon}
        current={group.items.some(isActive)}
        items={group.items.map((item) => ({ ...item, href: href(item), active: isActive(item) }))}
      />
    </li>
  ));
}

export function SidebarFootNav({ rail }: Readonly<{ rail: boolean }>) {
  const { isActive, href } = useDestinations();
  return (
    <nav aria-label="Workspace">
      <ul className={rail ? 'flex flex-col items-center' : 'flex flex-col gap-0.5'}>
        {rail ? (
          FOOT_NAV_ITEMS.map((item) => (
            <li key={item.href}>
              <RailLink item={{ ...item, href: href(item) }} active={isActive(item)} />
            </li>
          ))
        ) : (
          <DestinationRows items={FOOT_NAV_ITEMS} />
        )}
      </ul>
    </nav>
  );
}
