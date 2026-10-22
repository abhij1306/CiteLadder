'use client';

import { BrandLogo } from '@/components/ui/brand-logo';
import { QueryState } from '@/components/ui/query-state';
import { Skeleton } from '@/components/ui/skeleton';
import { ClampText, TableCell, TableRow } from '@/components/ui/table';
import { MissingValue } from '@/components/ui/unavailable-value';
import { textRole } from '@/components/ui/typography';
import { engineLabel } from '@/lib/providers/catalog';
import type { SortState, SourcesData } from '@/lib/visibility/sources';

/** The source's own mark and name, with the favicon a reader recognises first. */
export function SourceName({
  name,
  host,
  secondary,
}: Readonly<{ name: string; host: string | null; secondary?: string | null }>) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <BrandLogo name={name} websiteUrl={host ? `https://${host}` : null} />
      <span className="grid min-w-0">
        <ClampText lines={secondary ? 1 : 2}>{name}</ClampText>
        {secondary ? (
          <ClampText lines={1} className={textRole('caption', 'text-secondary')}>
            {secondary}
          </ClampText>
        ) : null}
      </span>
    </span>
  );
}

/**
 * A numeric cell that marks an absent value rather than spelling it out.
 *
 * The formatters answer `null` for "nothing to show"; deciding what that MEANS
 * is the table's job, and every numeric column here means the same thing by it.
 * The reason is said once, on the column header, instead of once per row --
 * see `MissingValue` for why the mark is not simply blank.
 */
export function NumericCell({
  value,
  className,
}: Readonly<{ value: string | null; className?: string }>) {
  return (
    <TableCell numeric className={className}>
      {value ?? <MissingValue />}
    </TableCell>
  );
}

/**
 * A Retrieved cell. Null means no answer in the selection exposed what it
 * read, which is "Unavailable", never a read of zero.
 */
export function RetrievedCell({
  value,
  className,
}: Readonly<{ value: string | null; className?: string }>) {
  return (
    <TableCell numeric className={className}>
      {value ?? (
        <MissingValue
          state="unavailable"
          reason="No answer in this selection exposes the pages it read."
        />
      )}
    </TableCell>
  );
}

/** The Retrieved header's explanation, naming the engines whose reads are unknown. */
export function retrievedHint(base: string, retrieval: SourcesData['retrieval'] | undefined) {
  const unavailable = retrieval?.unavailable_engines ?? [];
  if (!unavailable.length) return base;
  return `${base} Not available for ${unavailable.map(engineLabel).join(', ')}, which do not expose the pages they read.`;
}

/**
 * What a table shows INSTEAD of rows, without giving up its own structure.
 *
 * The states used to replace the whole table: a 160px skeleton, or a single
 * sentence, where ten 44px rows had been. That is a ~320px collapse on every
 * filter change, and the reader watched the page jump under the control they
 * had just clicked. Filling the existing `<tbody>` keeps the header, the
 * column widths and the footer exactly where they were.
 */
export type SourceTableState =
  | { kind: 'rows' }
  | { kind: 'loading'; rows: number }
  | { kind: 'empty'; message: string };

export function StateRows({
  state,
  columns,
}: Readonly<{
  state: Exclude<SourceTableState, { kind: 'rows' }>;
  columns: readonly string[];
}>) {
  if (state.kind === 'loading') {
    return (
      <>
        {Array.from({ length: state.rows }, (_, row) => (
          <TableRow key={`loading-${row}`}>
            {columns.map((columnClass, cell) => (
              <TableCell
                key={cell} // NOSONAR -- placeholder cells of a fixed column layout; the column position is the identity
                className={columnClass || undefined}
              >
                <Skeleton className="h-4 w-full" />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </>
    );
  }
  return (
    <TableRow>
      <TableCell colSpan={columns.length}>
        <QueryState kind="empty" inline message={state.message} />
      </TableCell>
    </TableRow>
  );
}

/** One sortable column's header state, from the table's single sort. */
export function sortProps(sort: SortState, onSort: (column: string) => void, column: string) {
  return {
    active: sort?.column === column,
    descending: sort?.direction === 'desc',
    onSort: () => onSort(column),
  };
}
