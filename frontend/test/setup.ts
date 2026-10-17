import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { transferableAbortController } from 'node:util';
import { afterEach } from 'vite-plus/test';
import { installIntersectionObserver } from './intersection-observer';

// The jsdom environment installs jsdom's own AbortController/AbortSignal
// globals, but `fetch` stays Node's undici implementation, which brand-checks
// `init.signal` against the Node-native AbortSignal class. TanStack Query
// creates its per-query signal from the global (jsdom) class, so every
// component query would reject with "Expected signal to be an instance of
// AbortSignal" and stick screens in their loading state. Restore the native
// pair so signals and fetch live in the same realm.
const nativeAbortController = transferableAbortController();
globalThis.AbortController = nativeAbortController.constructor as typeof AbortController;
globalThis.AbortSignal = nativeAbortController.signal.constructor as typeof AbortSignal;

/**
 * Node 26 ships its own lazy `globalThis.localStorage` getter that resolves to
 * `undefined` unless the process was started with `--localstorage-file`. In the
 * jsdom environment `window === globalThis`, and that Node-owned property is
 * already defined by the time vitest copies jsdom's window keys across — so
 * jsdom's own Storage never lands and `window.localStorage` reads as undefined.
 * `sessionStorage` has no Node counterpart and survives untouched, which is why
 * only localStorage breaks. Install a spec-shaped Storage in its place; the
 * property is configurable, and a fresh instance per test file keeps state from
 * leaking between them.
 */
function installLocalStorage() {
  const entries = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return entries.size;
    },
    key: (index: number) => [...entries.keys()][index] ?? null,
    getItem: (key: string) => entries.get(String(key)) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(String(key), String(value));
    },
    removeItem: (key: string) => {
      entries.delete(String(key));
    },
    clear: () => entries.clear(),
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    configurable: true,
    writable: true,
  });
}

if (typeof window !== 'undefined' && !window.localStorage) installLocalStorage();

if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

// Radix measures positioned content with ResizeObserver. jsdom does not
// implement it, but component tests only need the observer contract, not
// layout measurements.
class ResizeObserverStub {
  observe() {
    return undefined;
  }
  unobserve() {
    return undefined;
  }
  disconnect() {
    return undefined;
  }
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

// Chrome that is off-screen costs nothing to observe and a lot to poll, so
// components ask IntersectionObserver instead of listening to scroll. Tests
// drive it through `emitIntersection`.
installIntersectionObserver();

// Radix Select uses pointer capture and element scrolling in browsers. jsdom
// does not implement either API, so install inert contract-compatible stubs.
if (typeof Element !== 'undefined') {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
}

afterEach(() => {
  cleanup();
  if (typeof window !== 'undefined') window.history.replaceState(null, '', '/');
});
