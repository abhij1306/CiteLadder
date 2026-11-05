'use client';

import { useId, type ComponentProps, type CSSProperties, type ReactNode } from 'react';

import { BusyBar } from '@/components/ui/progress-bar';
import { cardClasses } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { FilterBar, type FilterBarProps } from '@/components/ui/filter-bar';
import { Pager } from '@/components/ui/pager';
import { TABLE_PAGE_SIZE_OPTIONS } from '@/lib/config/tables';
import { QueryState, type QueryStateProps } from '@/components/ui/query-state';
import { HintedTableHead, SortableTableHead } from '@/components/ui/table-heads';
import {
  Table,
  TableBody,
  TableCell,
  TableCellLines,
  TableFillerRows,
  TableHead,
  TableHeader,
  TableRow,
  TableTextLinesContext,
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
  /** A row's ordinal on the page (#, rank). */
  index: 'w-12',
  /** A count, a rate or a short figure. */
  figure: 'w-28',
  /**
   * A figure whose header names its unit ("AI referral sessions", "Longest
   * receipt gap"): the figure role is too narrow for the label.
   */
  metric: 'w-40',
  /** A status badge or a short label. */
  status: 'w-32',
  /** A category badge longer than a status ("Striking distance", a purpose). */
  category: 'w-44',
  /** A date or a date-time. */
  date: 'w-40',
  /** A second text column beside the flexible one (an engine, a role). */
  name: 'w-56',
  /** A row's trailing link or icon control. */
  action: 'w-24',
  /** A row's trailing buttons, up to two (`TableActionsCell`). */
  rowActions: 'w-64',
} as const;

type DataTableColumnWidth = keyof typeof COLUMN_WIDTH;

