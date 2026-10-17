'use client';

import { Pager } from '@/components/ui/pager';
import { setUrlParams } from '@/lib/navigation/url-state';
import type { SourcesData } from '@/lib/visibility/sources';

/**
 * The shared table footer uses server keyset cursors in both directions.
 * The displayed offset only labels the current page; it never drives SQL.
 */
export function SourcePaging({
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
}>) {
  // The footer stays MOUNTED with no data. Unmounting it took the rows-per-page
  // control and the pager off the screen for the duration of every load, which
  // shortened the card by the height of the whole bar and moved everything
  // under it -- twice per interaction, once out and once back.
  const total = data?.total ?? 0;
  const from = !data || total === 0 ? 0 : offset + 1;
  const to = data ? Math.min(total, offset + data.items.length) : 0;
  return (
    <Pager
      frame="table"
      range={{
        from,
        to,
        total: data ? total : undefined,
        noun: dimension === 'url' || domain ? 'URLs' : 'domains',
      }}
      pageSize={{ value: pageSize, onChange: onPageSizeChange }}
      canPrev={data?.previous_cursor != null}
      canNext={data?.next_cursor != null}
      busy={busy}
      onPrev={() => {
        if (!data?.previous_cursor) return;
        const nextOffset = Math.max(0, offset - pageSize);
        setUrlParams({
          source_offset: nextOffset ? String(nextOffset) : null,
          source_cursor: data.previous_cursor,
          source_as_of: nextOffset ? (data.as_of ?? null) : null,
        });
      }}
      onNext={() => {
        if (data?.next_cursor == null) return;
        setUrlParams({
          source_offset: String(offset + pageSize),
          source_cursor: data.next_cursor,
          source_as_of: data.as_of ?? null,
        });
      }}
    />
  );
}
