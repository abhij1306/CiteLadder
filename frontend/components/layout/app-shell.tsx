'use client';

import { useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';

import { AgentPanelHost } from '@/components/agent/agent-panel-host';
import { AppShellFrame, SidebarFrame } from '@/components/ui/app-shell';
import { CommandPalette, CommandPaletteTrigger } from '@/components/ui/command-palette';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AgentPanelProvider } from '@/lib/agent/panel-context';
import { useProjectContext } from '@/lib/project/project-context';

import { ModeSwitch } from './mode-switch';
import { PageTitleContext } from './page-title-context';
import { resolveTitle } from './page-titles';
import { ProjectSwitcher } from './project-switcher';
import { SidebarNav } from './sidebar-nav';
import { UserMenuTrigger } from './user-menu';
import { useRouteAnnouncement } from './use-route-announcement';

/**
 * AppShell — the authenticated application chrome: the system's AppSidebar
 * (project switcher, Dashboard | Agent, destinations, account; no logo, per
 * decision D11) beside the page on `paper`. Below 1280px the sidebar is the
 * 57px icon rail (decision D3); there is no top bar.
 */
export function AppShell({ children }: Readonly<{ children: ReactNode }>) {
  const [titleOverride, setTitleOverride] = useState<string>();
  const pathname = useLocation().pathname ?? '/projects';
  const { activeProject } = useProjectContext();
  useRouteAnnouncement({
    title: titleOverride ?? resolveTitle(pathname),
    projectName: activeProject?.name ?? null,
  });

  return (
    <PageTitleContext.Provider value={setTitleOverride}>
      <AgentPanelProvider>
        <TooltipProvider>
          <AppShellFrame sidebar={<AppSidebar />}>{children}</AppShellFrame>
          <CommandPalette />
          <AgentPanelHost />
        </TooltipProvider>
      </AgentPanelProvider>
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
          <CommandPaletteTrigger className="shell:flex hidden" />
        </>
      }
      nav={<SidebarNav />}
      foot={<UserMenuTrigger presenter="sidebar" />}
    />
  );
}
