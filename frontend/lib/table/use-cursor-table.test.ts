import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vite-plus/test';

import { TABLE_DEFAULT_PAGE_SIZE } from '@/lib/config/tables';
import { pageRange, useCursorTable } from '@/lib/table/use-cursor-table';

describe('useCursorTable', () => {
  it('walks pages forward and back', () => {
    const { result } = renderHook(() => useCursorTable('scope-a'));
    expect(result.current.cursor).toBeUndefined();
    expect(result.current.canPrev).toBe(false);
    expect(result.current.page).toBe(1);

    act(() => result.current.push('cursor-1'));
    expect(result.current.cursor).toBe('cursor-1');
    expect(result.current.page).toBe(2);
    expect(result.current.canPrev).toBe(true);

    act(() => result.current.pop());
    expect(result.current.cursor).toBeUndefined();
    expect(result.current.page).toBe(1);
  });

  it('ignores a null cursor and a duplicate push', () => {
    const { result } = renderHook(() => useCursorTable('scope-a'));
    act(() => result.current.push(null));
    expect(result.current.page).toBe(1);

    act(() => result.current.push('cursor-1'));
    act(() => result.current.push('cursor-1'));
    expect(result.current.page).toBe(2);
  });

  it('resets the stack when the scope changes', () => {
    const { result, rerender } = renderHook(({ scope }) => useCursorTable(scope), {
      initialProps: { scope: 'scope-a' },
    });
    act(() => result.current.push('cursor-1'));
    expect(result.current.cursor).toBe('cursor-1');

    rerender({ scope: 'scope-b' });
    expect(result.current.cursor).toBeUndefined();
    expect(result.current.canPrev).toBe(false);
  });

  it('resets the stack when the page size changes but keeps the choice', () => {
    const { result } = renderHook(() => useCursorTable('scope-a'));
    expect(result.current.pageSize).toBe(TABLE_DEFAULT_PAGE_SIZE);

    act(() => result.current.push('cursor-1'));
    act(() => result.current.setPageSize(50));
    expect(result.current.pageSize).toBe(50);
    expect(result.current.cursor).toBeUndefined();
  });

  it('falls back to the default for an unoffered page size', () => {
    const { result } = renderHook(() => useCursorTable('scope-a'));
    act(() => result.current.setPageSize(7));
    expect(result.current.pageSize).toBe(TABLE_DEFAULT_PAGE_SIZE);
  });
});

describe('pageRange', () => {
  it('describes the rows actually returned', () => {
    expect(pageRange(1, 10, 10)).toEqual({ from: 1, to: 10 });
    expect(pageRange(3, 10, 10)).toEqual({ from: 21, to: 30 });
    expect(pageRange(3, 10, 4)).toEqual({ from: 21, to: 24 });
    expect(pageRange(1, 10, 0)).toEqual({ from: 0, to: 0 });
  });
});
