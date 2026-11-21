import { QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { MemoryRouter, type MemoryRouterProps } from 'react-router-dom';
import { vi } from 'vite-plus/test';

import { UserMenuController } from '@/components/layout/user-menu';
import { TooltipProvider } from '@/components/ui/tooltip';
import { createAppQueryClient } from '@/lib/api/query-client';
import { queryKeys } from '@/lib/api/query-keys';
import { providerCatalogFixture } from './provider-catalog-fixture';
import type { Workspace } from '@citeladder/contracts';
import { roles } from '@/services/api/src/config/workspaces.json';
import { SessionProvider } from '@/lib/auth/session-guard';
import { ActiveProjectScopeProvider } from '@/lib/project/active-project-scope';
import {
  ProjectSelectionProvider,
  useProjectContext,
  type ProjectContextValue,
} from '@/lib/project/project-scope';

const TEST_WORKSPACE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

/**
 * The local user every application route mounts inside.
 *
 * `PrivateRouteLayout` publishes this above every screen, so a screen that
 * places an account trigger — onboarding does, in its flow bar — works in the
 * app and would throw under a harness that omitted it. Same reasoning as
 * `TooltipProvider` and the project selection below.
 */
const TEST_SESSION = {
  user: {
    id: '00000000-0000-4000-8000-000000000001',
    email: 'test.user@example.test',
    role: 'user' as const,
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
};

export type TestRole = keyof typeof roles;

export function testWorkspace(role: TestRole): Workspace {
  return {
    id: TEST_WORKSPACE_ID,
    name: 'Test Workspace',
    role,
    capabilities: [...roles[role]],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

export function selectionAs(role: TestRole): Partial<ProjectContextValue> {
  const workspace = testWorkspace(role);
  return { workspaces: [workspace], activeWorkspace: workspace };
}

export function testProjectSelection(
  overrides: Partial<ProjectContextValue> = {},
): ProjectContextValue {
  const workspace = testWorkspace('owner');
  return {
    workspaces: [workspace],
    activeWorkspaceId: TEST_WORKSPACE_ID,
    activeWorkspace: workspace,
    setActiveWorkspaceId: vi.fn(),
    projects: [],
    projectsSettled: true,
    activeProject: null,
    activeProjectId: null,
    setActiveProjectId: vi.fn(),
    status: 'empty',
    errorScope: null,
    retry: vi.fn(),
    isLoading: false,
    isError: false,
    ...overrides,
  };
}

export function ResolvedProjectRoute({ children }: Readonly<{ children: ReactNode }>) {
  const { activeProject } = useProjectContext();
  if (!activeProject) return null;
  return (
    <ActiveProjectScopeProvider project={activeProject}>{children}</ActiveProjectScopeProvider>
  );
}

export function testQueryClient() {
  const queryClient = createAppQueryClient();
  queryClient.setQueryData(queryKeys.providers.catalog(), providerCatalogFixture);
  return queryClient;
}

type ProvidersOptions = Omit<RenderOptions, 'wrapper'> & {
  /**
   * Override the resolved workspace/project context for this render, or pass
   * `null` to render with NO provider at all — a route that mounts
   * outside the project shell. Reach for `null` whenever a
   * component renders on both sides of that boundary: the default context is
   * what would otherwise hide a consumer that cannot survive without one.
   */
  projectSelection?: Partial<ProjectContextValue> | null;
  initialEntries?: MemoryRouterProps['initialEntries'];
};

/**
 * Render a component inside a fresh TanStack Query provider. A new
 * client per render keeps cache state isolated between tests, and the shared
 * factory means the real retry policy applies.
 *
 * A TooltipProvider is included because every app route mounts one — without
 * it a component that renders a Tooltip throws under test but works in the
 * app, which is a failure mode of the harness rather than the component. The
 * workspace/project selection is included for the same reason.
 *
 * The selection comes from `project-scope`, which is the module the real
 * provider publishes through — so a test file that mocks
 * `@/lib/project/project-context` to control what its component READS still
 * renders inside a valid context here.
 */
export function renderWithProviders(ui: ReactElement, options?: ProvidersOptions) {
  const queryClient = testQueryClient();
  const { projectSelection, initialEntries, ...renderOptions } = options ?? {};
  const selection = projectSelection === null ? null : testProjectSelection(projectSelection);

  function Wrapper({ children }: Readonly<{ children: ReactNode }>) {
    return (
      <MemoryRouter
        initialEntries={
          initialEntries ?? [
            window.location.pathname + window.location.search + window.location.hash,
          ]
        }
      >
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            {selection === null ? (
              children
            ) : (
              <ProjectSelectionProvider value={selection}>
                <SessionProvider value={TEST_SESSION}>
                  <UserMenuController>
                    {selection.activeProject ? (
                      <ActiveProjectScopeProvider project={selection.activeProject}>
                        {children}
                      </ActiveProjectScopeProvider>
                    ) : (
                      children
                    )}
                  </UserMenuController>
                </SessionProvider>
              </ProjectSelectionProvider>
            )}
          </TooltipProvider>
        </QueryClientProvider>
      </MemoryRouter>
    );
  }

  return { queryClient, ...render(ui, { wrapper: Wrapper, ...renderOptions }) };
}
