'use client';

import { useQuery, type QueryKey, type UseQueryOptions } from '@tanstack/react-query';

import type { DataTablePager, DataTableState } from '@/components/ui/data-table';
import { readErrorProps } from '@/components/ui/read-error';
import { retainPreviousDataForScope } from '@/lib/api/query-client';
import { cursorControls, pageRange, useCursorTable } from './use-cursor-table';

/** A keyset page as the API returns it. */
type CursorPage = Readonly<{ items: readonly unknown[]; next_cursor: string | null }>;

/** What one page of a cursor table asks the server for. */
type CursorPageRequest = Readonly<{ cursor: string | undefined; limit: number }>;

/** The `DataTable` props a cursor table read decides. Spread them onto the table. */
type CursorTableProps = Readonly<{
  pageSize: number;
  rowCount: number | undefined;
  state: DataTableState | undefined;
  busy: Readonly<{ active: boolean; label: string }>;
  pager: DataTablePager | undefined;
}>;

type CursorTableQueryOptions<TPage extends CursorPage, TKey extends QueryKey> = Readonly<{
  /**
   * The active workspace. Rows carry over only inside it; the query key holds
   * it as one of its top-level parts.
   */
  workspaceId: string;
  /**
   * The project (or crawl) the rows belong to. Rows carry over to the next
   * page or filter only inside it too; the query key holds it at index 2.
   */
  scopeId: string;
  /**
   * Every other value the server binds the cursor to (filters, sort). A
   * change drops the cursor stack back to page one.
   */
  scope: unknown;
  /** The read for one page; the hook supplies its cursor and limit. */
  query: (request: CursorPageRequest) => UseQueryOptions<TPage, Error, TPage, TKey>;
  /** What the rows are, for the pager's range ("1–10 crawlers"). */
  noun: string;
  loading: string;
  /** The message when a failed read carries none of its own. */
  error: string;
  /** What a settled page with no rows says. */
  empty: (page: TPage) => DataTableState;
  /**
   * A page size the server caps below the rows-per-page options. Without it
   * the reader chooses the size.
   */
  fixedPageSize?: number;
}>;

/**
 * One cursor-paged table read: the cursor stack, the page query, and the
 * `DataTable` props that keep the table still while it pages.
 *
 * A page turn or a filter change keeps the current rows and the pager on
 * screen behind the busy bar until the next rows land, instead of dropping
 * the table for a loading state; the first load, an error and an empty page
 * render inside the table in the footprint of a full page of rows.
 */
export function useCursorTableQuery<TPage extends CursorPage, TKey extends QueryKey>({
  workspaceId,
  scopeId,
  scope,
  query: pageQuery,
  noun,
  loading,
  error,
  empty,
  fixedPageSize,
}: CursorTableQueryOptions<TPage, TKey>) {
  const cursor = useCursorTable(JSON.stringify([workspaceId, scopeId, scope]));
  const pageSize = fixedPageSize ?? cursor.pageSize;
  const query = useQuery({
    ...pageQuery({ cursor: cursor.cursor, limit: pageSize }),
    // Another workspace's rows never stand in for this one's, even under the
    // same project id: a workspace switch draws the loading state.
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.queryKey.includes(workspaceId)
        ? retainPreviousDataForScope(scopeId, previousData, previousQuery)
        : undefined,
  });
  const page = query.data;
  let state: DataTableState | undefined;
  if (query.isPending) state = { kind: 'loading', label: loading };
  else if (query.isError) state = { kind: 'error', ...readErrorProps(query), fallback: error };
  else if (query.data.items.length === 0) state = empty(query.data);
  const table: CursorTableProps = {
    pageSize,
    rowCount: page?.items.length,
    state,
    busy: { active: query.isFetching && !query.isPending, label: loading },
    pager:
      page && (page.items.length > 0 || cursor.canPrev)
        ? {
            range: { ...pageRange(cursor.page, pageSize, page.items.length), noun },
            pageSize:
              fixedPageSize === undefined
                ? { value: cursor.pageSize, onChange: cursor.setPageSize }
                : undefined,
            ...cursorControls(cursor, page.next_cursor),
            busy: query.isFetching,
          }
        : undefined,
  };
  return { query, page, cursor, table };
}
