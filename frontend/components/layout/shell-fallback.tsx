import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';

import { Stack } from '@/components/ui/layout';
import { QueryState } from '@/components/ui/query-state';

import { RouteLoadingScreen } from './page-shell';
import { hasPageTitle } from './page-titles';

/**
 * The placeholder shown while the SESSION and the shell's opening decision are
 * still resolving — before the app knows whether this visitor is signed in at
 * all, so before any chrome can be drawn.
 *
 * It intentionally contains geometry only: before session identity resolves,
 * navigation, project names, account controls, and capability claims would all
 * be private or misleading.
 *
 * The geometry it does draw is the shell's own, down to the rail. This is the
 * ONE frame a cold load now shows before its destination, so anything it gets
 * wrong is a visible jump rather than a detail: the sidebar column reserves the
 * same width `AppShell` gives it, and the content column is a real `.app-pane`,
 * so the rail/ground split does not appear a paint later than the layout does.
 *
 * Inside the pane it draws the destination page's own loading frame — the
 * identity band named from the path (a route title, never private data) and
 * the loading box where the content begins — so when the shell opens around
 * it, only the rail fills in; the page does not jump from a bare box at the
 * pane's edge to a header with a box under it.
 */
export function ShellFallback({ children }: Readonly<{ children?: ReactNode }>) {
  return (
    <div
      className="bg-background flex min-h-dvh"
      aria-busy={children === undefined ? 'true' : undefined}
    >
      {/* Match the settled shell's rail fill before session identity resolves. */}
      <div className="bg-background desktop:block hidden w-[var(--sidebar-width)] shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="desktop:hidden h-[var(--compact-topbar-height)] shrink-0" />
        <div className="app-pane app-pane-workspace flex min-w-0 flex-1 flex-col">
          {children === undefined ? <DestinationLoading /> : children}
        </div>
      </div>
    </div>
  );
}

const WORKSPACE_LOADING = 'Loading your workspace…';

/** A shell page's loading frame; a path the shell has no page for keeps the box alone. */
function DestinationLoading() {
  const { pathname } = useLocation();
  return hasPageTitle(pathname ?? '') ? (
    <div className="min-w-0">
      <RouteLoadingScreen label={WORKSPACE_LOADING} />
    </div>
  ) : (
    <QueryState kind="loading" label={WORKSPACE_LOADING} />
  );
}

/**
 * GateScreen — a page the app shows instead of the workspace, in the
 * fallback frame, before the shell can open: the Terms review, a workspace
 * whose access ended. One narrow column (the form measure), its parts 16
 * apart, centred in the pane and inset by the content gutter. The caller
 * passes the content; the page owns every number.
 */
export function GateScreen({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <ShellFallback>
      <Stack
        as="main"
        id="main"
        gap="workspace"
        className="mx-auto w-full max-w-xl content-center p-[var(--content-gutter)]"
      >
        {children}
      </Stack>
    </ShellFallback>
  );
}
