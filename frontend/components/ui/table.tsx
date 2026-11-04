import {
  createContext,
  useContext,
  useState,
  type HTMLAttributes,
  type ReactNode,
  type Ref,
  type TdHTMLAttributes,
  type ThHTMLAttributes,
} from 'react';

import { Checkbox } from '@/components/ui/checkbox';
import { Tooltip } from '@/components/ui/tooltip';
import { textRole } from '@/components/ui/typography';
import { cn } from '@/lib/utils';

/**
 * Dense analytics table — the shared semantic ledger treatment:
 *  - the wrapper is the table's shell: the elevated panel fill at the card
 *    radius, borderless, so a bare table reads as a card the way a Card does
 *  - sticky header (--table-header-height) on the panel itself, no fill band,
 *    with a single object-rung under-rule, so the labels separate from the
 *    rows by the hairline alone; no vertical column-separator hairlines, which
 *    made the tables read as spreadsheets rather than designed surfaces
 *  - one row rhythm everywhere: --table-row-height is the floor, every cell
 *    carries the same --table-cell-padding-y, and text never runs past two
 *    lines — `ClampText` cuts it there and moves the rest into a tooltip, so
 *    a row is either one line or two, never a three-line outlier
 *  - --text-sm cells, subtle ROW hairlines only
 *  - data columns are centred and tabular, so digits line up place by place
 *    under a header centred on the same axis (owner, 2026-11-01); text
 *    columns stay left
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
        'hover:bg-hover active:bg-active h-[var(--table-row-height)] transition-colors',
        // A selected or highlighted row keeps the card's fill and takes a 2px
        // accent bar at its first cell's start (rows cannot position a mark
        // in every engine) and the foreground ink: no fill block.
        "[&>*:first-child]:relative aria-selected:text-foreground aria-selected:[&>*:first-child]:after:bg-accent aria-selected:[&>*:first-child]:after:absolute aria-selected:[&>*:first-child]:after:inset-y-0 aria-selected:[&>*:first-child]:after:start-0 aria-selected:[&>*:first-child]:after:w-0.5 aria-selected:[&>*:first-child]:after:content-['']",
        highlight &&
          "text-foreground [&>*:first-child]:after:bg-accent [&>*:first-child]:after:absolute [&>*:first-child]:after:inset-y-0 [&>*:first-child]:after:start-0 [&>*:first-child]:after:w-0.5 [&>*:first-child]:after:content-['']",
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

type CellOptions = { numeric?: boolean; desktopOnly?: boolean };

export function TableHead({
  children,
  className,
  numeric,
  trailing,
  desktopOnly,
  ...props
}: Readonly<
  ThHTMLAttributes<HTMLTableCellElement> &
    CellOptions & {
      /** Heads a `TableActionsCell` column: ends on the controls' edge. */
      trailing?: boolean;
    }
>) {
  return (
    <th
      {...props}
      className={cn(
        tableHeadClasses,
        'aria-[sort=ascending]:text-foreground aria-[sort=descending]:text-foreground',
        // The header row sits on the table's own paper (owner, 2026-11-01): a
        // tinted header matched the selected-row tint. Its rule separates it,
        // and the opaque fill keeps a sticky header over scrolled rows.
        'border-border-subtle bg-panel sticky top-0 z-10 h-[var(--table-header-height)] border-b px-[var(--table-cell-padding-x)] text-left align-middle',
        numeric && 'tabular-nums text-center',
        trailing && 'text-right',
        desktopOnly && desktopOnlyClasses,
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

/**
 * How many lines a row's text may take before `ClampText` cuts it. Two by
 * default; a paged `DataTable` of one-line rows sets one, because its blank
 * rows and its pager's position assume every row is exactly one row tall — a
 * page whose long queries wrapped to two lines was taller than the next page,
 * so the pager and everything below it moved on every page turn.
 */
export const TableTextLinesContext = createContext<1 | 2>(2);

function isCut(node: HTMLElement) {
  return node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1;
}

/**
 * Text cut at `lines` (two by default, one for a title or URL stacked over a
 * second line), with the whole text in a tooltip only when something was
 * actually cut. This is what holds every row to one or two lines.
 *
 * Measuring is lazy: the text is measured only as its tooltip is about to
 * open, so a table of hundreds of cells costs no layout reads at rest. The
 * tooltip is always mounted, so it opens and closes through the shared atom
 * and only one is ever open.
 *
 * `tooltip` overrides the tooltip content, e.g. a full URL behind a label.
 */
export function ClampText({
  children,
  lines: requestedLines,
  tooltip,
  className,
}: Readonly<{
  children: ReactNode;
  /** Defaults to the table's text lines (`TableTextLinesContext`). */
  lines?: 1 | 2;
  tooltip?: ReactNode;
  className?: string;
}>) {
  const tableLines = useContext(TableTextLinesContext);
  const lines = requestedLines ?? tableLines;
  // The full text as plain text: styled children (a title role, a caption)
  // would carry their own ink onto the inverse tooltip chip.
  const [fullText, setFullText] = useState('');
  const openWhenCut = (node: HTMLElement) => {
    if (!isCut(node)) return false;
    setFullText(node.textContent ?? '');
    return true;
  };
  return (
    <Tooltip content={tooltip ?? fullText} shouldOpen={openWhenCut}>
      <span
        className={cn(
          'block min-w-0 break-words',
          lines === 1 ? 'truncate' : 'line-clamp-2',
          className,
        )}
      >
        {children}
      </span>
    </Tooltip>
  );
}

const cellClasses = ({ numeric, desktopOnly }: CellOptions) =>
  cn(
    'type-body text-foreground border-border-subtle px-[var(--table-cell-padding-x)] py-[var(--table-cell-padding-y)] text-left align-middle',
    // Row rule, dropped on the last row.
    'border-b [tr:last-child>&]:border-b-0',
    // A value never wraps: "Not measured" split over two lines read as two values.
    // Its digits take the figure face, so a column lines up place by place.
    numeric && 'whitespace-nowrap font-numeric text-center',
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
