import {
  useState,
  type HTMLAttributes,
  type ReactNode,
  type Ref,
  type TdHTMLAttributes,
  type ThHTMLAttributes,
} from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';

import { Tooltip } from '@/components/ui/tooltip';
import { textRole } from '@/components/ui/typography';
import { cn } from '@/lib/utils';

/**
 * Dense analytics table — the shared semantic ledger treatment:
 *  - the wrapper is the table's shell: the elevated panel fill at the card
 *    radius, borderless, so a bare table reads as a card the way a Card does
 *  - sticky header (--table-header-height) on a tonal panel fill with a
 *    single object-rung under-rule, so the labels separate from the rows by
 *    the hairline alone; no vertical column-separator hairlines, which made
 *    the tables read as spreadsheets rather than designed surfaces
 *  - one row rhythm everywhere: --table-row-height is the floor, every cell
 *    carries the same --table-cell-padding-y, and text never runs past two
 *    lines — `ClampText` cuts it there and moves the rest into a tooltip, so
 *    a row is either one line or two, never a three-line outlier
 *  - --text-sm cells, subtle ROW hairlines only
 *  - data columns are centre-aligned and tabular; text columns stay left.
 *    The header centres with its values, so a column reads as one block
 *    rather than a label floating off the numbers beneath it
 *  - hover uses the surface's hover tint; `highlight` uses the distinct
 *    selected tint for the user's own row
 * The wrapper is scroll-capable so the sticky header pins on vertical scroll;
 * the scroll clip also keeps the pinned header inside the shell's radius. On
 * the white workspace sheet its boundary is the `table-frame` hairline ring
 * (an outer shadow, so it never changes the box); inside a Card the ring drops
 * and the flush fill melts into the card.
 *
 * Column headers take the `label` role (14/20, 500, secondary): a header names the
 * values beneath it, exactly as a metric label does.
 */
const tableHeadClasses = 'type-label whitespace-nowrap';
const TABLE_MIN_WIDTH = {
  sm: 'min-w-[var(--table-min-width-sm)]',
  md: 'min-w-[var(--table-min-width-md)]',
  lg: 'min-w-[var(--table-min-width-lg)]',
  xl: 'min-w-[var(--table-min-width-xl)]',
} as const;

export type TableMinWidth = keyof typeof TABLE_MIN_WIDTH;

export function Table({
  children,
  className,
  minWidth,
  fixed = false,
  wrapperClassName,
  wrapperRef,
}: Readonly<{
  children: ReactNode;
  className?: string;
  /** Below this width the table scrolls in its frame instead of squeezing. */
  minWidth?: TableMinWidth;
  /**
   * Column widths come from the header cells' widths, never from the rows
   * shown, so paging or filtering cannot shift the columns. Give every
   * header but one (the flexible text column) an explicit width.
   */
  fixed?: boolean;
  wrapperClassName?: string;
  wrapperRef?: Ref<HTMLDivElement>;
}>) {
  return (
    <div
      ref={wrapperRef}
      className={cn(
        'table-frame bg-panel relative w-full max-w-full min-w-0 overflow-auto rounded-[var(--radius-card)]',
        wrapperClassName,
      )}
    >
      <table
        className={cn(
          'type-body w-full border-collapse',
          fixed && 'table-fixed',
          minWidth && TABLE_MIN_WIDTH[minWidth],
          className,
        )}
      >
        {children}
      </table>
    </div>
  );
}

export function TableHeader({
  children,
  className,
  ...props
}: Readonly<HTMLAttributes<HTMLTableSectionElement>>) {
  return (
    <thead {...props} className={cn(className)}>
      {children}
    </thead>
  );
}

export function TableBody({
  children,
  className,
  ...props
}: Readonly<HTMLAttributes<HTMLTableSectionElement>>) {
  return (
    <tbody {...props} className={cn(className)}>
      {children}
    </tbody>
  );
}

