import { useCallback, useState } from 'react';

import { TABLE_DEFAULT_PAGE_SIZE, type TablePageSize, isTablePageSize } from '@/lib/config/tables';

export function useCursorTable(scopeKey: string) {
  const [stack, setStack] = useState<readonly string[]>([]);
  const [pageSizeState, setPageSizeState] = useState<TablePageSize>(TABLE_DEFAULT_PAGE_SIZE);
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
    setStack((prev) => (prev.at(-1) === nextCursor ? prev : [...prev, nextCursor]));
  }, []);

  const pop = useCallback(() => setStack((prev) => prev.slice(0, -1)), []);
  const reset = useCallback(() => setStack([]), []);

  const setPageSize = useCallback((value: number) => {
    setPageSizeState(isTablePageSize(value) ? value : TABLE_DEFAULT_PAGE_SIZE);
    setStack([]);
  }, []);

  return { cursor, canPrev, page, pageSize: pageSizeState, push, pop, reset, setPageSize };
}

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

export function pageRange(page: number, pageSize: number, rowCount: number) {
  if (rowCount === 0) return { from: 0, to: 0 };
  const from = (page - 1) * pageSize + 1;
  return { from, to: from + rowCount - 1 };
}
