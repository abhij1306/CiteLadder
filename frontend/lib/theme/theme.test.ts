import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { setTheme, THEME_STORAGE_KEY, useTheme } from './theme';

describe('useTheme', () => {
  afterEach(() => {
    delete document.documentElement.dataset.theme;
  });

  it('follows a preference changed in another tab', () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current).toBe('light');

    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', { key: THEME_STORAGE_KEY, newValue: 'dark' }),
      );
    });
    expect(result.current).toBe('dark');
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');

    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY, newValue: null }));
    });
    expect(result.current).toBe('light');
    expect(document.documentElement).not.toHaveAttribute('data-theme');
  });

  it('swaps the palette with transitions paused, then restores them', () => {
    vi.useFakeTimers();
    const pauses = () =>
      [...document.head.querySelectorAll('style')].filter((style) =>
        style.textContent?.includes('transition:none'),
      ).length;
    const before = pauses();
    try {
      setTheme('dark');
      expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
      expect(pauses()).toBe(before + 1);

      vi.runAllTimers();
      expect(pauses()).toBe(before);
    } finally {
      vi.useRealTimers();
      window.localStorage.removeItem(THEME_STORAGE_KEY);
    }
  });
});
