import { useSyncExternalStore } from 'react';

/**
 * The one light/dark/system preference for the app, kept in a cookie (on the
 * parent domain when the app is served from a subdomain). With no cookie the
 * preference is `system`, which follows the device's colour scheme live.
 *
 * The document's `data-theme` attribute is the resolved theme. Each surface's
 * <head> loads `/theme-preference.js` before first paint (it repeats
 * THEME_COOKIE inline, since it runs before any module loads); this module
 * keeps the attribute current after that.
 */
export type ThemePreference = 'light' | 'dark' | 'system';
export type Theme = 'light' | 'dark';

export const THEME_COOKIE = 'citeladder_theme';
/** A year: the choice is a standing preference, refreshed whenever it changes. */
const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
const DARK_QUERY = '(prefers-color-scheme: dark)';

const listeners = new Set<() => void>();

function isExplicit(value: string | undefined): value is Theme {
  return value === 'light' || value === 'dark';
}

/** The stored preference; anything but an explicit theme is `system`. */
function storedPreference(): ThemePreference {
  const entry = document.cookie
    .split('; ')
    .find((part) => part.startsWith(`${THEME_COOKIE}=`))
    ?.slice(THEME_COOKIE.length + 1);
  return isExplicit(entry) ? entry : 'system';
}

/**
 * The cookie's Domain: the parent of a subdomain (`app.example.com` →
 * `example.com`), the host itself for an apex, and none (host-only) for
 * localhost and IP addresses, where a Domain attribute would be rejected.
 */
export function themeCookieDomain(hostname: string): string | null {
  if (hostname === 'localhost' || /^[\d.]+$/.test(hostname) || hostname.includes(':')) return null;
  const labels = hostname.split('.');
  if (labels.length < 2) return null;
  return labels.length > 2 ? labels.slice(1).join('.') : hostname;
}

function writePreference(preference: ThemePreference) {
  const domain = themeCookieDomain(window.location.hostname);
  const domainPart = domain ? '; Domain=' + domain : '';
  const securePart = window.location.protocol === 'https:' ? '; Secure' : '';
  const scope = '; Path=/; SameSite=Lax' + domainPart + securePart;
  document.cookie =
    preference === 'system'
      ? `${THEME_COOKIE}=; Max-Age=0${scope}`
      : `${THEME_COOKIE}=${preference}; Max-Age=${THEME_COOKIE_MAX_AGE}${scope}`;
}

function systemTheme(): Theme {
  return window.matchMedia?.(DARK_QUERY).matches ? 'dark' : 'light';
}

function resolve(preference: ThemePreference): Theme {
  return preference === 'system' ? systemTheme() : preference;
}

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
  window.requestAnimationFrame(() => window.requestAnimationFrame(() => pause.remove()));
}

function apply() {
  const theme = resolve(storedPreference());
  const root = document.documentElement;
  if (root.dataset.theme !== theme) {
    withoutTransitions(() => {
      root.dataset.theme = theme;
      document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', theme);
    });
  }
  for (const listener of listeners) listener();
}

export function setThemePreference(preference: ThemePreference) {
  writePreference(preference);
  apply();
}

/** The device scheme changed, or another tab or surface changed the cookie. */
function onExternalChange() {
  apply();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    window.matchMedia?.(DARK_QUERY).addEventListener('change', onExternalChange);
    window.addEventListener('focus', onExternalChange);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.matchMedia?.(DARK_QUERY).removeEventListener('change', onExternalChange);
      window.removeEventListener('focus', onExternalChange);
    }
  };
}

function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

/** The resolved theme the document is showing. */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, currentTheme, () => 'light');
}
