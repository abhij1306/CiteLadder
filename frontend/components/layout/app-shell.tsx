import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';

import { AgentNav, AgentRail } from '@/components/agent/agent-nav';
import { AgentPanelHost, AgentPanelTrigger } from '@/components/agent/agent-panel-host';
import { AppShellFrame, NavDrawer } from '@/components/ui/app-shell';
import {
  CommandPaletteHost,
  CommandPaletteTrigger,
} from '@/components/ui/command-palette-launcher';
import { SidebarFrame, SidebarRailList } from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Tooltip, TooltipProvider } from '@/components/ui/tooltip';
import { Settings } from '@/lib/icons';
import { AgentPanelProvider } from '@/lib/agent/panel-context';
import { navigationMode, resolveTitle } from '@/lib/navigation/app-routes';
import { scopedNavigationDestination } from '@/lib/navigation/project-destination';
import { useProjectContext } from '@/lib/project/project-context';
import { setSidebarCollapsed, useSidebarCollapsed } from '@/lib/sidebar-width';

import { ModeSwitch } from './mode-switch';
import { resolveCommandGroups } from './nav-items';
import { PageTitleContext } from './page-title-context';
import { ProjectSwitcher } from './project-switcher';
import { ShellContext } from './shell-context';
import { DashboardNav, DashboardRail, SidebarFootNav } from './sidebar-nav';
import { UserMenuTrigger } from './user-menu';
import { useRouteAnnouncement } from './use-route-announcement';

export function AppShell({ children }: Readonly<{ children: ReactNode }>) {
  const [titleOverride, setTitleOverride] = useState<string>();
  const location = useLocation();
  const pathname = location.pathname ?? '/projects';
  const { activeProject } = useProjectContext();
  useRouteAnnouncement({
    title: titleOverride ?? resolveTitle(pathname),
    projectName: activeProject?.name ?? null,
  });
  useCollapseShortcut();
  const [drawerLocation, setDrawerLocation] = useState<string | null>(null);
  const drawerOpen = drawerLocation === location.key;
  const shell = useMemo(
    () => ({
      navDrawer: { open: drawerOpen, onOpen: () => setDrawerLocation(location.key) },
      searchTrigger: <CommandPaletteTrigger />,
      agentTrigger: <AgentPanelTrigger />,
    }),
    [drawerOpen, location.key],
  );

  return (
    <PageTitleContext.Provider value={setTitleOverride}>
      <ShellContext.Provider value={shell}>
        <AgentPanelProvider>
          <TooltipProvider>
            <AppShellFrame sidebar={<AppSidebar />}>{children}</AppShellFrame>
            <NavDrawer
              open={drawerOpen}
              onOpenChange={(open) => setDrawerLocation(open ? location.key : null)}
            >
              <AppSidebar inDrawer />
            </NavDrawer>
            <CommandPaletteHost destinations={resolveCommandGroups} />
            <AgentPanelHost />
          </TooltipProvider>
        </AgentPanelProvider>
      </ShellContext.Provider>
    </PageTitleContext.Provider>
  );
}

function AppSidebar({ inDrawer = false }: Readonly<{ inDrawer?: boolean }>) {
  const collapsed = useSidebarCollapsed();
  const rail = collapsed && !inDrawer;
  const mode = navigationMode(useLocation().pathname ?? '');
  let nav = mode === 'agent' ? <AgentNav /> : <DashboardNav />;
  if (rail)
    nav = (
      <SidebarRailList label={mode === 'agent' ? 'Agent' : 'Dashboard'}>
        {mode === 'agent' ? <AgentRail /> : <DashboardRail />}
      </SidebarRailList>
    );
  return (
    <SidebarFrame
      ident={
        <>
          <div className="min-w-0 flex-1">
            <ProjectSwitcher />
          </div>
          {rail ? null : <SettingsLink />}
        </>
      }
      mode={<ModeSwitch rail={rail} />}
      nav={nav}
      foot={<SidebarFootNav rail={rail} />}
      account={
        <div className="labelled:items-stretch flex min-w-0 flex-col items-center">
          <UserMenuTrigger presenter={inDrawer ? 'drawer' : 'sidebar'} />
        </div>
      }
    />
  );
}

function SettingsLink() {
  const { activeProjectId, activeWorkspaceId } = useProjectContext();
  const to = scopedNavigationDestination(
    '/settings',
    'workspace',
    activeProjectId,
    activeWorkspaceId,
  );
  return (
    <Tooltip content="Settings" describe={false}>
      <Button variant="quiet" asChild className="w-[var(--control-md)] shrink-0 gap-0 px-0">
        <Link to={to} aria-label="Settings">
          <Icon icon={Settings} />
        </Link>
      </Button>
    </Tooltip>
  );
}

function useCollapseShortcut() {
  const collapsed = useSidebarCollapsed();
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.key !== '\\') return;
      event.preventDefault();
      setSidebarCollapsed(!collapsed);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [collapsed]);
}
