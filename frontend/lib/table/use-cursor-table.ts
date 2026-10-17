'use client';

import { useCallback, useState } from 'react';

import { TABLE_DEFAULT_PAGE_SIZE, type TablePageSize, isTablePageSize } from '@/lib/config/tables';

/**
 * Keyset pagination state for a cursor-paged table: the cursor stack, the
 * rows-per-page selection, and the reset rule that keeps them honest.
 *
 * A keyset cursor is only meaningful against the exact result set it was cut
 * from. The backend binds every cursor to a fingerprint (project, snapshot,
 * tab, sort, page size) and REFUSES a replay against a different one, so the
 * client must drop its stack the moment any of those change — otherwise the
 * next page request is a guaranteed 400 rather than a page of rows.
 *
 * `scopeKey` is that fingerprint. Pass every value the server binds into it;
 * when it changes the stack resets to page one and the page-size selection is
 * preserved (a reader who chose 100 rows keeps 100 rows across tabs).
 *
 * Unlike an offset pager there is no page count to clamp to: `canNext` is
 * driven purely by whether the server returned a continuation cursor, so a
 * background refetch can never strand the reader past the end.
 */
export function useCursorTable(scopeKey: string) {
  const [stack, setStack] = useState<readonly string[]>([]);
  const [pageSizeState, setPageSizeState] = useState<TablePageSize>(TABLE_DEFAULT_PAGE_SIZE);
  // The scope the current stack was cut against, held as STATE so the reset
  // below is React's "adjust state during render" pattern rather than a ref
  // read. An effect would let one paint go out with the previous scope's
  // cursor still applied — exactly the request the server rejects.
  const [stackScope, setStackScope] = useState(scopeKey);
  if (stackScope !== scopeKey) {
    setStackScope(scopeKey);
    if (stack.length) setStack([]);
  }

  const cursor = stack.at(-1);
  const canPrev = stack.length > 0;
  const page = stack.length + 1;

  const push = useCallback((nextCursor: string | null) => {
    if (!nextCursor) return;
    // Idempotent: under rapid clicks the captured cursor may already be on
    // the stack before the rerender lands, and a duplicate push would skip a
    // page rather than advance one.
    setStack((prev) => (prev.at(-1) === nextCursor ? prev : [...prev, nextCursor]));
  }, []);

  const pop = useCallback(() => setStack((prev) => prev.slice(0, -1)), []);
  const reset = useCallback(() => setStack([]), []);

  const setPageSize = useCallback((value: number) => {
    // A different page size cuts different cursors, so the stack cannot
    // survive the change.
    setPageSizeState(isTablePageSize(value) ? value : TABLE_DEFAULT_PAGE_SIZE);
    setStack([]);
  }, []);

  return { cursor, canPrev, page, pageSize: pageSizeState, push, pop, reset, setPageSize };
}

/**
 * The `Pager` step handlers for a cursor table: back pops the stack, forward
 * pushes the server's continuation cursor, and there is a next page only when
 * the server returned one.
 */
export function cursorControls(
  pager: Pick<ReturnType<typeof useCursorTable>, 'canPrev' | 'pop' | 'push'>,
  nextCursor: string | null | undefined,
) {
  return {
    canPrev: pager.canPrev,
    canNext: Boolean(nextCursor),
    onPrev: pager.pop,
    onNext: () => pager.push(nextCursor ?? null),
  };
}

/**
 * The one-based row range this page covers, for the footer's "1–10 of 412".
 *
 * Derived from the page position and the rows actually returned, so the last
 * page reads honestly (`411–412`) instead of assuming a full page. `total` of
 * zero yields `0–0`, and a table whose exact total is unavailable renders the
 * range alone.
 */
export function pageRange(page: number, pageSize: number, rowCount: number) {
  if (rowCount === 0) return { from: 0, to: 0 };
  const from = (page - 1) * pageSize + 1;
  return { from, to: from + rowCount - 1 };
}
