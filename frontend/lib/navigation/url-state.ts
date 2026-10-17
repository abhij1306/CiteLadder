'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';

export type UrlCodec<T> = {
  parse: (raw: string | null) => T;
  serialize: (value: T) => string | null;
};

export type UrlHistory = 'push' | 'replace';

const BASE = 'https://citeladder.local';

function browserLocation(): string {
  if (typeof window === 'undefined') return '/';
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

/**
 * ONE subscription to the address bar, shared by every `useUrlState` in the tree.
 *
 * Each instance used to attach three window listeners and parse its own `URL`.
 * A screen like Site Health's issue catalog holds eleven of them and AI
 * Visibility holds seventeen — so a single filter click woke fifty-one
 * listeners and rebuilt seventeen `URL` objects to read seventeen strings out
 * of the same query. The parse below is computed once per distinct address
 * instead, and shared.
 *
 * Nothing here caches "the current address". The browser already holds that,
 * and a second copy of it is what this module has to keep honest — so both the
 * snapshot and the parse read through, and the only thing remembered is what
 * the listeners were last TOLD.
 */
const listeners = new Set<() => void>();
/**
 * The address listeners have already been notified about.
 *
 * Deliberately not the same value `getSnapshot` returns. When they were one
 * variable, a render that happened to call `getSnapshot` after the address
 * changed but before `popstate` arrived advanced it — and `refresh` then found
 * nothing to report and told nobody. Every component that had not re-rendered
 * for its own reasons kept the previous query indefinitely.
 */
let notified = browserLocation();
let parsedFor: string | null = null;
let parsedParams: URLSearchParams = new URLSearchParams();

function refresh(): void {
  const next = browserLocation();
  if (next === notified) return;
  notified = next;
  for (const listener of listeners) listener();
}

/** One address's query, parsed once and shared by every reader of it. */
function paramsFor(href: string): URLSearchParams {
  if (parsedFor !== href) {
    parsedParams = new URL(href, BASE).searchParams;
    parsedFor = href;
  }
  return parsedParams;
}

function attach(): void {
  // Nobody was watching, so the address may have moved without a notice (a
  // `history.replaceState`, a test resetting its deep link). Start from where
  // it is now, or a commit back to the stale address would notify no one.
  notified = browserLocation();
  window.addEventListener('popstate', refresh);
  window.addEventListener('hashchange', refresh);
}

function detach(): void {
  window.removeEventListener('popstate', refresh);
  window.removeEventListener('hashchange', refresh);
}

/** Watch the address. Returns an unsubscribe, as `useSyncExternalStore` wants. */
export function subscribeToUrlState(listener: () => void): () => void {
  if (listeners.size === 0) attach();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) detach();
  };
}

/** The address as it is right now. */
export function readUrlState(): string {
  // Read through. The address can be changed by something that notifies nobody
  // — a test setting up a deep link, a `history.replaceState` in code that
  // predates this module — and a store that only updated on its own events
  // would hand React the previous page forever. Returning a string keeps this
  // safe: React compares snapshots with `Object.is`, so an equal string is the
  // same snapshot.
  return browserLocation();
}

function getServerSnapshot(): string {
  return '/';
}

/**
 * The router this document is running, once it exists.
 *
 * Writing the address with `history.pushState` directly is invisible to React
 * Router — it only watches `popstate` — so `useLocation` and `useSearchParams`
 * went stale the moment a filter changed. Everything reading them downstream
 * then held the previous query: the agent sheet's route context, the sidebar's
 * destinations, the shell's canonical-URL rewrite. That last one is the
 * damaging case, because it rebuilds the address from what it can see and so
 * dropped the filters the reader had just set.
 *
 * Routing the write through the router keeps one owner of the address. The
 * fallback is for tests, which have none.
 */
type UrlStateRouter = {
  navigate: (to: string, options?: { replace?: boolean }) => unknown;
  subscribe: (listener: () => void) => () => void;
};

let activeRouter: UrlStateRouter | null = null;

export function setUrlStateRouter(router: UrlStateRouter | null): void {
  activeRouter = router;
  // The router navigates for its own reasons too — a sidebar click, the
  // shell's canonicalisation — and those must reach this store, or it would be
  // the stale one instead.
  router?.subscribe(() => refresh());
}

function commitUrl(href: string, history: UrlHistory): void {
  const current = new URL(window.location.href);
  const next = new URL(href, current);
  if (
    next.pathname === current.pathname &&
    next.hash === current.hash &&
    next.searchParams.toString() === current.searchParams.toString()
  )
    return;
  if (activeRouter) {
    activeRouter.navigate(href, { replace: history === 'replace' });
    return;
  }
  window.history[history === 'push' ? 'pushState' : 'replaceState'](window.history.state, '', href);
  refresh();
}

/** Atomically change related URL-owned filters with one history entry. */
export function setUrlParams(
  values: Readonly<Record<string, string | null>>,
  history: UrlHistory = 'push',
) {
  const current = new URL(window.location.href);
  for (const [key, value] of Object.entries(values)) {
    if (value === null) current.searchParams.delete(key);
    else current.searchParams.set(key, value);
  }
  const href = `${current.pathname}${current.search}${current.hash}`;
  commitUrl(href, history);
}

/**
 * A same-document href, dropping the `?` when the query is empty.
 *
 * A stray `?` on an otherwise identical URL is enough to make a history entry
 * look like a navigation.
 */
function hrefWithQuery(
  location: Readonly<{ pathname: string; hash: string }>,
  query: string,
): string {
  const search = query ? `?${query}` : '';
  return `${location.pathname}${search}${location.hash}`;
}

export function useUrlState<T>(
  key: string,
  codec: UrlCodec<T>,
  options: Readonly<{ history?: UrlHistory; clearKeys?: readonly string[] }> = {},
): readonly [T, (value: T, history?: UrlHistory) => void] {
  const location = useSyncExternalStore(subscribeToUrlState, readUrlState, getServerSnapshot);
  const value = useMemo(() => codec.parse(paramsFor(location).get(key)), [codec, location, key]);

  const { history: historyOption, clearKeys } = options;
  const setValue = useCallback(
    (next: T, history = historyOption ?? 'push') => {
      // Composed from the LIVE address, the same way `setUrlParams` is. A
      // write is an edit to wherever the reader is now, and "now" can already
      // be past the render this callback was created in — another setter may
      // have committed in the same tick, and a router navigation lands a beat
      // after it is asked for. Building on a remembered address would drop
      // whatever it did not know about.
      const current = new URL(window.location.href);
      const params = current.searchParams;
      const encoded = codec.serialize(next);
      if (encoded === null) params.delete(key);
      else params.set(key, encoded);
      for (const ownedKey of clearKeys ?? []) params.delete(ownedKey);
      const href = hrefWithQuery(current, params.toString());
      commitUrl(href, history);
    },
    [codec, key, clearKeys, historyOption],
  );

  return [value, setValue] as const;
}

export function stringUrlCodec<T extends string>(allowed: readonly T[], fallback: T): UrlCodec<T> {
  return {
    parse: (raw) => (allowed.includes(raw as T) ? (raw as T) : fallback),
    serialize: (value) => (value === fallback ? null : value),
  };
}

export const optionalStringUrlCodec: UrlCodec<string | null> = {
  parse: (raw) => raw,
  serialize: (value) => value,
};
