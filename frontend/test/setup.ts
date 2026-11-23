import './animation-event';
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { transferableAbortController } from 'node:util';
import { afterEach } from 'vite-plus/test';
import { installIntersectionObserver } from './intersection-observer';
import { installResizeObserver } from './resize-observer';

const nativeAbortController = transferableAbortController();
globalThis.AbortController = nativeAbortController.constructor as typeof AbortController;
globalThis.AbortSignal = nativeAbortController.signal.constructor as typeof AbortSignal;

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

installResizeObserver();

installIntersectionObserver();

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
