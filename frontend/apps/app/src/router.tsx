import { lazy, Suspense } from 'react';
import { redirect, type RouteObject } from 'react-router-dom';

import { RouteLoadingScreen } from '@/components/layout/page-shell';
import { FirstFrame } from '@/components/layout/first-frame';
import { APP_ROUTES } from '@/lib/navigation/app-routes';
import type { AppRouteRecord } from '@/lib/navigation/route-types';
import { registerRouteChunk } from '@/lib/navigation/route-chunks';
import { bootstrapPrivateRoutes } from '@/lib/project/bootstrap-loader';
import { NotFoundScreen } from '@/components/templates/not-found-screen';
import { ScreenError, ShellRouteError } from './route-error';
import { ApplicationRouteLayout, PrivateRouteLayout } from './private-routes';

function manifestRoute(route: AppRouteRecord): RouteObject {
  let module: ReturnType<AppRouteRecord['screen']> | undefined;
  const load = () => (module ??= route.screen());
  registerRouteChunk(route.path, load);
  const Screen = lazy(load);
  return {
    path: route.path,
    loader: () => {
      // React.lazy surfaces any failure through RouteError when the leaf mounts.
      void load().catch(() => {});
      return null;
    },
    element: (
      <Suspense fallback={route.shell ? <RouteLoadingScreen /> : <FirstFrame />}>
        <Screen />
      </Suspense>
    ),
  };
}

const routes: readonly AppRouteRecord[] = APP_ROUTES;

export const appRoutes: RouteObject[] = [
  { path: '/', loader: () => redirect(MODE_HOMES.dashboard) },
  {
    element: <PrivateRouteLayout />,
    // Resolve the local user, workspace and project BEFORE the shell mounts, so
    // a workspace with no projects reaches project creation in one paint instead of watching
    // the application chrome build itself and then be replaced.
    loader: bootstrapPrivateRoutes,
    shouldRevalidate: () => false,
    hydrateFallbackElement: <FirstFrame />,
    ErrorBoundary: ShellRouteError,
    children: [
      ...routes.filter((route) => !route.shell).map(manifestRoute),
      {
        element: <ApplicationRouteLayout />,
        children: [
          {
            // Pathless and element-less: a screen's render error replaces only
            // the screen, so the shell's navigation remains.
            ErrorBoundary: ScreenError,
            children: [
              ...routes.filter((route) => route.shell).map(manifestRoute),
              { path: '*', element: <NotFoundScreen /> },
            ],
          },
        ],
      },
    ],
  },
];