export type DataTableColumn = Readonly<{
  key: string;
  label: string;
  width?: DataTableColumnWidth;
  /** Centred figures, digits in the figure face, header included. */
  numeric?: boolean;
  /** Trailing row controls (`TableActionsCell`): the header ends on their edge. */
  trailing?: boolean;
  /** Keep the header for assistive technology only (an actions column). */
  hideLabel?: boolean;
  /** A sortable column: the header becomes the sort button. */
  sort?: Readonly<{ active: boolean; descending: boolean; onSort: () => void }>;
  /** A qualifier under the label, e.g. the comparison window. */
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
 * Row selection: a leading checkbox column whose header box selects every
 * row on the page. Each row's first cell is a `TableSelectCell`.
 */
export type DataTableSelection = Readonly<{
  /** Every row selected, some, or none. */
  all: boolean | 'indeterminate';
  onAllChange: (checked: boolean) => void;
  /** What the rows are, for the header box's name: "Select all {noun}". */
  noun: string;
}>;

/**
 * DataTable — the record table organism: a header, the rows, the pager and
 * the read's states, in one card with one geometry.
 *
 *   header — the table's title and its toolbar (`FilterBar`: search, filters,
 *            status, actions) on one row, 49px with the hairline that closes
 *            it — the page's control band, repeated in the card, flush with
 *            the card's top edge (the band's own 8px is the inset). A table's
 *            filters live here, never in a toolbar the page builds. A
 *            `description` is one caption line under that row, so the row
 *            itself keeps its height.
 *   rows   — `Table` laid out fixed from the columns' width roles, at the one
 *            36px row. A paged table passes `pageSize` and `rowCount`: while
 *            the rows run past one page, a short last page is padded with
 *            blank rows, so the pager never moves between pages. Every row
 *            of a paged table is exactly `rowLines` tall: its text is cut to
 *            that many lines (the rest in a tooltip), so a page of long
 *            values is no taller than a page of short ones. Rows of two
 *            lines (`rowLines={2}`, cells on `TableCellLines`) are padded
 *            with two-line blanks. A fixed list with `pageSize` and no
 *            pager (top movers) always reserves its rows.
 *   pager  — the shared `Pager`, framed as the table's footer, drawn only
 *            while the rows run past one page: a table that fits on one page
 *            has no pager and no blank rows.
 *   state  — loading, read-error and empty render INSIDE the table body,
 *            under the same header row, in the footprint of a full page of
 *            rows while the table is paged (else the query-state height).
 *
 * Inside a box that already frames it (a card holding other content, a
 * dialog's preview of parsed rows) the table is `nested`: the same header,
 * rows and pager without a card of its own.
 *
 * The page passes data, columns and rows; it sets no geometry.
 */
export function DataTable({
  title,
  description,
  toolbar,
  columns,
  children,
  rowCount,
  pageSize,
  rowLines = 1,
  state,
  pager,
  busy,
  minWidth,
  pinFirstColumn = false,
  selection,
  nested = false,
  footer,
  label,
  reserveRows = false,
}: Readonly<{
  /** The table's heading (an h3, the card title rung). */
  title?: string;
  /** One caption line under the title row: what the figures are. */
  description?: ReactNode;
  toolbar?: FilterBarProps;
  columns: readonly DataTableColumn[];
  /** The page's `TableRow`s. Ignored while `state` is set. */
  children?: ReactNode;
  /** Rows on this page; with `pageSize`, the short last page is padded. */
  rowCount?: number;
  /** Rows per page: the footprint reserved for rows and for every state. */
  pageSize?: number;
  /** Lines per row: 2 when every row stacks a caption under its value. */
  rowLines?: 1 | 2;
  /** What to show instead of rows. */
  state?: DataTableState;
  pager?: DataTablePager;
  /** A background refetch while the current rows stay on screen. */
  busy?: Readonly<{ active: boolean; label: string }>;
  minWidth?: TableMinWidth;
  /**
   * Keep the first column (the row's identity) in view while a wide table
   * scrolls sideways in its frame.
   */
  pinFirstColumn?: boolean;
  selection?: DataTableSelection;
  /** Inside a box that already frames it: no card of its own. */
  nested?: boolean;
  /** A note under the table (e.g. a truncation notice). */
  footer?: ReactNode;
  /** The table's accessible name when it has no visible title. */
  label?: string;
  /**
   * One of several views of the same table (its tabs or filters): keep the
   * pager and a full page of rows even when this view fits on one page, so
   * switching views never moves what follows (2026-11-03 app review).
   */
  reserveRows?: boolean;
}>) {
  const headingId = useId();
  const colSpan = columns.length + (selection ? 1 : 0);
  const paging = pagingLayout(pager, pageSize, reserveRows);
  const fit = FITS[nested ? 'nested' : 'card'];
  // The region and the table share one name: the visible title, else `label`.
  const naming = title
    ? { ariaLabelledBy: headingId, ariaLabel: undefined }
    : { ariaLabelledBy: undefined, ariaLabel: label };
  return (
    <section
      aria-labelledby={naming.ariaLabelledBy}
      aria-label={naming.ariaLabel}
      aria-busy={busy?.active || undefined}
      data-data-table=""
      className={cn(fit, 'relative grid min-w-0 content-start gap-4')}
    >
      {busy ? <BusyBar active={busy.active} label={busy.label} /> : null}
      <DataTableHeader title={title} headingId={headingId} toolbar={toolbar} />
      {description ? (
        <p data-data-table-description="" className="text-caption text-ink-muted">
          {description}
        </p>
      ) : null}
      <Table
        fixed
        minWidth={minWidth}
        {...naming}
        className={cn(pinFirstColumn && PINNED_FIRST_COLUMN)}
      >
        <DataTableColumns columns={columns} selection={selection} />
        <TableTextLinesContext value={pager || pageSize !== undefined ? rowLines : 2}>
          <DataTableBody
            colSpan={colSpan}
            state={state}
            pageSize={paging.pageSize}
            rowCount={rowCount}
            rowLines={rowLines}
          >
            {children}
          </DataTableBody>
        </TableTextLinesContext>
      </Table>
      <DataTableFoot footer={footer} pager={paging.pager} />
    </section>
  );
}

/**
 * The foot: the note (source, period or row count) on the left, the Pager on
 * the right, one control tall; nothing when there is neither.
 */
function DataTableFoot({
  footer,
  pager,
}: Readonly<{ footer: ReactNode; pager: DataTablePager | undefined }>) {
  if (!pager && !footer) return null;
  return (
    <div className="flex min-h-[var(--control-md)] min-w-0 flex-wrap items-center justify-between gap-4">
      {footer ? <div className="type-caption grid min-w-0 gap-1">{footer}</div> : null}
      {pager ? (
        <div className="ms-auto min-w-0">
          <Pager {...pager} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Whether the rows run past one page: another page either way, or (with a
 * rows-per-page select) more rows than the smallest page holds, so a reader on
 * a bigger page can still step back down. A table that fits on one page shows
 * no pager and no blank rows (owner, 2026-10-21).
 *
 * A reader who picked a bigger page keeps the pager even when everything now
 * fits on it and no exact total exists: the select they just used must not
 * vanish from under the pointer and strand them on the bigger page.
 */
function hasMorePages(pager: DataTablePager): boolean {
  if (pager.canPrev || pager.canNext) return true;
  if (pager.pageSize === undefined) return false;
  const smallest = Math.min(...TABLE_PAGE_SIZE_OPTIONS);
  if (pager.pageSize.value > smallest) return true;
  const total = pager.range?.total;
  return total !== undefined && total > smallest;
}

/**
 * The pager to draw and the page of rows to reserve. A fixed list with no
 * pager (top movers), and a view that shares its footprint with its sibling
 * views (`reserveRows`), keep their reserved rows.
 */
function pagingLayout(
  pager: DataTablePager | undefined,
  pageSize: number | undefined,
  reserveRows: boolean,
): { pager?: DataTablePager; pageSize?: number } {
  if (pager === undefined) return { pageSize };
  return reserveRows || hasMorePages(pager) ? { pager, pageSize } : {};
}

/**
 * The system's TableCard: the table sits inside the card's 24 inset, 16 below
 * the title row and 16 above the pager and footnote. Inside a box that
 * already frames it, there is no card of its own.
 */
const FITS = { card: cardClasses(), nested: undefined } as const;

/** The first column stays in view while a wide table scrolls in its frame. */
const PINNED_FIRST_COLUMN =
  '[&_tr>:first-child]:sticky [&_tr>:first-child]:left-0 [&_tbody_tr>:first-child]:z-10 [&_tbody_tr>:first-child]:bg-surface [&_thead_tr>:first-child]:z-20';

/** The column widths and the header row, with the select-all column first. */
function DataTableColumns({
  columns,
  selection,
}: Readonly<{ columns: readonly DataTableColumn[]; selection?: DataTableSelection }>) {
  return (
    <>
      <colgroup>
        {selection ? <col className="w-10" /> : null}
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
          {selection ? <SelectAllHead selection={selection} /> : null}
          {columns.map((column) => (
            <ColumnHead key={column.key} column={column} />
          ))}
        </TableRow>
      </TableHeader>
    </>
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
      className="flex min-h-[var(--control-md)] min-w-0 flex-wrap items-center gap-x-4 gap-y-2"
    >
      {title ? (
        <h3 id={headingId} className={textRole('itemTitle', 'min-w-0 truncate')}>
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
  rowLines,
  children,
}: Readonly<{
  colSpan: number;
  state?: DataTableState;
  pageSize?: number;
  rowCount?: number;
  rowLines: 1 | 2;
  children?: ReactNode;
}>) {
  if (state) {
    return (
      <TableBody>
        <tr data-table-state="">
          <TableCell
            colSpan={colSpan}
            className="h-[max(var(--query-state-height),calc(var(--data-table-rows)*var(--data-table-row)))] align-top"
            style={
              {
                '--data-table-rows': pageSize ?? 0,
                '--data-table-row': ROW_HEIGHT[rowLines],
              } as CSSProperties
            }
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
      <TableFillerRows
        count={filler}
        colSpan={colSpan}
        spacer={rowLines === 2 ? <TableCellLines primary={BLANK} secondary={BLANK} /> : null}
      />
    </TableBody>
  );
}

/**
 * A row's height by its lines, so a state holds exactly a page of rows: one
 * line sits on the row floor; two lines are a body line over a caption line
 * between the cell's padding (`TableCellLines`).
 */
const ROW_HEIGHT = {
  1: 'var(--table-row-height)',
  2: 'calc(2*var(--table-cell-padding-y)+var(--text-body-sm--line-height)+var(--text-caption--line-height))',
} as const;

/** A non-breaking space: a blank line that still takes a line's height. */
const BLANK = ' ';

function SelectAllHead({ selection }: Readonly<{ selection: DataTableSelection }>) {
  return (
    <TableHead>
      <Checkbox
        aria-label={`Select all ${selection.noun}`}
        checked={selection.all}
        onCheckedChange={(checked) => selection.onAllChange(checked === true)}
      />
    </TableHead>
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
  // The columns are fixed, so a label longer than its role wraps under
  // itself instead of painting over the next header.
  return (
    <TableHead
      numeric={column.numeric}
      trailing={column.trailing}
      desktopOnly={column.desktopOnly}
      className="whitespace-normal"
    >
      {column.hideLabel ? <span className="sr-only">{column.label}</span> : column.label}
      {column.sublabel ? (
        <span className={textRole('caption', 'block truncate')} title={column.sublabel}>
          {column.sublabel}
        </span>
      ) : null}
    </TableHead>
  );
}
