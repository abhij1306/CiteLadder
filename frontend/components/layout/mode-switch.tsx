'use client';

import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';

import { segmentedItemVariants, segmentedTrackVariants } from '@/components/ui/segmented-variants';
import { scopedNavigationDestination } from '@/lib/navigation/project-destination';
import {
  rememberModeRoute,
  rememberedModeRoute,
  type NavigationMode,
} from '@/lib/navigation/mode-memory';
import { useProjectContext } from '@/lib/project/project-context';
import { cn } from '@/lib/utils';

import { AGENT_HOME, navigationMode } from './nav-items';

const MODES: readonly { mode: NavigationMode; label: string; home: string }[] = [
  { mode: 'dashboard', label: 'Dashboard', home: '/projects' },
  { mode: 'agent', label: 'Agent', home: AGENT_HOME },
];

/**
 * Dashboard | Agent. The active mode is derived from the route, so deep links
 * and back navigation stay correct; each segment returns to the last route
 * used in that mode for the project during this session.
 */
export function ModeSwitch({ onNavigate }: Readonly<{ onNavigate?: () => void }>) {
  const location = useLocation();
  const pathname = location.pathname ?? '';
  const search = location.search ?? '';
  const { activeProjectId, activeWorkspaceId } = useProjectContext();
  const current = navigationMode(pathname);

  useEffect(() => {
    if (activeProjectId) rememberModeRoute(current, activeProjectId, `${pathname}${search}`);
  }, [activeProjectId, current, pathname, search]);

  return (
    <nav aria-label="Mode" className={cn(segmentedTrackVariants(), 'flex w-full')}>
      {MODES.map(({ mode, label, home }) => {
        const selected = mode === current;
        const target = rememberedModeRoute(mode, activeProjectId) ?? home;
        return (
          <Link
            key={mode}
            to={scopedNavigationDestination(target, 'project', activeProjectId, activeWorkspaceId)}
            aria-current={selected ? 'page' : undefined}
            onClick={onNavigate}
            className={cn(segmentedItemVariants({ selected }), 'flex-1')}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
