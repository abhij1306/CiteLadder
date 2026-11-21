export const ACTIVE_PROJECT_STORAGE_KEY = 'citeladder.active-project-id';
export const ACTIVE_WORKSPACE_STORAGE_KEY = 'citeladder.active-workspace-id';

function readKey(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = window.localStorage.getItem(key);
    return value?.trim() ? value : null;
  } catch {
    return null;
  }
}

function writeKey(key: string, value: string | null) {
  if (typeof window === 'undefined') return;
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {}
}

export function readStoredActiveProjectId(): string | null {
  return readKey(ACTIVE_PROJECT_STORAGE_KEY);
}

export function writeStoredActiveProjectId(projectId: string | null) {
  writeKey(ACTIVE_PROJECT_STORAGE_KEY, projectId);
}

export function readStoredActiveWorkspaceId(): string | null {
  return readKey(ACTIVE_WORKSPACE_STORAGE_KEY);
}

export function writeStoredActiveWorkspaceId(workspaceId: string | null) {
  writeKey(ACTIVE_WORKSPACE_STORAGE_KEY, workspaceId);
}
