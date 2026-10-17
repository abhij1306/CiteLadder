'use client';

import { Menu } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';

import { AgentPanelHost, AgentPanelTrigger } from '@/components/agent/agent-panel-host';
import { CommandPalette, CommandPaletteTrigger } from '@/components/ui/command-palette';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { LogoMark } from '@/components/ui/logo-mark';
import { TooltipProvider } from '@/components/ui/tooltip';

import { CompactPageTitleContext } from './compact-page-title-context';
import { ProjectSwitcher } from './project-switcher';
import { SidebarNav } from './sidebar-nav';
import { ThemeSwitch } from './theme-switch';
import { UserMenuTrigger } from './user-menu';
import { resolveTitle } from './page-titles';
import { useRouteAnnouncement } from './use-route-announcement';
import { AgentPanelProvider } from '@/lib/agent/panel-context';
import { projectDestination } from '@/lib/navigation/project-destination';
import { useProjectContext } from '@/lib/project/project-context';
import { OPEN_COMMAND_PALETTE_EVENT } from '@/lib/navigation/shell-events';

/**
 * AppShell — the authenticated application chrome.
 *
 * The desktop sidebar remains available for the viewport while the document
 * scrolls. At compact widths, the same destinations move into the drawer.
 */
export function AppShell({ children }: Readonly<{ children: ReactNode }>) {
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [compactTitleOverride, setCompactTitleOverride] = useState<string>();
  const navigationTriggerRef = useRef<HTMLButtonElement>(null);
  const pendingDrawerLaunch = useRef<{ trigger: HTMLElement } | null>(null);
  const location = useLocation();
  const pathname = location.pathname ?? '/projects';
  const { activeProject, activeProjectId } = useProjectContext();
  const overviewHref = activeProjectId
    ? projectDestination('/projects', null, activeProjectId)
    : '/projects';
  const compactTitle = compactTitleOverride ?? resolveTitle(pathname);
  useRouteAnnouncement({
    title: compactTitle,
    projectName: activeProject?.name ?? null,
  });

  // Any navigation, including a project switch from inside the drawer, ends
  // the compact drawer's job. Adjusted during render, not in an effect, so the
  // drawer never paints open on the new location.
  const [drawerLocation, setDrawerLocation] = useState(location.key);
  if (drawerLocation !== location.key) {
    setDrawerLocation(location.key);
    setNavigationOpen(false);
  }

  function openPaletteFromDrawer(trigger: HTMLElement) {
    pendingDrawerLaunch.current = { trigger: navigationTriggerRef.current ?? trigger };
    setNavigationOpen(false);
  }

  function launchAfterNavigationClose() {
    const launch = pendingDrawerLaunch.current;
    pendingDrawerLaunch.current = null;
    if (!launch) return;
    window.dispatchEvent(
      new CustomEvent(OPEN_COMMAND_PALETTE_EVENT, {
        detail: { trigger: launch.trigger },
      }),
    );
  }

  return (
    <CompactPageTitleContext.Provider value={setCompactTitleOverride}>
      <AgentPanelProvider>
        <TooltipProvider>
          <div data-app-surface className="bg-background relative flex min-h-dvh">
            <a href="#main" className="skip-link">
              Skip to main content
            </a>
            {/* The rail starts one sheet inset down, so its rows line up with
                the bands of the floating sheet beside it. */}
            <aside className="shell-rail bg-background sticky top-0 z-1 hidden h-dvh w-[var(--sidebar-width)] shrink-0 flex-col pt-[var(--workspace-inset)] min-[981px]:flex">
              {/* The project selector is the sidebar's first row, at the same
                  height as the header beside it. The rail reads project →
                  tools → destinations → brand: the switcher is the thing a
                  reader changes most, and it sat below a logo that never
                  changes. Identity moves to the foot of the rail, where the
                  account row used to be — the account now lives in the header,
                  so nothing is displaced. */}
              <div className="flex h-[var(--compact-topbar-height)] shrink-0 items-center px-[var(--sidebar-pad-x)]">
                <ProjectSwitcher />
              </div>

              {/* No offset below the switcher. The pane's second row is the band
                  that closes the identity band, which starts the moment the
                  56px switcher row ends — so anything added here would push the
                  search below the row it is meant to line up with. */}
              <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 px-[var(--sidebar-pad-x)] pb-[var(--sidebar-pad-y)]">
                {/* Band-height rows, so the sidebar's second row and the pane's
                    second row are the same band at the same offset. */}
                <CommandPaletteTrigger className="h-[var(--tab-height)] w-full" />
                {/* A scroller clips everything outside its padding box, so this
                    gutter keeps the 1px control edges and 3px focus rings of
                    full-width rows visible; the negative margin keeps alignment. */}
                <div className="-m-1 min-h-0 flex-1 overflow-y-auto p-1">
                  <SidebarNav />
                </div>
              </div>

              <div className="flex shrink-0 items-center justify-between gap-2 p-[var(--sidebar-pad-x)]">
                <Link
                  to={overviewHref}
                  className="focus-ring flex items-center rounded-xs px-3 py-1 transition-opacity hover:opacity-90"
                  aria-label="CiteLadder command center"
                >
                  <LogoMark variant="sidebar" />
                </Link>
              </div>
            </aside>

            <div className="relative z-1 flex min-w-0 flex-1 flex-col">
              {/* Compact only, exactly as before. On desktop the account
                  trigger rides the route's own header row instead, so the shell
                  adds no second bar above the work. */}
              <header className="bg-panel border-border-subtle z-sticky sticky top-0 grid h-[var(--compact-topbar-height)] shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-b px-[var(--content-gutter)] min-[981px]:hidden">
                <div className="flex items-center">
                  <Button
                    variant="ghost"
                    size="icon"
                    ref={navigationTriggerRef}
                    aria-label="Open navigation"
                    onClick={() => setNavigationOpen(true)}
                  >
                    <Menu className="size-4" aria-hidden />
                  </Button>
                </div>
                <div className="type-body min-w-0 truncate">{compactTitle}</div>
                <div className="flex items-center justify-end gap-2 justify-self-end">
                  <AgentPanelTrigger />
                  <ThemeSwitch />
                  <UserMenuTrigger presenter="compact" />
                </div>
              </header>

              <main id="main" tabIndex={-1} className="app-pane app-pane-workspace relative flex-1">
                {/* The account rides the route's own first row rather than a
                    bar of its own, so the shell adds no second row above the
                    work. It is positioned rather than placed in PageShell
                    because the account belongs to the shell: routes render
                    their bands on their own in tests and previews, and coupling
                    every one of them to the account controller would make the
                    page shell unmountable outside this provider.

                    Desktop only — the compact topbar already carries it. The
                    inline-size padding matches the pane's gutter so the glyph
                    lines up with the actions beneath it. */}
                <div className="pointer-events-none absolute inset-x-0 top-0 z-10 hidden h-[var(--page-band-identity)] min-[981px]:block">
                  <div className="mx-auto flex h-full w-full max-w-[var(--content-max-width)] items-center justify-end px-[var(--content-gutter)]">
                    <div className="pointer-events-auto flex items-center gap-1">
                      <AgentPanelTrigger />
                      <ThemeSwitch />
                      <UserMenuTrigger presenter="header" />
                    </div>
                  </div>
                </div>
                {/* No gutter here. The route's own bands carry it, so their rules
                  reach the paper's edges instead of stopping at the margin. */}
                <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-0 pb-[var(--content-gutter)]">
                  <div className="min-w-0">{children}</div>
                </div>
              </main>

              <CommandPalette />
              <AgentPanelHost />
              <Drawer
                open={navigationOpen}
                onOpenChange={setNavigationOpen}
                onAfterClose={launchAfterNavigationClose}
                title="Navigation"
                hideHeader
                closeLabel="Close navigation"
                side="left"
                className="bg-background w-[min(17rem,100vw)] max-w-none border-l-0"
              >
                <div className="grid gap-4">
                  <Link
                    to={overviewHref}
                    className="focus-ring flex items-center rounded-[var(--radius-control)] px-2 py-1"
                    onClick={() => setNavigationOpen(false)}
                    aria-label="CiteLadder command center"
                  >
                    <LogoMark variant="sidebar" />
                  </Link>
                  <ProjectSwitcher />
                  <div className="grid gap-2">
                    <CommandPaletteTrigger className="w-full" onOpen={openPaletteFromDrawer} />
                    <SidebarNav onNavigate={() => setNavigationOpen(false)} />
                  </div>
                </div>
              </Drawer>
            </div>
          </div>
        </TooltipProvider>
      </AgentPanelProvider>
    </CompactPageTitleContext.Provider>
  );
}
