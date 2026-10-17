'use client';

import { createContext, useContext, type ReactNode } from 'react';

import type { Project, Workspace } from '@/lib/api/types';
import type { FailureScope, SelectionStatus } from '@/lib/project/selection';

/**
 * The context object and its consumers, kept apart from the provider that
 * resolves it.
 *
 * Separating them lets a host that ALREADY knows the selection — a screen
 * rendered in isolation, the test harness — publish one without importing the
 * resolution machinery, and guarantees both halves share a single React
 * context instance. `project-context.tsx` re-exports everything here, so
 * application code imports from one place regardless.
 */
export type ProjectContextValue = {
  /** Every workspace the signed-in user belongs to (empty while loading). */
  workspaces: Workspace[];
  /** The resolved workspace, valid even when it owns no projects. */
  activeWorkspaceId: string | null;
  /** The caller's membership in the active workspace, when known. */
  activeWorkspace: Workspace | null;
  /** Select a workspace by id (persists; callers own any navigation). */
  setActiveWorkspaceId: (workspaceId: string) => void;
  /** The active workspace's projects (empty while loading / none yet). */
  projects: Project[];
  /**
   * Whether `projects` is a SETTLED answer rather than a loading placeholder.
   *
   * `status` describes the selection, and it reaches `ready` on a directly
   * resolved project alone — deliberately, so a brand-new project is usable
   * before the list reconciles. A screen that reads `projects.length === 0` as
   * "this workspace has no projects" must therefore check this first, or it
   * renders "No projects yet" over a project that exists.
   */
  projectsSettled: boolean;
  /** The currently-selected project, or `null` when none is resolved. */
  activeProject: Project | null;
  /** The active project id, or `null`. */
  activeProjectId: string | null;
  /** Select a project by id (persists; callers own any navigation). */
  setActiveProjectId: (projectId: string) => void;
  /** What the shell currently knows — read this, not the booleans below. */
  status: SelectionStatus;
  /** Which read failed, when `status` is `error`. Null otherwise. */
  errorScope: FailureScope;
  /** Retry every read this context owns. */
  retry: () => void;
  /** True while the context has no settled answer yet. */
  isLoading: boolean;
  /** True when a read this context owns failed recoverably. */
  isError: boolean;
};

const ProjectContext = createContext<ProjectContextValue | null>(null);

/** Publish a FIXED selection to the tree. */
export function ProjectSelectionProvider({
  value,
  children,
}: Readonly<{ value: ProjectContextValue; children: ReactNode }>) {
  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

/** Access the active-project context. Throws if used outside a provider. */
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
 * For the few components that render on BOTH sides of the authenticated
 * shell — the public pricing page renders the same checkout controller the
 * account screens do — where "no selection exists" is a real, renderable
 * state rather than a programming error. Everything inside the shell should
 * use `useProjectContext`, whose throw is what keeps a missing provider from
 * being mistaken for an unresolved one.
 */
export function useOptionalProjectContext(): ProjectContextValue | null {
  return useContext(ProjectContext);
}

/** Convenience accessor for just the active project (or null). */
export function useActiveProject(): Project | null {
  return useProjectContext().activeProject;
}

/** Convenience accessor for the resolved workspace id (or null). */
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

/** Whether the active workspace grants `capability`. Fails closed. */
export function useWorkspaceCapability(capability: WorkspaceCapability): boolean {
  const { activeWorkspace } = useProjectContext();
  return activeWorkspace?.capabilities.includes(capability) ?? false;
}
