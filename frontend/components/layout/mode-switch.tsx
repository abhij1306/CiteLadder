import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';

import { SidebarRowTooltip } from '@/components/ui/app-shell';
import { MODE_TRACK, modeSegmentClasses } from '@/components/ui/tabs';
import { ICONS } from '@/lib/icons';
import { MODE_HOMES, navigationMode } from '@/lib/navigation/app-routes';
import { scopedNavigationDestination } from '@/lib/navigation/project-destination';
import {
  rememberModeRoute,
  rememberedModeRoute,
  type NavigationMode,
} from '@/lib/navigation/mode-memory';
import { useProjectContext } from '@/lib/project/project-context';

const MODES: readonly { mode: NavigationMode; label: string; icon: LucideIcon }[] = [
  { mode: 'dashboard', label: 'Dashboard', icon: ICONS.overview },
  { mode: 'agent', label: 'Agent', icon: ICONS.agent },
];

/**
 * Dashboard | Agent: the shared tab track stretched to two equal segments,
 * stacked as two icon segments in the rail. The active mode is derived from
 * the route, so deep links and back navigation stay correct; each segment
 * returns to the last route used in that mode for the project during this
 * session.
 */
export function ModeSwitch() {
  const location = useLocation();
  const pathname = location.pathname ?? '';
  const search = location.search ?? '';
  const { activeProjectId, activeWorkspaceId } = useProjectContext();
  const current = navigationMode(pathname);

  useEffect(() => {
    if (activeProjectId) rememberModeRoute(current, activeProjectId, `${pathname}${search}`);
  }, [activeProjectId, current, pathname, search]);

  return (
    <nav aria-label="Mode" data-segmented-track="" className={MODE_TRACK}>
      {MODES.map(({ mode, label, icon: Icon }) => {
        const selected = mode === current;
        const target = rememberedModeRoute(mode, activeProjectId) ?? MODE_HOMES[mode];
        return (
          <SidebarRowTooltip key={mode} label={label}>
            <Link
              to={scopedNavigationDestination(
                target,
                'project',
                activeProjectId,
                activeWorkspaceId,
              )}
              aria-current={selected ? 'page' : undefined}
              className={modeSegmentClasses(selected)}
            >
              <Icon className="labelled:hidden size-4" aria-hidden />
              <span className="labelled:not-sr-only sr-only">{label}</span>
            </Link>
          </SidebarRowTooltip>
        );
      })}
    </nav>
  );
}
