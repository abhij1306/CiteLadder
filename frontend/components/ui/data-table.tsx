'use client';

import { useId, type ComponentProps, type CSSProperties, type ReactNode } from 'react';

import { BusyBar } from '@/components/ui/busy-bar';
import { cardClasses } from '@/components/ui/card-variants';
import { FilterBar, type FilterBarProps } from '@/components/ui/filter-bar';
import { Pager } from '@/components/ui/pager';
import { QueryState, type QueryStateProps } from '@/components/ui/query-state';
import {
  HintedTableHead,
  SortableTableHead,
  Table,
  TableBody,
  TableCell,
  TableFillerRows,
  TableHead,
  TableHeader,
  TableRow,
  type TableMinWidth,
} from '@/components/ui/table';
import { textRole } from '@/components/ui/typography';
import { cn } from '@/lib/utils';

/**
 * A column's width, by what the column holds — never a number a page picks.
 * The table is laid out fixed from these, so paging, filtering or a long
 * value never moves a column. `flex` takes what the others leave; give it to
 * the one text column that should absorb the width.
 */
const COLUMN_WIDTH = {
  flex: '',
  /**
   * The record's identity (a source, a page) in a table whose other columns
   * are flexible figures: a quarter of the table, so the figures share the
   * rest evenly whatever the viewport.
   */
  lead: 'w-1/4',
  /** A row's ordinal on the page (#). */
  index: 'w-12',
  /** A count, a rate or a short figure. */
  figure: 'w-28',
  /** A status badge or a short label. */
  status: 'w-32',
  /** A date or a date-time. */
  date: 'w-40',
  /** A second text column beside the flexible one (an engine, a role). */
  name: 'w-56',
  /** A row's trailing link or icon control. */
  action: 'w-24',
} as const;

type DataTableColumnWidth = keyof typeof COLUMN_WIDTH;

export type DataTableColumn = Readonly<{
  key: string;
  label: string;
  width?: DataTableColumnWidth;
  numeric?: boolean | 'end';
  /** Keep the header for assistive technology only (an actions column). */
  hideLabel?: boolean;
  /** A sortable column: the header becomes the sort button. */
  sort?: Readonly<{ active: boolean; descending: boolean; onSort: () => void }>;
  /** A qualifier under a sortable label, e.g. the comparison window. */
  sublabel?: string;
  /** The column's shared caveat, behind a tooltip on the header. */
  hint?: string;
  /**
   * The narrow layout drops this column; the page's cells for it pass
   * `desktopOnly` to `TableCell` too.
   */
  desktopOnly?: boolean;
}>;

/** A table read's state when it has no rows to show: loading, error or empty. */
export type DataTableState = Exclude<QueryStateProps, { inline: true }>;

export type DataTablePager = Omit<ComponentProps<typeof Pager>, 'frame' | 'className'>;

/**
 * DataTable — the record table organism: a header, the rows, the pager and
 * the read's states, in one card with one geometry.
 *
 *   header — the table's title and its toolbar (`FilterBar`: search, filters,
 *            status, actions) on one row, 49px with the hairline that closes
 *            it — the page's control band, repeated in the card. A table's
 *            filters live here, never in a toolbar the page builds.
 *   rows   — `Table` laid out fixed from the columns' width roles, at the one
 *            36px row. A paged table passes `pageSize` and `rowCount`: a short
 *            last page is padded with blank rows, so the pager never moves.
 *   pager  — the shared `Pager`, framed as the table's footer.
 *   state  — loading, read-error and empty render INSIDE the table body,
 *            under the same header row, in the footprint of a full page of
 *            rows (or the query-state height when the table is not paged).
 *            A filter that empties the table therefore moves nothing.
 *
 * The page passes data, columns and rows; it sets no geometry.
 */
