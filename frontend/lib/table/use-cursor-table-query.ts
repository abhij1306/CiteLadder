import { useQuery, type QueryKey, type UseQueryOptions } from '@tanstack/react-query';

import type { DataTablePager, DataTableState } from '@/components/ui/data-table';
import { cursorControls, pageRange, useCursorTable } from './use-cursor-table';
import { readErrorProps } from '@/components/ui/notice';
import { READ_FAILED } from '@/components/ui/state-block';

type CursorPage = Readonly<{ items: readonly unknown[]; next_cursor: string | null }>;

type CursorPageRequest = Readonly<{ cursor: string | undefined; limit: number }>;

type CursorTableProps = Readonly<{
  pageSize: number;
  rowCount: number | undefined;
  state: DataTableState | undefined;
  busy: Readonly<{ active: boolean; label: string }>;
  pager: DataTablePager | undefined;
}>;

type CursorTableQueryOptions<TPage extends CursorPage, TKey extends QueryKey> = Readonly<{
  workspaceId: string | null;
  scopeId: string | readonly [string, ...string[]];
  scope: unknown;
  query: (request: CursorPageRequest) => UseQueryOptions<TPage, Error, TPage, TKey>;
  noun: string;
  loading: string;
  subject: string;
  empty: (page: TPage) => DataTableState;
  fixedPageSize?: number;
  enabled?: boolean;
  total?: (page: TPage | undefined) => number | undefined;
}>;

export function useCursorTableQuery<TPage extends CursorPage, TKey extends QueryKey>({
  workspaceId,
  scopeId,
  scope,
  query: pageQuery,
  noun,
  loading,
  subject,
  empty,
  fixedPageSize,
  enabled = true,
  total: totalOf,
}: CursorTableQueryOptions<TPage, TKey>) {
  const cursor = useCursorTable(JSON.stringify([workspaceId, scopeId, scope]));
  const pageSize = fixedPageSize ?? cursor.pageSize;
  const query = useQuery({
    ...pageQuery({ cursor: cursor.cursor, limit: pageSize }),
    enabled: enabled && workspaceId !== null,
    placeholderData: (previousData, previousQuery) => {
      const key = previousQuery?.queryKey;
      const ids = typeof scopeId === 'string' ? [scopeId] : scopeId;
      return workspaceId !== null &&
        key?.includes(workspaceId) &&
        ids.every((id) => key.includes(id))
        ? previousData
        : undefined;
    },
  });
  const page = query.data;
  let state: DataTableState | undefined;
  if (query.isPending) state = { kind: 'loading', label: loading };
  else if (query.isError)
    state = {
      kind: 'error',
      ...readErrorProps(query),
      title: `Couldn't load ${subject}`,
      fallback: READ_FAILED,
    };
  else if (query.data.items.length === 0) state = empty(query.data);
  const total = totalOf?.(page);
  const table: CursorTableProps = {
    pageSize,
    rowCount: page?.items.length,
    state,
    busy: { active: query.isFetching && !query.isPending, label: loading },
    pager:
      total !== undefined || (page && (page.items.length > 0 || cursor.canPrev))
        ? {
            range: {
              ...pageRange(
                cursor.page,
                pageSize,
                shownRows({ query, total, page: cursor.page, pageSize }),
              ),
              total,
              noun,
            },
            pageSize:
              fixedPageSize === undefined
                ? { value: cursor.pageSize, onChange: cursor.setPageSize }
                : undefined,
            ...cursorControls(cursor, page?.next_cursor),
            busy: query.isFetching,
          }
        : undefined,
  };
  return { query, page, cursor, table };
}

function shownRows({
  query,
  total,
  page,
  pageSize,
}: Readonly<{
  query: Readonly<{ data: CursorPage | undefined; isPlaceholderData: boolean }>;
  total: number | undefined;
  page: number;
  pageSize: number;
}>): number {
  const rows = query.data?.items.length ?? 0;
  if (total === undefined || (query.data && !query.isPlaceholderData)) return rows;
  return Math.max(0, Math.min(pageSize, total - (page - 1) * pageSize));
}
