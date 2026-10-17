import { Suspense, type ReactNode } from 'react';
import { Outlet, ScrollRestoration } from 'react-router-dom';

import { AppShell } from '@/components/layout/app-shell';
import { OnboardingGate } from '@/components/layout/onboarding-gate';
import { ShellFallback } from '@/components/layout/shell-fallback';
import { UserMenuController } from '@/components/layout/user-menu';
import { ToastProvider } from '@/components/ui/toast';
import { SessionGuard } from '@/lib/auth/session-guard';
import { ProjectProvider } from '@/lib/project/project-context';

/**
 * Application route root.
 *
 * Project context starts before the local-user guard so its workspace
 * bootstrap runs in parallel with `me`, while the guard remains the only place
 * that decides whether the application may render.
 *
 * The user menu controller sits here rather than in `AppShell` because
 * `/onboarding` is a sibling of `ApplicationRouteLayout` and also shows the
 * menu. Every trigger still chooses its own presenter; this only decides where
 * the state lives.
 */
export function PrivateRouteLayout() {
  return (
    <Suspense fallback={<ShellFallback />}>
      <ProjectProvider>
        <SessionGuard fallback={sessionFallback}>
          <UserMenuController>
            <Outlet />
          </UserMenuController>
        </SessionGuard>
      </ProjectProvider>
    </Suspense>
  );
}

function sessionFallback(content: ReactNode) {
  return <ShellFallback>{content}</ShellFallback>;
}

/** Application chrome and its project-route recovery gate. */
export function ApplicationRouteLayout() {
  return (
    <ToastProvider>
      {/* The document scrolls, so a new screen starts at the top; returning to
          a screen restores where it was. A tab or filter change keeps the
          position because the key is the path alone. */}
      <ScrollRestoration getKey={(location) => location.pathname} />
      <AppShell>
        <OnboardingGate>
          <Outlet />
        </OnboardingGate>
      </AppShell>
    </ToastProvider>
  );
}