export function DataTable({
  title,
  toolbar,
  columns,
  children,
  rowCount,
  pageSize,
  state,
  pager,
  busy,
  minWidth,
  footer,
  label,
}: Readonly<{
  /** The table's heading (an h3, the card title rung). */
  title?: string;
  toolbar?: FilterBarProps;
  columns: readonly DataTableColumn[];
  /** The page's `TableRow`s. Ignored while `state` is set. */
  children?: ReactNode;
  /** Rows on this page; with `pageSize`, the short last page is padded. */
  rowCount?: number;
  /** Rows per page: the footprint reserved for rows and for every state. */
  pageSize?: number;
  /** What to show instead of rows. */
  state?: DataTableState;
  pager?: DataTablePager;
  /** A background refetch while the current rows stay on screen. */
  busy?: Readonly<{ active: boolean; label: string }>;
  minWidth?: TableMinWidth;
  /** A note under the table (e.g. a truncation notice). */
  footer?: ReactNode;
  /** The table's accessible name when it has no visible title. */
  label?: string;
}>) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={title ? headingId : undefined}
      aria-label={title ? undefined : label}
      aria-busy={busy?.active || undefined}
      data-data-table=""
      className={cn(cardClasses(), 'relative grid min-w-0 content-start')}
    >
      {busy ? <BusyBar active={busy.active} label={busy.label} /> : null}
      <DataTableHeader title={title} headingId={headingId} toolbar={toolbar} />
      <Table fixed minWidth={minWidth}>
        <colgroup>
          {columns.map((column) => (
            <col
              key={column.key}
              className={cn(
                COLUMN_WIDTH[column.width ?? 'flex'],
                column.desktopOnly && 'hidden desktop:table-column',
              )}
            />
          ))}
        </colgroup>
        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <ColumnHead key={column.key} column={column} />
            ))}
          </TableRow>
        </TableHeader>
        <DataTableBody
          colSpan={columns.length}
          state={state}
          pageSize={pageSize}
          rowCount={rowCount}
        >
          {children}
        </DataTableBody>
      </Table>
      {pager ? <Pager frame="table" {...pager} /> : null}
      {footer ? (
        <div className="type-caption border-border-subtle grid gap-1 border-t px-[var(--table-cell-padding-x)] py-2">
          {footer}
        </div>
      ) : null}
    </section>
  );
}

function DataTableHeader({
  title,
  headingId,
  toolbar,
}: Readonly<{ title?: string; headingId: string; toolbar?: FilterBarProps }>) {
  if (!title && !toolbar) return null;
  return (
    <header
      data-data-table-header=""
      className="border-border-subtle flex min-h-[var(--data-table-header-height)] min-w-0 flex-wrap items-center gap-x-4 border-b"
    >
      {title ? (
        <h3 id={headingId} className={textRole('sectionTitle', 'min-w-0 truncate')}>
          {title}
        </h3>
      ) : null}
      {toolbar ? (
        <div className="min-w-0 flex-1">
          <FilterBar {...toolbar} />
        </div>
      ) : null}
    </header>
  );
}

/**
 * The rows, padded to a full page, or the read's state in the footprint of
 * that page (never shorter than the query-state height).
 */
function DataTableBody({
  colSpan,
  state,
  pageSize,
  rowCount,
  children,
}: Readonly<{
  colSpan: number;
  state?: DataTableState;
  pageSize?: number;
  rowCount?: number;
  children?: ReactNode;
}>) {
  if (state) {
    return (
      <TableBody>
        <tr data-table-state="">
          <TableCell
            colSpan={colSpan}
            className="h-[max(var(--query-state-height),calc(var(--data-table-rows)*var(--table-row-height)))] align-top"
            style={{ '--data-table-rows': pageSize ?? 0 } as CSSProperties}
          >
            <QueryState {...state} />
          </TableCell>
        </tr>
      </TableBody>
    );
  }
  const filler = pageSize === undefined || rowCount === undefined ? 0 : pageSize - rowCount;
  return (
    <TableBody>
      {children}
      <TableFillerRows count={filler} colSpan={colSpan} />
    </TableBody>
  );
}

function ColumnHead({ column }: Readonly<{ column: DataTableColumn }>) {
  if (column.sort) {
    return (
      <SortableTableHead
        label={column.label}
        numeric={column.numeric}
        sublabel={column.sublabel}
        hint={column.hint}
        desktopOnly={column.desktopOnly}
        {...column.sort}
      />
    );
  }
  if (column.hint) {
    return (
      <HintedTableHead
        label={column.label}
        hint={column.hint}
        numeric={column.numeric}
        desktopOnly={column.desktopOnly}
      />
    );
  }
  return (
    <TableHead numeric={column.numeric} desktopOnly={column.desktopOnly}>
      {column.hideLabel ? <span className="sr-only">{column.label}</span> : column.label}
    </TableHead>
  );
}
