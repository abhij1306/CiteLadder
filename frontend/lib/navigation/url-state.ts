import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { isOneOf } from '@/lib/utils';

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

const listeners = new Set<() => void>();
let notified = browserLocation();
let parsedFor: string | null = null;
let parsedParams: URLSearchParams = new URLSearchParams();

function refresh(): void {
  const next = browserLocation();
  if (next === notified) return;
  notified = next;
  for (const listener of listeners) listener();
}

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

export function subscribeToUrlState(listener: () => void): () => void {
  if (listeners.size === 0) attach();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) detach();
  };
}

export function readUrlState(): string {
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
  navigate: (to: string, options?: { replace?: boolean; preventScrollReset?: boolean }) => unknown;
  subscribe: (listener: () => void) => () => void;
};

let activeRouter: UrlStateRouter | null = null;

export function setUrlStateRouter(router: UrlStateRouter | null): void {
  activeRouter = router;
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
    activeRouter.navigate(href, {
      replace: history === 'replace',
      preventScrollReset: next.pathname === current.pathname,
    });
    return;
  }
  window.history[history === 'push' ? 'pushState' : 'replaceState'](window.history.state, '', href);
  refresh();
}

let pending: { url: URL; push: boolean } | null = null;

export function batchUrlWrites(run: () => undefined): void {
  if (pending) {
    run();
    return;
  }
  const batch = { url: new URL(window.location.href), push: false };
  pending = batch;
  try {
    run();
  } finally {
    pending = null;
  }
  commitUrl(
    hrefWithQuery(batch.url, batch.url.searchParams.toString()),
    batch.push ? 'push' : 'replace',
  );
}

function writeUrl(edit: (params: URLSearchParams) => void, history: UrlHistory): void {
  if (pending) {
    edit(pending.url.searchParams);
    if (history === 'push') pending.push = true;
    return;
  }
  const current = new URL(window.location.href);
  edit(current.searchParams);
  commitUrl(hrefWithQuery(current, current.searchParams.toString()), history);
}

export function setUrlParams(
  values: Readonly<Record<string, string | null>>,
  history: UrlHistory = 'push',
) {
  writeUrl((params) => {
    for (const [key, value] of Object.entries(values)) {
      if (value === null) params.delete(key);
      else params.set(key, value);
    }
  }, history);
}

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
      writeUrl((params) => {
        const encoded = codec.serialize(next);
        if (encoded === null) params.delete(key);
        else params.set(key, encoded);
        for (const ownedKey of clearKeys ?? []) params.delete(ownedKey);
      }, history);
    },
    [codec, key, clearKeys, historyOption],
  );

  return [value, setValue] as const;
}

export function stringUrlCodec<T extends string>(allowed: readonly T[], fallback: T): UrlCodec<T> {
  return {
    parse: (raw) => (isOneOf(allowed, raw) ? raw : fallback),
    serialize: (value) => (value === fallback ? null : value),
  };
}

export type UrlSort<K extends string> = Readonly<{ key: K; descending: boolean }>;

export function sortUrlCodec<K extends string>(
  keys: readonly K[],
  fallback: UrlSort<K>,
): UrlCodec<UrlSort<K>> {
  const encode = (sort: UrlSort<K>) => `${sort.descending ? '-' : ''}${sort.key}`;
  return {
    parse: (raw) => {
      const descending = raw?.startsWith('-') ?? false;
      const key = descending ? raw?.slice(1) : raw;
      return isOneOf(keys, key) ? { key, descending } : fallback;
    },
    serialize: (sort) => (encode(sort) === encode(fallback) ? null : encode(sort)),
  };
}

export const optionalStringUrlCodec: UrlCodec<string | null> = {
  parse: (raw) => raw,
  serialize: (value) => value,
};
