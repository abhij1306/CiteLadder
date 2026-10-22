import {
  useState,
  type HTMLAttributes,
  type ReactNode,
  type Ref,
  type TdHTMLAttributes,
  type ThHTMLAttributes,
} from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';

import { Checkbox } from '@/components/ui/checkbox';
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
  ariaLabel,
  ariaLabelledBy,
}: Readonly<{
  children: ReactNode;
  className?: string;
  /** The table's accessible name, when no visible heading names it. */
  ariaLabel?: string;
  /** The visible heading that names the table. */
  ariaLabelledBy?: string;
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
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
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

/**
 * A column the narrow layout drops: secondary figures a phone has no width
 * for. The header and every cell of the column carry it, so the column
 * disappears whole.
 */
const desktopOnlyClasses = 'hidden desktop:table-cell';

type CellOptions = { numeric?: boolean | 'end'; desktopOnly?: boolean };

export function TableHead({
  children,
  className,
  numeric,
  desktopOnly,
  ...props
}: Readonly<ThHTMLAttributes<HTMLTableCellElement> & CellOptions>) {
  return (
    <th
      {...props}
      className={cn(
        tableHeadClasses,
        'aria-[sort=ascending]:text-foreground aria-[sort=descending]:text-foreground',
        'border-border bg-panel-tonal sticky top-0 z-10 h-[var(--table-header-height)] border-b px-[var(--table-cell-padding-x)] text-left align-middle',
        numeric && 'tabular-nums',
        numeric === 'end' ? 'text-right' : numeric && 'text-center',
        desktopOnly && desktopOnlyClasses,
        className,
      )}
    >
      {children}
    </th>
  );
}

/**
 * A plain column label with the column's shared caveat behind a tooltip —
 * the unsortable twin of `SortableTableHead`'s `hint`. A shared reason is
 * said once, on the header, rather than once per cell that lacks a value.
 */
export function HintedTableHead({
  label,
  hint,
  numeric,
  desktopOnly,
}: Readonly<{ label: string; hint: string } & CellOptions>) {
  return (
    <TableHead numeric={numeric} desktopOnly={desktopOnly}>
      <Tooltip content={hint}>
        <button type="button" className="focus-ring cursor-default rounded-xs">
          {label}
        </button>
      </Tooltip>
    </TableHead>
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

const cellClasses = ({ numeric, desktopOnly }: CellOptions) =>
  cn(
    'type-body text-foreground border-border-subtle px-[var(--table-cell-padding-x)] py-[var(--table-cell-padding-y)] text-left align-middle',
    // Row rule, dropped on the last row.
    'border-b [tr:last-child>&]:border-b-0',
    // A value never wraps: "Not measured" split over two lines read as two values.
    numeric && 'whitespace-nowrap tabular-nums',
    numeric === 'end' ? 'text-right' : numeric && 'text-center',
    desktopOnly && desktopOnlyClasses,
  );

export function TableCell({
  children,
  className,
  numeric,
  desktopOnly,
  nested,
  ...props
}: Readonly<
  TdHTMLAttributes<HTMLTableCellElement> &
    CellOptions & {
      /** The first cell of a row grouped under a group-label row: inset one step. */
      nested?: boolean;
    }
>) {
  return (
    <td
      {...props}
      className={cn(
        cellClasses({ numeric, desktopOnly }),
        nested && 'ps-[calc(var(--table-cell-padding-x)+16px)]',
        className,
      )}
    >
      {!numeric && isPlainText(children) ? <ClampText>{children}</ClampText> : children}
    </td>
  );
}

/**
 * A value over one caption line (a query over its page), each cut to one line
 * with the rest in a tooltip. `title` inks the value as an item title; a blank
 * `secondary` (a non-breaking space) keeps a captionless row two lines tall.
 */
export function TableCellLines({
  primary,
  secondary,
  secondaryTooltip,
  title = false,
}: Readonly<{
  primary: ReactNode;
  secondary?: ReactNode;
  /** The caption's tooltip when it is cut, e.g. the full URL behind a path. */
  secondaryTooltip?: ReactNode;
  title?: boolean;
}>) {
  return (
    <span className="grid min-w-0">
      <ClampText lines={1} className={title ? textRole('itemTitle') : undefined}>
        {primary}
      </ClampText>
      {secondary ? (
        <ClampText lines={1} tooltip={secondaryTooltip} className={textRole('caption')}>
          {secondary}
        </ClampText>
      ) : null}
    </span>
  );
}

/** A row's trailing buttons, end-aligned at the button gap (`rowActions` column). */
export function TableActionsCell({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <td className={cn(cellClasses({}), 'whitespace-nowrap')}>
      <span className="flex items-center justify-end gap-2">{children}</span>
    </td>
  );
}

/** A selectable row's first cell: its checkbox, named for the row ("Select …"). */
export function TableSelectCell({
  label,
  describedBy,
  checked,
  onCheckedChange,
  disabled,
}: Readonly<{
  label: string;
  /** The id of a fact the row shows (its status) that describes the box. */
  describedBy?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}>) {
  return (
    <td className={cellClasses({})}>
      <Checkbox
        aria-label={label}
        aria-describedby={describedBy}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(next) => onCheckedChange(next === true)}
      />
    </td>
  );
}

/**
 * The cell that names its row (`<th scope="row">`): a cell's geometry with
 * the item-title ink, so a row header reads as the row's title.
 */
export function TableRowHeader({
  children,
  className,
}: Readonly<{ children: ReactNode; className?: string }>) {
  return (
    <th scope="row" className={cn(cellClasses({}), 'type-item-title', className)}>
      {isPlainText(children) ? <ClampText>{children}</ClampText> : children}
    </th>
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
  desktopOnly,
  className,
}: Readonly<{
  desktopOnly?: boolean;
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
    <TableHead
      numeric={numeric}
      desktopOnly={desktopOnly}
      aria-sort={ariaSort}
      className={className}
    >
      {hint ? <Tooltip content={hint}>{button}</Tooltip> : button}
    </TableHead>
  );
}
