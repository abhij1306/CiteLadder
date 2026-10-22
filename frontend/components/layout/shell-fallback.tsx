import type { ReactNode } from 'react';

import { Stack } from '@/components/ui/layout';
import { QueryState } from '@/components/ui/query-state';

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
          {children === undefined ? (
            <QueryState kind="loading" label="Loading your workspace…" />
          ) : (
            children
          )}
        </div>
      </div>
    </div>
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
