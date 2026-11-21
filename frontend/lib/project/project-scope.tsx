import { createContext, useContext, type ReactNode } from 'react';

import type { Project, ProjectSummary, Workspace } from '@citeladder/contracts';
import type { FailureScope, SelectionStatus } from '@/lib/project/selection';

export type ProjectContextValue = {
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  activeWorkspace: Workspace | null;
  setActiveWorkspaceId: (workspaceId: string) => void;
  projects: ProjectSummary[];
  projectsSettled: boolean;
  activeProject: Project | null;
  activeProjectId: string | null;
  setActiveProjectId: (projectId: string) => void;
  status: SelectionStatus;
  errorScope: FailureScope;
  retry: () => void;
  isLoading: boolean;
  isError: boolean;
};

const ProjectContext = createContext<ProjectContextValue | null>(null);

export function ProjectSelectionProvider({
  value,
  children,
}: Readonly<{ value: ProjectContextValue; children: ReactNode }>) {
  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProjectContext(): ProjectContextValue {
  const context = useOptionalProjectContext();
  if (!context) {
    throw new Error('useProjectContext must be used within a <ProjectProvider>.');
  }
  return context;
}

/**
 * The active-project context, or `null` when there is no provider above.
 *
 * For the few hooks and components that may render outside the provider
 * (project-aware links and navigation, and tests that mount a screen alone),
 * where "no selection exists" is a real, renderable state rather than a
 * programming error. Everything inside the shell should
 * use `useProjectContext`, whose throw is what keeps a missing provider from
 * being mistaken for an unresolved one.
 */
export function useOptionalProjectContext(): ProjectContextValue | null {
  return useContext(ProjectContext);
}

export function useActiveProject(): Project | null {
  return useProjectContext().activeProject;
}

export function useActiveWorkspaceId(): string | null {
  return useProjectContext().activeWorkspaceId;
}

/**
 * What the caller may do in the ACTIVE workspace.
 *
 * The names come straight from the backend's one role policy, on the
 * workspace list response. Use them to hide controls a role cannot use — not
 * as the boundary: every denial is enforced on the server, which is the only
 * thing a caller cannot bypass.
 */
type WorkspaceCapability = 'read' | 'write' | 'run' | 'manage_credentials' | 'delete_projects';

export function useWorkspaceCapability(capability: WorkspaceCapability): boolean {
  const { activeWorkspace } = useProjectContext();
  return activeWorkspace?.capabilities.includes(capability) ?? false;
}
