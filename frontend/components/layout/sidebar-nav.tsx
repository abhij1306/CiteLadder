import { useLocation, useSearchParams } from 'react-router-dom';
import { lazy, Suspense } from 'react';

import { SidebarNavGroup } from '@/components/ui/app-shell';
import { navigationMode } from '@/lib/navigation/app-routes';
import { useRouteIntent } from '@/lib/navigation/use-route-intent';
import { scopedNavigationDestination } from '@/lib/navigation/project-destination';
import { useProjectContext } from '@/lib/project/project-context';

import { NavLink } from './nav-link';
import { isNavItemActive, NAV_GROUPS, SETUP_NAV_ITEMS, type NavItem } from './nav-items';

// Agent mode reads chats and Actions; its API modules stay out of the chunk
// the shell needs before it can paint.
const AgentNav = lazy(() =>
  import('@/components/agent/agent-nav').then(({ AgentNav }) => ({ default: AgentNav })),
);

/** One group's destinations, scoped to the active project or workspace. */
export function StationLinks({ items }: Readonly<{ items: readonly NavItem[] }>) {
  const pathname = useLocation().pathname ?? '';
  const searchParams = useSearchParams()[0];
  const { activeProjectId, activeWorkspaceId } = useProjectContext();
  const onIntent = useRouteIntent();
  return items.map((item) => (
    <li key={item.href}>
      <NavLink
        item={{
          ...item,
          href: scopedNavigationDestination(
            item.href,
            item.scope,
            activeProjectId,
            activeWorkspaceId,
          ),
        }}
        active={isNavItemActive(pathname, searchParams, item)}
        onIntent={onIntent}
      />
    </li>
  ));
}

/**
 * The sidebar's destinations: Dashboard's groups in the order of the product
 * loop, or Agent mode's (the mode comes from the route).
 */
export function SidebarNav() {
  const pathname = useLocation().pathname ?? '';
  if (navigationMode(pathname) === 'agent') {
    return (
      <Suspense fallback={null}>
        <AgentNav />
      </Suspense>
    );
  }
  return (
    <nav aria-label="Primary" className="contents">
      {NAV_GROUPS.map((group) => (
        <SidebarNavGroup key={group.title ?? 'overview'} title={group.title}>
          <StationLinks items={group.items} />
        </SidebarNavGroup>
      ))}
      <SidebarNavGroup>
        <StationLinks items={SETUP_NAV_ITEMS} />
      </SidebarNavGroup>
    </nav>
  );
}
