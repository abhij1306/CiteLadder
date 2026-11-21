import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'citeladder:app:sidebar-width';
const COLLAPSED_KEY = 'citeladder:app:sidebar-collapsed';

const SIDEBAR_WIDE_WIDTH = 224;
const SIDEBAR_COMPACT_WIDTH = 200;
const WIDE_QUERY = '(min-width: 1280px)';
const SIDEBAR_MIN_WIDTH = SIDEBAR_COMPACT_WIDTH;

export function sidebarDefaultWidth(): number {
  return typeof window !== 'undefined' && window.matchMedia?.(WIDE_QUERY).matches
    ? SIDEBAR_WIDE_WIDTH
    : SIDEBAR_COMPACT_WIDTH;
}
const SIDEBAR_MAX_WIDTH = 480;
const SIDEBAR_MAX_VIEWPORT_SHARE = 0.4;
export const SIDEBAR_PRESET_WIDTHS = [
  SIDEBAR_COMPACT_WIDTH,
  SIDEBAR_WIDE_WIDTH,
  288,
  360,
  SIDEBAR_MAX_WIDTH,
] as const;

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
let liveWidth: number | null = null;
let volatileWidth: number | null = null;

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
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
    if (settled === sidebarDefaultWidth()) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, String(settled));
    volatileWidth = null;
  } catch {
    volatileWidth = settled;
  }
  notify();
}

function preview(width: number): void {
  liveWidth = width === (readStored() ?? sidebarDefaultWidth()) ? null : width;
  notify();
}

export function useSidebarWidth(): number | null {
  return useSyncExternalStore(subscribe, getWidth, getServerWidth);
}

export function useSidebarWidthControl(): {
  width: number;
  preview: (width: number) => void;
  commit: (width: number) => void;
} {
  const width = useSidebarWidth() ?? sidebarDefaultWidth();
  return { width, preview, commit: store };
}

let volatileCollapsed: boolean | null = null;

function readCollapsed(): boolean {
  if (volatileCollapsed !== null) return volatileCollapsed;
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function setSidebarCollapsed(collapsed: boolean): void {
  try {
    if (collapsed) window.localStorage.setItem(COLLAPSED_KEY, '1');
    else window.localStorage.removeItem(COLLAPSED_KEY);
    volatileCollapsed = null;
  } catch {
    volatileCollapsed = collapsed;
  }
  notify();
}

export function useSidebarCollapsed(): boolean {
  return useSyncExternalStore(subscribe, readCollapsed, () => false);
}
