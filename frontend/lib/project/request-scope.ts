import type { Project } from '@/lib/api/types';

export type ProjectRequestScope = Readonly<{
  workspaceId: string;
  projectId: string;
  enabled: boolean;
}>;

/**
 * Convert nullable selection state into the stable arguments query factories require.
 * Callers use `enabled` to prevent the empty sentinel values from reaching the API.
 */
export function resolveProjectRequestScope(
  workspaceId: string | null | undefined,
  projectId: string | null | undefined,
): ProjectRequestScope {
  if (!workspaceId || !projectId) return { workspaceId: '', projectId: '', enabled: false };
  return { workspaceId, projectId, enabled: true };
}

export function resolveActiveProjectRequestScope(
  project: Pick<Project, 'id' | 'workspace_id'> | null | undefined,
): ProjectRequestScope {
  return resolveProjectRequestScope(project?.workspace_id, project?.id);
}
