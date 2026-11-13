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
