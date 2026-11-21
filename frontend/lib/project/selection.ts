import type { Project, ProjectSummary, Workspace } from '@citeladder/contracts';

export type SelectionStatus =
  | 'resolving'
  | 'ready'
  | 'empty'
  | 'unavailable'
  | 'error'
  | 'no_workspace';

export type WorkspaceInputs = {
  projectWorkspaceId: string | null;
  urlWorkspaceId: string | null;
  selectedWorkspaceId: string | null;
  workspaces: readonly Workspace[] | undefined;
};

export function resolveWorkspaceId({
  projectWorkspaceId,
  urlWorkspaceId,
  selectedWorkspaceId,
  workspaces,
}: WorkspaceInputs): string | null {
  if (projectWorkspaceId) return projectWorkspaceId;
  const candidates = [urlWorkspaceId, selectedWorkspaceId].filter((id): id is string =>
    Boolean(id),
  );
  if (workspaces === undefined) return candidates[0] ?? null;
  const member = candidates.find((id) => workspaces.some((workspace) => workspace.id === id));
  return member ?? workspaces[0]?.id ?? null;
}

export type ProjectInputs = {
  requestedProjectId: string | null;
  selectedProjectId: string | null;
  projects: readonly ProjectSummary[];
  listSettled: boolean;
};

export function resolveProjectId({
  requestedProjectId,
  selectedProjectId,
  projects,
  listSettled,
}: ProjectInputs): string | null {
  if (requestedProjectId) return requestedProjectId;
  if (selectedProjectId) {
    if (projects.some((project) => project.id === selectedProjectId)) return selectedProjectId;
    if (!listSettled) return selectedProjectId;
  }
  return projects[0]?.id ?? null;
}

export type StatusInputs = {
  contradictoryRequest: boolean;
  requestedProjectPending: boolean;
  requestedProjectMissing: boolean;
  failed: boolean;
  noWorkspace: boolean;
  workspaceId: string | null;
  activeProjectId: string | null;
  hasResolvedProject: boolean;
  listSettled: boolean;
};

export function resolveStatus({
  contradictoryRequest,
  requestedProjectPending,
  requestedProjectMissing,
  failed,
  noWorkspace,
  workspaceId,
  activeProjectId,
  hasResolvedProject,
  listSettled,
}: StatusInputs): SelectionStatus {
  if (contradictoryRequest || requestedProjectMissing) return 'unavailable';
  if (failed) return 'error';
  if (noWorkspace) return 'no_workspace';
  if (requestedProjectPending) return 'resolving';
  if (hasResolvedProject) return 'ready';
  if (workspaceId === null || !listSettled) return 'resolving';
  if (activeProjectId === null) return 'empty';
  return 'resolving';
}

export function pickActiveProject(
  views: readonly (Project | null | undefined)[],
  activeProjectId: string | null,
  workspaceId: string | null,
): Project | null {
  return (
    views.find((view) => view?.id === activeProjectId && view.workspace_id === workspaceId) ?? null
  );
}

export type FailureInputs = {
  detailFailed: boolean;
  membershipFailed: boolean;
  listFailedWithNothingUsable: boolean;
};

export type FailureScope = 'workspace' | 'projects' | null;

export function resolveFailureScope({
  detailFailed,
  membershipFailed,
  listFailedWithNothingUsable,
}: FailureInputs): FailureScope {
  if (membershipFailed) return 'workspace';
  if (detailFailed || listFailedWithNothingUsable) return 'projects';
  return null;
}

export function resolveFailed({
  detailFailed,
  membershipFailed,
  listFailedWithNothingUsable,
}: FailureInputs): boolean {
  return detailFailed || membershipFailed || listFailedWithNothingUsable;
}
