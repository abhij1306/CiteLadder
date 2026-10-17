'use client';

import { newProjectDestination } from '@/lib/navigation/project-destination';
import { useProjectContext, useWorkspaceCapability } from '@/lib/project/project-context';

/**
 * Whether the viewer may create a project in the active workspace: the role
 * (`write`) decides, and a failed workspace read withholds the action.
 */
export function useProjectCreation() {
  const { activeWorkspaceId, isError } = useProjectContext();
  const mayCreate = useWorkspaceCapability('write');
  const canAddProject = !isError && mayCreate;
  return { activeWorkspaceId, mayCreate, canAddProject };
}

/**
 * The new-project route for `NoProjectState`, or null when the viewer cannot
 * create one, so the action is never offered and then refused.
 */
export function useCreateProjectHref(): string | null {
  const { activeWorkspaceId, canAddProject } = useProjectCreation();
  return canAddProject ? newProjectDestination(activeWorkspaceId) : null;
}
