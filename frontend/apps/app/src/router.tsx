import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { redirect, type RouteObject } from 'react-router-dom';

import { RouteLoadingScreen } from '@/components/layout/page-shell';
import { ShellFallback } from '@/components/layout/shell-fallback';
import { QueryState } from '@/components/ui/query-state';
import { bootstrapPrivateRoutes } from '@/lib/project/bootstrap-loader';
import { NotFoundScreen, RouteError, ScreenError } from './route-error';
import { registerRouteChunk } from '@/lib/navigation/route-chunks';
import { ApplicationRouteLayout, PrivateRouteLayout } from './private-routes';

/**
 * Begin the route download at matching time, alongside session bootstrap, or
 * earlier on navigation intent. The loader never waits for it; Suspense owns
 * only the route content pane. Inside the application shell its fallback is
 * the route's own loading frame (identity band + loading box), not a bare
 * pane; the flow routes outside the shell (sign-in, setup) keep the box alone.
 */
function productRoute(
  path: string,
  importRoute: () => Promise<{ default: ComponentType }>,
  fallback: ReactNode = <QueryState kind="loading" />,
): RouteObject {
  let module: ReturnType<typeof importRoute> | undefined;
  const load = () => (module ??= importRoute());
  registerRouteChunk(path, load);
  const Screen = lazy(load);
  return {
    path,
    loader: () => {
      // React.lazy surfaces any failure through RouteError when the leaf mounts.
      void load().catch(() => {});
      return null;
    },
    element: (
      <Suspense fallback={fallback}>
        <Screen />
      </Suspense>
    ),
  };
}

/** A route drawn inside the application shell, whose wait is its page's loading frame. */
function screenRoute(
  path: string,
  importRoute: () => Promise<{ default: ComponentType }>,
): RouteObject {
  return productRoute(path, importRoute, <RouteLoadingScreen />);
}

/** Screens rendered inside the application shell. */
const screenRoutes: RouteObject[] = [
  screenRoute('/projects', () =>
    import('@/components/projects/projects-screen').then(({ ProjectsScreen }) => ({
      default: ProjectsScreen,
    })),
  ),
  screenRoute('/site', () =>
    import('./product-routes-site-issues').then(({ WebsiteRoute }) => ({
      default: WebsiteRoute,
    })),
  ),
  screenRoute('/site/crawls/:crawlId/pages/:siteUrlId', () =>
    import('./product-routes-site-issues').then(({ WebsitePageDetailRoute }) => ({
      default: WebsitePageDetailRoute,
    })),
  ),
  screenRoute('/issues', () =>
    import('./product-routes-site-issues').then(({ IssuesRoute }) => ({
      default: IssuesRoute,
    })),
  ),
  screenRoute('/demand', () =>
    import('./product-routes-demand-performance').then(({ DemandRoute }) => ({
      default: DemandRoute,
    })),
  ),
  screenRoute('/search-intelligence', () =>
    import('./product-routes-demand-performance').then(({ SearchIntelligenceRoute }) => ({
      default: SearchIntelligenceRoute,
    })),
  ),
  screenRoute('/performance', () =>
    import('./product-routes-demand-performance').then(({ PerformanceRoute }) => ({
      default: PerformanceRoute,
    })),
  ),
  screenRoute('/agent', () =>
    import('./product-routes-agent').then(({ NewChatRouteElement }) => ({
      default: NewChatRouteElement,
    })),
  ),
  screenRoute('/agent/chats/:chatId', () =>
    import('./product-routes-agent').then(({ ChatRouteElement }) => ({
      default: ChatRouteElement,
    })),
  ),
  screenRoute('/agent/actions', () =>
    import('./product-routes-agent').then(({ ActionsRouteElement }) => ({
      default: ActionsRouteElement,
    })),
  ),
  screenRoute('/agent/actions/:actionId', () =>
    import('./product-routes-agent').then(({ ActionDetailRouteElement }) => ({
      default: ActionDetailRouteElement,
    })),
  ),
  screenRoute('/agent/skills', () =>
    import('./product-routes-agent').then(({ SkillsRouteElement }) => ({
      default: SkillsRouteElement,
    })),
  ),
  screenRoute('/agent/context', () =>
    import('./product-routes-agent').then(({ ContextRouteElement }) => ({
      default: ContextRouteElement,
    })),
  ),
  screenRoute('/visibility', () =>
    import('./product-routes-visibility-runs').then(({ VisibilityRouteElement }) => ({
      default: VisibilityRouteElement,
    })),
  ),
  screenRoute('/runs', () =>
    import('./product-routes-visibility-runs').then(({ RunsRouteElement }) => ({
      default: RunsRouteElement,
    })),
  ),
  screenRoute('/runs/:runId', () =>
    import('./product-routes-visibility-runs').then(({ RunDetailRouteElement }) => ({
      default: RunDetailRouteElement,
    })),
  ),
  screenRoute('/prompts', () =>
    import('./product-routes-prompts-commerce-traffic').then(({ PromptsRouteElement }) => ({
      default: PromptsRouteElement,
    })),
  ),
  screenRoute('/prompts/:promptId', () =>
    import('./product-routes-prompts-commerce-traffic').then(({ PromptDetailRouteElement }) => ({
      default: PromptDetailRouteElement,
    })),
  ),
  screenRoute('/products', () =>
    import('./product-routes-prompts-commerce-traffic').then(({ ProductsRouteElement }) => ({
      default: ProductsRouteElement,
    })),
  ),
  screenRoute('/ai-traffic', () =>
    import('./product-routes-prompts-commerce-traffic').then(({ AiTrafficRouteElement }) => ({
      default: AiTrafficRouteElement,
    })),
  ),
  screenRoute('/settings', () =>
    import('./product-routes-settings').then(({ SettingsRouteElement }) => ({
      default: SettingsRouteElement,
    })),
  ),
  { path: '*', element: <NotFoundScreen /> },
];

export const appRoutes: RouteObject[] = [
  { path: '/', loader: () => redirect('/projects') },
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
      productRoute('/onboarding', () =>
        import('@/components/onboarding/onboarding-page-client').then(
          ({ OnboardingPageClient }) => ({
            default: OnboardingPageClient,
          }),
        ),
      ),
      {
        element: <ApplicationRouteLayout />,
        children: [
          {
            // Pathless and element-less: a screen's render error replaces only
            // the screen, so the shell's navigation remains.
            ErrorBoundary: ScreenError,
            children: screenRoutes,
          },
        ],
      },
    ],
  },
];
