/** The two shell modes. The active one is derived from the route. */
export type NavigationMode = 'dashboard' | 'agent';

/**
 * The last route a reader used in each shell mode, per project, for this
 * browser session. Switching modes returns there instead of to the mode's
 * front door. Storage can be unavailable (private windows, blocked site data),
 * so every access is guarded and absence simply means the default route.
 */
const STORAGE_KEY = 'citeladder:mode-routes';

type Memory = Partial<Record<string, string>>;

function read(): Memory {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Memory) : {};
  } catch {
    return {};
  }
}

const slot = (mode: NavigationMode, projectId: string) => `${mode}:${projectId}`;

export function rememberModeRoute(mode: NavigationMode, projectId: string, href: string): void {
  try {
    const memory = read();
    memory[slot(mode, projectId)] = href;
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(memory));
  } catch {
    // Unavailable storage only loses the convenience, never the navigation.
  }
}

export function rememberedModeRoute(mode: NavigationMode, projectId: string | null): string | null {
  if (!projectId) return null;
  const href = read()[slot(mode, projectId)];
  // Only in-app paths; anything else in storage is ignored.
  return typeof href === 'string' && href.startsWith('/') && !href.startsWith('//') ? href : null;
}
