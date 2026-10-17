import { useSyncExternalStore } from 'react';

/**
 * The product's light/dark preference. Light is the default; dark is an opt-in
 * per device, kept in localStorage. Only the app document applies it.
 *
 * The document's `data-theme` attribute is the live state. `index.html` sets it
 * from storage before first paint (it repeats THEME_STORAGE_KEY inline, since
 * that script runs before any module loads), and this module keeps it current.
 */
export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'citeladder.theme';

const listeners = new Set<() => void>();

/**
 * Run a palette swap with transitions paused. Fields, selects and selected rows
 * transition their colours, so a live swap would fade every one of them
 * between palettes at once. Transitions return only after a frame has painted
 * the new colours, so nothing animates.
 */
function withoutTransitions(change: () => void) {
  const pause = document.createElement('style');
  pause.textContent = '*,*::before,*::after{transition:none!important}';
  document.head.append(pause);
  change();
  // The first frame paints the new palette with transitions still off.
  window.requestAnimationFrame(() => window.requestAnimationFrame(() => pause.remove()));
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  withoutTransitions(() => {
    if (theme === 'dark') root.dataset.theme = 'dark';
    else delete root.dataset.theme;
    document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', theme);
  });
  for (const listener of listeners) listener();
}

function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

export function setTheme(theme: Theme) {
  try {
    if (theme === 'dark') window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    else window.localStorage.removeItem(THEME_STORAGE_KEY);
  } catch {
    // Storage unavailable (private mode / quota): the choice lasts this document.
  }
  applyTheme(theme);
}

function onStorage(event: StorageEvent) {
  // Another tab changed the preference; follow it so open tabs stay consistent.
  if (event.key === THEME_STORAGE_KEY || event.key === null) {
    applyTheme(event.newValue === 'dark' ? 'dark' : 'light');
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener('storage', onStorage);
  };
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, currentTheme, () => 'light');
}
