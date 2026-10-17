'use client';

import { useLocation, useSearchParams } from 'react-router-dom';
import { lazy, Suspense } from 'react';

import { cn } from '@/lib/utils';
import { useRouteIntent } from '@/lib/navigation/use-route-intent';
import { scopedNavigationDestination } from '@/lib/navigation/project-destination';
import { useProjectContext } from '@/lib/project/project-context';

import { ModeSwitch } from './mode-switch';
import { NavLink } from './nav-link';
import {
  isNavItemActive,
  NAV_GROUPS,
  navigationMode,
  SETUP_NAV_ITEMS,
  type NavItem,
} from './nav-items';

// Agent mode reads chats and Actions; its API modules stay out of the chunk
// the shell needs before it can paint.
const AgentNav = lazy(() => import('./agent-nav').then(({ AgentNav }) => ({ default: AgentNav })));

function StationLinks({
  items,
  onNavigate,
}: Readonly<{ items: readonly NavItem[]; onNavigate?: () => void }>) {
  const pathname = useLocation().pathname ?? '';
  const searchParams = useSearchParams()[0];
  const { activeProjectId, activeWorkspaceId } = useProjectContext();
  const onIntent = useRouteIntent();
  return (
    <ul className="flex flex-col gap-[var(--sidebar-item-gap)]">
      {items.map((item) => {
        const href = scopedNavigationDestination(
          item.href,
          item.scope ?? 'project',
          activeProjectId,
          activeWorkspaceId,
        );
        return (
          <li key={item.href}>
            <NavLink
              item={{ ...item, href }}
              active={isNavItemActive(pathname, searchParams, item)}
              onIntent={onIntent}
              onNavigate={onNavigate}
            />
          </li>
        );
      })}
    </ul>
  );
}

export function SidebarNav({
  className,
  onNavigate,
}: Readonly<{ className?: string; onNavigate?: () => void }>) {
  const pathname = useLocation().pathname ?? '';
  const agentMode = navigationMode(pathname) === 'agent';
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <ModeSwitch onNavigate={onNavigate} />
      {agentMode ? (
        <Suspense fallback={null}>
          <AgentNav onNavigate={onNavigate} />
        </Suspense>
      ) : (
        <DashboardNav onNavigate={onNavigate} />
      )}
    </div>
  );
}

function DashboardNav({ onNavigate }: Readonly<{ onNavigate?: () => void }>) {
  return (
    <nav aria-label="Primary" className="flex flex-col gap-[var(--sidebar-group-gap)]">
      {NAV_GROUPS.map((group) => (
        <div key={group.title ?? 'overview'} className="flex flex-col gap-0">
          {group.title ? (
            <p className="type-caption text-muted px-3 pt-4 pb-2">{group.title}</p>
          ) : null}
          <StationLinks items={group.items} onNavigate={onNavigate} />
        </div>
      ))}
      <div className="pt-4">
        <StationLinks items={SETUP_NAV_ITEMS} onNavigate={onNavigate} />
      </div>
    </nav>
  );
}
