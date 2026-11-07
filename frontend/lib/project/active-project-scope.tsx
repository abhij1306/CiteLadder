'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';

import type { Project } from '@citeladder/contracts';

/**
 * The resolved project a project route renders for.
 *
 * `OnboardingGate` publishes it only once the selection is `ready` on a
 * project-required route, so a screen under that gate never sees a missing
 * project: there is no "no project selected" branch to render and no empty
 * sentinel to key a read by. Components that also render outside project
 * routes (the shell, the command palette, settings, the docked Agent panel)
 * keep reading the nullable `useProjectContext()` instead.
 *
 * It satisfies the query-key `ProjectScope`, so it is passed to query
 * factories as is.
 */
export type ActiveProjectScope = Readonly<{
  workspaceId: string;
  projectId: string;
  project: Project;
}>;

const ActiveProjectScopeContext = createContext<ActiveProjectScope | null>(null);

/** Publish the gate's resolved project to a project route. */
export function ActiveProjectScopeProvider({
  project,
  children,
}: Readonly<{ project: Project; children: ReactNode }>) {
  const scope = useMemo(
    () => ({ workspaceId: project.workspace_id, projectId: project.id, project }),
    [project],
  );
  return (
    <ActiveProjectScopeContext.Provider value={scope}>
      {children}
    </ActiveProjectScopeContext.Provider>
  );
}

/**
 * The active project of a project route.
 *
 * Throws outside `ActiveProjectScopeProvider`: reaching for it from a
 * workspace route or the shell is a programming error, never a user state.
 */
export function useProjectScope(): ActiveProjectScope {
  const scope = useContext(ActiveProjectScopeContext);
  if (!scope) {
    throw new Error(
      'useProjectScope must be used under a project route (inside <ActiveProjectScopeProvider>).',
    );
  }
  return scope;
}
