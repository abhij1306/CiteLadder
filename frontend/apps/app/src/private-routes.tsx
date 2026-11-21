import { Suspense, type ReactNode } from 'react';
import { Outlet } from 'react-router-dom';

import { AppScrollRestoration } from '@/components/layout/app-scroll-restoration';
import { AppShell } from '@/components/layout/app-shell';
import { FirstFrame, HeldContent } from '@/components/layout/first-frame';
import { OnboardingGate } from '@/components/layout/onboarding-gate';
import { RouteLoadingScreen } from '@/components/layout/page-shell';
import { UserMenuController } from '@/components/layout/user-menu';
import { ToastProvider } from '@/components/ui/toast';
import { SessionGuard } from '@/lib/auth/session-guard';
import { ProjectProvider } from '@/lib/project/project-context';
import { useEngineCatalog } from '@/lib/providers/engines';

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
  useEngineCatalog();
  return (
    <Suspense fallback={<FirstFrame />}>
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

function sessionFallback(content?: ReactNode) {
  return <FirstFrame>{content}</FirstFrame>;
}

/** Application chrome and its project-route recovery gate. */
export function ApplicationRouteLayout() {
  return (
    <ToastProvider>
      <AppScrollRestoration />
      <AppShell>
        <HeldContent frame={<RouteLoadingScreen />}>
          <OnboardingGate>
            <Outlet />
          </OnboardingGate>
        </HeldContent>
      </AppShell>
    </ToastProvider>
  );
}
