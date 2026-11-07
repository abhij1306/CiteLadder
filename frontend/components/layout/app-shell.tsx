'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';

import { AgentPanelHost, AgentPanelTrigger } from '@/components/agent/agent-panel-host';
import { AppShellFrame, NavDrawer, SidebarFrame } from '@/components/ui/app-shell';
import { CommandPalette, CommandPaletteTrigger } from '@/components/ui/command-palette';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AgentPanelProvider } from '@/lib/agent/panel-context';
import { resolveTitle } from '@/lib/navigation/app-routes';
import { useProjectContext } from '@/lib/project/project-context';

import { ModeSwitch } from './mode-switch';
import { resolveCommandGroups } from './nav-items';
import { PageTitleContext } from './page-title-context';
import { ProjectSwitcher } from './project-switcher';
import { ShellContext } from './shell-context';
import { SidebarNav } from './sidebar-nav';
import { UserMenuTrigger } from './user-menu';
import { useRouteAnnouncement } from './use-route-announcement';

/**
 * AppShell — the authenticated application chrome: the system's AppSidebar
 * (project switcher, Dashboard | Agent, destinations, account; no logo, per
 * decision D11) beside the page on `paper`. From 900px to 1280px the sidebar
 * is the icon rail (decision D3); below 900px the page header's menu button
 * opens the same sidebar, labelled, in a left drawer that closes when the
 * route changes (owner, 2026-11-06). There is no top bar.
 */
export function AppShell({ children }: Readonly<{ children: ReactNode }>) {
  const [titleOverride, setTitleOverride] = useState<string>();
  const location = useLocation();
  const pathname = location.pathname ?? '/projects';
  const { activeProject } = useProjectContext();
  useRouteAnnouncement({
    title: titleOverride ?? resolveTitle(pathname),
    projectName: activeProject?.name ?? null,
  });
  // The drawer is open for the location it was opened on, so any navigation
  // (a destination, the project switcher, the mode switch) closes it.
  const [drawerLocation, setDrawerLocation] = useState<string | null>(null);
  const drawerOpen = drawerLocation === location.key;
  const shell = useMemo(
    () => ({
      navDrawer: { open: drawerOpen, onOpen: () => setDrawerLocation(location.key) },
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
              <AppSidebar />
            </NavDrawer>
            <CommandPalette destinations={resolveCommandGroups} />
            <AgentPanelHost />
          </TooltipProvider>
        </AgentPanelProvider>
      </ShellContext.Provider>
    </PageTitleContext.Provider>
  );
}

function AppSidebar() {
  return (
    <SidebarFrame
      ident={<ProjectSwitcher />}
      controls={
        <>
          <ModeSwitch />
          {/* ⌘K opens the palette at every width; the field shows beside labels only. */}
          <CommandPaletteTrigger className="labelled:flex hidden" />
        </>
      }
      nav={<SidebarNav />}
      foot={<UserMenuTrigger presenter="sidebar" />}
    />
  );
}
