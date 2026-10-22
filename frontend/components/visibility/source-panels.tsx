'use client';

import type { DataTablePager } from '@/components/ui/data-table';
import { setUrlParams } from '@/lib/navigation/url-state';
import type { SourcesData } from '@/lib/visibility/sources';

/**
 * The source table's pager: server keyset cursors in both directions, with
 * the rows-per-page control. The displayed offset only labels the current
 * page; it never drives SQL.
 *
 * It is built with no data too. The pager stays mounted for the duration of
 * every load, so the rows-per-page control and the steps never leave the
 * screen and the table never shortens by the height of its footer.
 */
export function sourcePager({
  data,
  domain,
  dimension,
  offset,
  pageSize,
  busy,
  onPageSizeChange,
}: Readonly<{
  data?: SourcesData;
  domain: string | null;
  dimension: 'domain' | 'url';
  offset: number;
  pageSize: number;
  busy: boolean;
  onPageSizeChange: (value: number) => void;
}>): DataTablePager {
  const total = data?.total ?? 0;
  const from = !data || total === 0 ? 0 : offset + 1;
  const to = data ? Math.min(total, offset + data.items.length) : 0;
  return {
    range: {
      from,
      to,
      total: data ? total : undefined,
      noun: dimension === 'url' || domain ? 'URLs' : 'domains',
    },
    pageSize: { value: pageSize, onChange: onPageSizeChange },
    canPrev: data?.previous_cursor != null,
    canNext: data?.next_cursor != null,
    busy,
    onPrev: () => {
      if (!data?.previous_cursor) return;
      const nextOffset = Math.max(0, offset - pageSize);
      setUrlParams({
        source_offset: nextOffset ? String(nextOffset) : null,
        source_cursor: data.previous_cursor,
        source_as_of: nextOffset ? (data.as_of ?? null) : null,
      });
    },
    onNext: () => {
      if (data?.next_cursor == null) return;
      setUrlParams({
        source_offset: String(offset + pageSize),
        source_cursor: data.next_cursor,
        source_as_of: data.as_of ?? null,
      });
    },
  };
}
