import { lazy, Suspense } from 'react';
import { redirect, type RouteObject } from 'react-router-dom';

import { RouteLoadingScreen } from '@/components/layout/page-shell';
import { ShellFallback } from '@/components/layout/shell-fallback';
import { QueryState } from '@/components/ui/query-state';
import { APP_ROUTES, MODE_HOMES, type AppRouteRecord } from '@/lib/navigation/app-routes';
import { registerRouteChunk } from '@/lib/navigation/route-chunks';
import { bootstrapPrivateRoutes } from '@/lib/project/bootstrap-loader';
import { NotFoundScreen, RouteError, ScreenError } from './route-error';
import { ApplicationRouteLayout, PrivateRouteLayout } from './private-routes';

/**
 * Begin the route download at matching time, alongside session bootstrap, or
 * earlier on navigation intent. The loader never waits for it; Suspense owns
 * only the route content pane. Inside the application shell its fallback is
 * the route's own loading frame (identity band + loading box), not a bare
 * pane; the flow routes outside the shell (sign-in, setup) keep the box alone.
 */
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
      <Suspense fallback={route.shell ? <RouteLoadingScreen /> : <QueryState kind="loading" />}>
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
    // Once per document. In-app navigation is answered by the providers this
    // seeded, which stay mounted and keep their own queries fresh; re-running
    // the whole bootstrap on every route change would put a blocking await in
    // front of every click.
    shouldRevalidate: () => false,
    hydrateFallbackElement: <ShellFallback />,
    ErrorBoundary: RouteError,
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