export function TableRow({
  children,
  className,
  highlight,
  ...props
}: Readonly<HTMLAttributes<HTMLTableRowElement> & { highlight?: boolean }>) {
  return (
    <tr
      {...props}
      className={cn(
        'hover:bg-hover active:bg-active aria-selected:bg-selected aria-selected:hover:bg-selected h-[var(--table-row-height)] transition-colors',
        highlight && 'bg-selected hover:bg-selected',
        className,
      )}
    >
      {children}
    </tr>
  );
}

/**
 * Blank rows that hold a paged table at a full page's height, so a short last
 * page does not pull the pager up. Hidden from assistive technology. When
 * real rows are taller than the row floor, pass `spacer`: blank content laid
 * out like a real row's tallest cell, so a filler row matches its height.
 */
export function TableFillerRows({
  count,
  colSpan,
  spacer,
}: Readonly<{ count: number; colSpan: number; spacer?: ReactNode }>) {
  return Array.from({ length: Math.max(0, count) }, (_, index) => (
    <tr
      key={index}
      aria-hidden="true" // NOSONAR -- a blank filler row with no tabIndex or controls; nothing in it is focusable
      className="h-[var(--table-row-height)]"
    >
      <TableCell colSpan={colSpan}>{spacer}</TableCell>
    </tr>
  ));
}

export function TableHead({
  children,
  className,
  numeric,
  ...props
}: Readonly<ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean | 'end' }>) {
  return (
    <th
      {...props}
      className={cn(
        tableHeadClasses,
        'aria-[sort=ascending]:text-foreground aria-[sort=descending]:text-foreground',
        'border-border bg-panel-tonal sticky top-0 z-10 h-[var(--table-header-height)] border-b px-[var(--table-cell-padding-x)] text-left align-middle',
        numeric && 'tabular-nums',
        numeric === 'end' ? 'text-right' : numeric && 'text-center',
        className,
      )}
    >
      {children}
    </th>
  );
}

/** Plain text content — the cells `TableCell` clamps on its own. */
function isPlainText(children: ReactNode) {
  if (typeof children === 'string' || typeof children === 'number') return true;
  return (
    Array.isArray(children) &&
    children.length > 0 &&
    children.every((part) => typeof part === 'string' || typeof part === 'number')
  );
}

function isCut(node: HTMLElement) {
  return node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1;
}

/**
 * Text cut at `lines` (two by default, one for a title or URL stacked over a
 * second line), with the whole text in a tooltip only when something was
 * actually cut. This is what holds every row to one or two lines.
 *
 * Measuring is lazy: nothing is observed until a pointer or focus reaches the
 * text, so a table of hundreds of cells costs no layout reads at rest. The
 * tooltip mounts open on that first reach and behaves normally afterwards.
 *
 * `tooltip` overrides the tooltip content, e.g. a full URL behind a label.
 */
export function ClampText({
  children,
  lines = 2,
  tooltip,
  className,
}: Readonly<{
  children: ReactNode;
  lines?: 1 | 2;
  tooltip?: ReactNode;
  className?: string;
}>) {
  // The full text as plain text: styled children (a title role, a caption)
  // would carry their own ink onto the inverse tooltip chip.
  const [fullText, setFullText] = useState<string | null>(null);
  const check =
    fullText === null
      ? (event: { currentTarget: HTMLElement }) => {
          if (isCut(event.currentTarget)) setFullText(event.currentTarget.textContent ?? '');
        }
      : undefined;
  const text = (
    <span
      onPointerEnter={check}
      onFocus={check}
      className={cn(
        'block min-w-0 break-words',
        lines === 1 ? 'truncate' : 'line-clamp-2',
        className,
      )}
    >
      {children}
    </span>
  );
  return fullText === null ? (
    text
  ) : (
    <Tooltip content={tooltip ?? fullText} defaultOpen>
      {text}
    </Tooltip>
  );
}

