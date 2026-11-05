import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { THEME_COOKIE, setThemePreference, useTheme } from './theme';

function mockColorScheme(dark: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    matches: dark,
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  };
  vi.stubGlobal('matchMedia', () => query);
  return (next: boolean) => {
    query.matches = next;
    for (const listener of listeners) listener();
  };
}

describe('useTheme', () => {
  afterEach(() => {
    document.cookie = `${THEME_COOKIE}=; Max-Age=0; Path=/`;
    delete document.documentElement.dataset.theme;
    vi.unstubAllGlobals();
  });

  it('follows the device scheme live until a theme is chosen', () => {
    const setDeviceDark = mockColorScheme(false);
    const { result } = renderHook(() => useTheme());

    act(() => setDeviceDark(true));
    expect(result.current).toBe('dark');
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');

    act(() => setThemePreference('light'));
    act(() => setDeviceDark(true));
    expect(result.current).toBe('light');

    // Back to system: the device scheme decides again.
    act(() => setThemePreference('system'));
    expect(result.current).toBe('dark');
    expect(document.cookie).not.toContain(`${THEME_COOKIE}=`);
  });

  it('picks up a choice another surface wrote to the cookie when the window regains focus', () => {
    mockColorScheme(false);
    const { result } = renderHook(() => useTheme());

    act(() => {
      document.cookie = `${THEME_COOKIE}=dark; Path=/`;
      window.dispatchEvent(new Event('focus'));
    });
    expect(result.current).toBe('dark');
  });

  it('swaps the palette with transitions paused, then restores them', () => {
    vi.useFakeTimers();
    const pauses = () =>
      [...document.head.querySelectorAll('style')].filter((style) =>
        style.textContent?.includes('transition:none'),
      ).length;
    const before = pauses();
    try {
      setThemePreference('dark');
      expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
      expect(pauses()).toBe(before + 1);

      vi.runAllTimers();
      expect(pauses()).toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });
});
