import { useEffect } from 'react';

import { Checkbox } from '@/components/ui/checkbox';
import { HintedTableHead, SortableTableHead } from '@/components/ui/table-heads';
import { TableHead, TableHeader, TableRow } from '@/components/ui/table';
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
   * A short figure in a table that shares its row with another card, so its
   * name column keeps room: a one-word header ("Rank", "Change"), or a short
   * one that wraps to two lines ("Share of voice").
   */
  short: 'w-20',
  /** As `short`, for a header of three words that wraps to two lines ("Owned citation rate"). */
  shortMetric: 'w-24',
  /**
   * A figure whose header names its unit ("AI referral sessions", "Longest
   * receipt gap"): the figure role is too narrow for the label.
   */
  metric: 'w-40',
  /** A status badge or a short label. */
  status: 'w-32',
  /** A status badge and its short label on one line ("Medium · Web fundamentals"). */
  statusLabel: 'w-64',
  /** A category badge longer than a status ("Striking distance", a purpose). */
  category: 'w-44',
  /** A date or a date-time. */
  date: 'w-40',
  /** A second text column beside the flexible one (an engine, a role). */
  name: 'w-56',
  /** A row's trailing link or icon control. */
  action: 'w-24',
  /** One compact control under a one-word header ("Enabled", "Actions"). */
  control: 'w-20',
  /** A row's trailing buttons, up to two (`TableActionsCell`). */
  rowActions: 'w-64',
} as const;

type DataTableColumnWidth = keyof typeof COLUMN_WIDTH;

/** The widths that grow with the table: the flexible text column and the lead. */
const FLEXIBLE_WIDTHS: ReadonlySet<DataTableColumnWidth> = new Set(['flex', 'lead']);

export type DataTableColumn = Readonly<{
  key: string;
  label: string;
  width?: DataTableColumnWidth;
  /** Right-aligned figures in tabular digits, header included. */
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

/** Column sets already warned about, so a table re-rendering warns once. */
const warnedColumnSets = new Set<string>();

/**
 * Development only: a table whose every column is a fixed role cuts its text
 * while the fixed columns leave width unused. Give the text column `flex`
 * (the default) or `lead`.
 */
export function useFlexibleColumnCheck({
  columns,
  title,
  label,
}: Readonly<{ columns: readonly DataTableColumn[]; title?: string; label?: string }>) {
  useEffect(() => {
    if (!import.meta.env?.DEV) return;
    if (columns.some((column) => FLEXIBLE_WIDTHS.has(column.width ?? 'flex'))) return;
    const name = title ?? label ?? columns.map((column) => column.label).join(', ');
    const widths = columns.map((column) => `${column.key}:${column.width}`).join(',');
    const signature = `${name}|${widths}`;
    if (warnedColumnSets.has(signature)) return;
    warnedColumnSets.add(signature);
    console.warn(
      `DataTable "${name}" has no flexible column (width "flex" or "lead"): its text truncates while its fixed columns leave space unused.`,
    );
  }, [columns, title, label]);
}

/** The column widths and the header row, with the select-all column first. */
export function DataTableColumns({
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
