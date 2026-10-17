import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import {
  DEFAULT_PANE_WIDTH,
  MAX_PANE_WIDTH,
  MIN_PANE_WIDTH,
  useResizablePane,
} from './use-resizable-pane';

const STORAGE_KEY = 'citeladder:commerce:catalog-pane-width';

describe('useResizablePane', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('starts at the width the pane had before it was resizable', () => {
    const { result } = renderHook(() => useResizablePane());
    expect(result.current.width).toBe(DEFAULT_PANE_WIDTH);
  });

  it('keeps a committed width, clamped to the bounds, across mounts', () => {
    const { result } = renderHook(() => useResizablePane());
    act(() => result.current.commit(DEFAULT_PANE_WIDTH + 60));
    expect(renderHook(() => useResizablePane()).result.current.width).toBe(DEFAULT_PANE_WIDTH + 60);

    act(() => result.current.commit(-500));
    expect(result.current.width).toBe(MIN_PANE_WIDTH);
    act(() => result.current.commit(99_999));
    expect(result.current.width).toBe(MAX_PANE_WIDTH);
  });

  it('keeps the width in memory when browser storage rejects writes', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage is blocked', 'SecurityError');
    });
    const { result } = renderHook(() => useResizablePane());
    act(() => result.current.commit(DEFAULT_PANE_WIDTH + 60));
    expect(result.current.width).toBe(DEFAULT_PANE_WIDTH + 60);
    setItem.mockRestore();
    act(() => result.current.commit(DEFAULT_PANE_WIDTH));
  });

  it('follows another tab resizing the same pane', () => {
    const { result } = renderHook(() => useResizablePane());
    act(() => {
      window.localStorage.setItem(STORAGE_KEY, '352');
      window.dispatchEvent(new Event('storage'));
    });
    expect(result.current.width).toBe(352);
  });

  it('ignores a stored width that is out of bounds or not a number', () => {
    window.localStorage.setItem(STORAGE_KEY, 'not-a-width');
    expect(renderHook(() => useResizablePane()).result.current.width).toBe(DEFAULT_PANE_WIDTH);
    window.localStorage.setItem(STORAGE_KEY, '99999');
    expect(renderHook(() => useResizablePane()).result.current.width).toBe(MAX_PANE_WIDTH);
  });
});
