import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';

import { AppShellPlaceholder } from '@/components/ui/app-shell';
import { Stack } from '@/components/ui/layout';
import { QueryState } from '@/components/ui/query-state';

import { RouteLoadingScreen } from './page-shell';
import { hasPageTitle } from '@/lib/navigation/app-routes';

/**
 * The placeholder shown while the SESSION and the shell's opening decision are
 * still resolving — before the app knows whether this visitor is signed in at
 * all, so before any chrome can be drawn.
 *
 * It intentionally contains geometry only: before session identity resolves,
 * navigation, project names, account controls, and capability claims would all
 * be private or misleading.
 *
 * The geometry it does draw is the shell's own (`AppShellPlaceholder`): the
 * sidebar's column at the width `AppShell` gives it and the page inset where
 * the settled shell puts it. Inside it draws the destination page's own
 * loading frame — the header named from the path (a route title, never
 * private data) and the loading box where the content begins — so when the
 * shell opens around it, only the sidebar fills in.
 */
export function ShellFallback({ children }: Readonly<{ children?: ReactNode }>) {
  return (
    <AppShellPlaceholder busy={children === undefined}>
      {children === undefined ? <DestinationLoading /> : children}
    </AppShellPlaceholder>
  );
}

const WORKSPACE_LOADING = 'Loading your workspace…';

/** A shell page's loading frame; a path the shell has no page for keeps the box alone. */
function DestinationLoading() {
  const { pathname } = useLocation();
  return hasPageTitle(pathname ?? '') ? (
    <RouteLoadingScreen label={WORKSPACE_LOADING} />
  ) : (
    <QueryState kind="loading" label={WORKSPACE_LOADING} />
  );
}

/**
 * GateScreen — a page the app shows instead of the workspace, in the
 * fallback frame, before the shell can open: a workspace whose access ended.
 * One narrow column (`container-narrow`), its parts 16 apart, centred in the
 * page. The caller passes the content; the page owns every number.
 */
export function GateScreen({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <ShellFallback>
      <Stack as="main" id="main" gap="workspace" className="max-w-narrow mx-auto w-full">
        {children}
      </Stack>
    </ShellFallback>
  );
}
