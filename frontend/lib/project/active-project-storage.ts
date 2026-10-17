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
  } catch {
    // Ignore storage failures (private mode / quota) — selection stays in memory.
  }
}

/** Read the persisted active-project id (SSR-safe: null on the server). */
export function readStoredActiveProjectId(): string | null {
  return readKey(ACTIVE_PROJECT_STORAGE_KEY);
}

export function writeStoredActiveProjectId(projectId: string | null) {
  writeKey(ACTIVE_PROJECT_STORAGE_KEY, projectId);
}

/**
 * Read the persisted active-workspace id.
 *
 * This is a device convenience, NEVER an authorization input: it only lets a
 * returning reader's workspace-scoped requests start in the same render as
 * `me` instead of waiting a round trip for the workspace list. Every request
 * it seeds is still membership-checked by the backend, and a stale id is
 * corrected the moment the workspace list or a 404 says so.
 */
export function readStoredActiveWorkspaceId(): string | null {
  return readKey(ACTIVE_WORKSPACE_STORAGE_KEY);
}

export function writeStoredActiveWorkspaceId(workspaceId: string | null) {
  writeKey(ACTIVE_WORKSPACE_STORAGE_KEY, workspaceId);
}
