import { createContext, useContext, useMemo, type ReactNode } from 'react';

import type { Project } from '@citeladder/contracts';

export type ActiveProjectScope = Readonly<{
  workspaceId: string;
  projectId: string;
  project: Project;
}>;

const ActiveProjectScopeContext = createContext<ActiveProjectScope | null>(null);

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

export function useProjectScope(): ActiveProjectScope {
  const scope = useContext(ActiveProjectScopeContext);
  if (!scope) {
    throw new Error(
      'useProjectScope must be used under a project route (inside <ActiveProjectScopeProvider>).',
    );
  }
  return scope;
}
