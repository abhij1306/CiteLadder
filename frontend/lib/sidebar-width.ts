import { useSyncExternalStore } from 'react';

/**
 * The app sidebar's width, a per-browser reading preference (never the
 * server's): the reader drags the sidebar's inner edge and the width stays
 * for this browser.
 *
 * `localStorage` is the stored width's only home, read through
 * `useSyncExternalStore`. The app renders on the client only, so the shell's
 * first render already reads the stored width: the frame paints at it, with no
 * default-width frame first. Mid-drag the live width is the store's volatile
 * value, so the frame follows the pointer; only a settled width is written.
 *
 * `null` means the default: the frame then sets no width of its own and the
 * `--sidebar-width` token in `globals.css` stands.
 */

const STORAGE_KEY = 'citeladder:app:sidebar-width';

/** The `--sidebar-width` token: the default, and the narrowest the sidebar goes. */
export const SIDEBAR_DEFAULT_WIDTH = 248;
const SIDEBAR_MIN_WIDTH = SIDEBAR_DEFAULT_WIDTH;
/** Past this the page, not the sidebar, is the one being starved. */
const SIDEBAR_MAX_WIDTH = 480;
/** The sidebar never takes more than this share of the window. */
const SIDEBAR_MAX_VIEWPORT_SHARE = 0.4;

/** The widths a drag or key press may settle on in a window this wide. */
export function sidebarWidthBounds(viewportWidth: number): { min: number; max: number } {
  const share = Math.floor(viewportWidth * SIDEBAR_MAX_VIEWPORT_SHARE);
  return {
    min: SIDEBAR_MIN_WIDTH,
    max: Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, share)),
  };
}

function clampStored(width: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)));
}

const listeners = new Set<() => void>();
/** The width on screen mid-drag, before it settles. */
let liveWidth: number | null = null;
/** A settled width kept for the session when the browser blocks storage. */
let volatileWidth: number | null = null;

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Another tab resizing its sidebar is the same store changing underneath us.
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

function readStored(): number | null {
  if (volatileWidth !== null) return volatileWidth;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const stored = Number(raw);
    return Number.isFinite(stored) && stored > 0 ? clampStored(stored) : null;
  } catch {
    // Site data blocked: the sidebar still works, unremembered.
    return null;
  }
}

function getWidth(): number | null {
  return liveWidth ?? readStored();
}

function getServerWidth(): number | null {
  return null;
}

function store(width: number): void {
  const settled = clampStored(width);
  liveWidth = null;
  try {
    // The default is no preference at all, so the token stays the one default.
    if (settled === SIDEBAR_DEFAULT_WIDTH) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, String(settled));
    volatileWidth = null;
  } catch {
    volatileWidth = settled;
  }
  notify();
}

function preview(width: number): void {
  // Back at the settled width (a cancelled drag) there is nothing live to show.
  liveWidth = width === (readStored() ?? SIDEBAR_DEFAULT_WIDTH) ? null : width;
  notify();
}

/** The reader's sidebar width in px, or `null` for the token's default. */
export function useSidebarWidth(): number | null {
  return useSyncExternalStore(subscribe, getWidth, getServerWidth);
}

/** The width plus the two writes the resize handle makes. */
export function useSidebarWidthControl(): {
  width: number;
  /** Show a width mid-drag without storing it. */
  preview: (width: number) => void;
  /** Keep a settled width (a drag's end, a key press, a reset). */
  commit: (width: number) => void;
} {
  const width = useSidebarWidth() ?? SIDEBAR_DEFAULT_WIDTH;
  return { width, preview, commit: store };
}