export function TableCell({
  children,
  className,
  numeric,
  ...props
}: Readonly<TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean | 'end' }>) {
  return (
    <td
      {...props}
      className={cn(
        'type-body text-foreground border-border-subtle px-[var(--table-cell-padding-x)] py-[var(--table-cell-padding-y)] text-left align-middle',
        // Row rule, dropped on the last row.
        'border-b [tr:last-child>&]:border-b-0',
        // A value never wraps: "Not measured" split over two lines read as two values.
        numeric && 'whitespace-nowrap tabular-nums',
        numeric === 'end' ? 'text-right' : numeric && 'text-center',
        className,
      )}
    >
      {!numeric && isPlainText(children) ? <ClampText>{children}</ClampText> : children}
    </td>
  );
}

/** Numeric table cell that becomes a labelled key/value row below `md`. */
export function TableRecordMetricCell({
  children,
  className,
  label,
  ...props
}: Readonly<Omit<TdHTMLAttributes<HTMLTableCellElement>, 'data-label'> & { label: string }>) {
  return (
    <TableCell
      {...props}
      numeric
      data-label={label}
      className={cn(
        'grid grid-cols-[1fr_auto] gap-3 border-b-0 px-4 py-1 type-label-before before:text-left before:content-[attr(data-label)]',
        'desktop:table-cell desktop:border-b desktop:px-[var(--table-cell-padding-x)] desktop:py-[var(--table-cell-padding-y)] desktop:before:hidden',
        className,
      )}
    >
      {children}
    </TableCell>
  );
}

/** The header aligns with its column's values, as `TableHead` does. */
const SORT_ALIGN = {
  start: { column: 'items-start', row: 'justify-start text-left' },
  center: { column: 'items-center', row: 'justify-center text-center' },
  end: { column: 'items-end', row: 'justify-end text-right' },
} as const;

/**
 * A sortable column header: a real button inside the `th`, `aria-sort` on the
 * `th` (it describes the column, and that is where a screen reader looks for
 * it), the glyph after the label.
 *
 * The active column takes primary ink (the header row's own `aria-sort` rule)
 * and the glyph is muted until active. The
 * button's name is the visible label (plus the sublabel when present), so it
 * is pressed with Enter or Space like any other button.
 */
export function SortableTableHead({
  label,
  active,
  descending,
  onSort,
  numeric,
  sublabel,
  hint,
  className,
}: Readonly<{
  label: string;
  /** This column is the current sort key. */
  active: boolean;
  /** The current order; read only when `active`. */
  descending: boolean;
  onSort: () => void;
  numeric?: boolean | 'end';
  /** A qualifier under the label, e.g. the comparison window. */
  sublabel?: string;
  /** The column's shared caveat, behind a tooltip on the header. */
  hint?: string;
  className?: string;
}>) {
  // An inactive column has no order: no `aria-sort` and the neutral glyph, so
  // the announcement and the arrow can never drift apart.
  let ariaSort: 'ascending' | 'descending' | undefined;
  let Icon = ArrowUpDown;
  if (active) {
    ariaSort = descending ? 'descending' : 'ascending';
    Icon = descending ? ArrowDown : ArrowUp;
  }
  let align: (typeof SORT_ALIGN)[keyof typeof SORT_ALIGN] = SORT_ALIGN.start;
  if (numeric === 'end') align = SORT_ALIGN.end;
  else if (numeric) align = SORT_ALIGN.center;
  const button = (
    <button
      type="button"
      onClick={onSort}
      className={cn(
        'focus-ring inline-flex w-full flex-col gap-0.5 rounded-xs transition-colors',
        align.column,
        !active && 'hover:text-foreground',
      )}
    >
      <span className={cn('inline-flex w-full items-center gap-1', align.row)}>
        <span className="truncate">{label}</span>
        <Icon className={cn('size-3 shrink-0', !active && 'text-muted')} aria-hidden />
      </span>
      {sublabel ? (
        <span className={textRole('caption', 'max-w-full truncate')} title={sublabel}>
          {sublabel}
        </span>
      ) : null}
    </button>
  );
  return (
    <TableHead numeric={numeric} aria-sort={ariaSort} className={className}>
      {hint ? <Tooltip content={hint}>{button}</Tooltip> : button}
    </TableHead>
  );
}
