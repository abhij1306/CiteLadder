'use client';

import { useSyncExternalStore } from 'react';

/**
 * Width state for a drag-resizable pane, in pixels.
 *
 * The catalog pane was a fixed 18rem track. That is too narrow for a retailer
 * whose category names are full sentences ("END OF SEASON UP TO 50% OFF") and
 * too wide for one that just lists "Tops"/"Denim", and neither reading is the
 * app's to make — so the width is the reader's, and it persists per browser.
 *
 * `localStorage` is the stored width's only home, read through
 * `useSyncExternalStore`: it is an external store, and subscribing to it is
 * what keeps the server's markup (always the default) from being contradicted
 * by a client render, without an effect that re-renders on mount. The width
 * mid-drag is the split pane's state — it is not yet a decision worth storing.
 */

const STORAGE_KEY = 'citeladder:commerce:catalog-pane-width';

/** 14rem: below this the checkbox, name, and count stop fitting on one line. */
export const MIN_PANE_WIDTH = 224;
/** 35rem: past this the detail pane, not the list, is the one being starved. */
export const MAX_PANE_WIDTH = 560;
/** 18rem — the fixed track this pane had before it could be resized. */
export const DEFAULT_PANE_WIDTH = 288;

function clampWidth(width: number): number {
  return Math.min(MAX_PANE_WIDTH, Math.max(MIN_PANE_WIDTH, Math.round(width)));
}

const listeners = new Set<() => void>();
let volatileWidth: number | null = null;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Another tab resizing its pane is the same store changing underneath us.
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

function getStoredWidth(): number {
  if (volatileWidth !== null) return volatileWidth;
  try {
    const stored = Number(window.localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(stored) && stored > 0 ? clampWidth(stored) : DEFAULT_PANE_WIDTH;
  } catch {
    // A browser with site data blocked still gets a working, unremembered pane.
    return DEFAULT_PANE_WIDTH;
  }
}

/** The server has no stored width, so it renders the default. */
function getServerWidth(): number {
  return DEFAULT_PANE_WIDTH;
}

function storeWidth(width: number): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(width));
    volatileWidth = null;
  } catch {
    // Keep the reader's decision for this session when persistence is blocked.
    volatileWidth = width;
  }
  for (const listener of listeners) listener();
}

type ResizablePane = {
  /** The reader's stored width, clamped to the pane bounds. */
  width: number;
  /** Keep a settled width (from a drag, a key press or a reset). */
  commit: (width: number) => void;
};

/**
 * The stored width only. The drag and keyboard interaction belongs to the
 * shared `ResizableSplitPane`, which reports a settled width to `commit`.
 */
export function useResizablePane(): ResizablePane {
  const width = useSyncExternalStore(subscribe, getStoredWidth, getServerWidth);
  return { width, commit: (next) => storeWidth(clampWidth(next)) };
}
