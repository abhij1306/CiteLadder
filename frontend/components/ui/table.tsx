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
 * Table — the app's data table:
 *  - the header is a sticky 36px `surface-sunken` band with `radius-sm` ends;
 *    its labels are 12/16 medium `ink-secondary`, `ink` while sorted
 *  - `table-row-height` rows (40 in the app) divided by `line` rules, `surface-sunken` on hover and when
 *    selected; `highlight` tints the tracked brand's own row `accent-soft`
 *    (one row per table, never for emphasis); no zebra stripes, no column
 *    rules, no colour by status (that is a Badge cell)
 *  - text never runs past two lines: `ClampText` cuts it there and moves the
 *    rest into a tooltip, so a row is one line or two, never an outlier
 *  - numeric columns align right in tabular figures, under a right-aligned
 *    header, so digits line up place by place; text columns stay left
 *  - `fixed` takes column widths from the header cells, never from the rows
 *    shown, so paging, sorting and loading never move the columns
 * The wrapper scrolls, so the sticky header pins on vertical scroll. On the
 * page its boundary is the `table-frame` hairline ring (an outer shadow, so it
 * never changes the box); inside a Card the ring drops.
 */
const tableHeadClasses = 'text-caption text-ink-secondary font-medium whitespace-nowrap';
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
        'table-frame bg-surface relative w-full max-w-full min-w-0 overflow-auto rounded-lg',
        wrapperClassName,
      )}
    >
      <table
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        className={cn(
          'text-body-sm text-ink w-full border-separate border-spacing-0',
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
        'hover:bg-surface-sunken h-[var(--table-row-height)] transition-colors duration-[var(--motion-fast)]',
        // A selected row takes `surface-sunken`; the tracked brand's own row
        // takes `accent-soft`, and hover never changes it.
        'aria-selected:bg-surface-sunken',
        highlight && 'bg-accent-soft hover:bg-accent-soft',
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
        'aria-[sort=ascending]:text-ink aria-[sort=descending]:text-ink',
        // The header is a `surface-sunken` band with rounded ends; its opaque
        // fill keeps a sticky header over scrolled rows.
        'bg-surface-sunken sticky top-0 z-10 h-[var(--table-header-height)] px-[var(--table-cell-padding-x)] text-left align-middle first:rounded-l-sm last:rounded-r-sm',
        numeric && 'tabular-nums text-right',
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

/**
 * The lines a `TableCellLines` title takes: one by default; two in a
 * `DataTable` of three-line rows (`rowLines={3}`), where a long title (a
 * prompt) wraps over its caption instead of being cut at one line. The
 * title then always holds two lines, so every row keeps one height.
 */
export const TableTitleLinesContext = createContext<1 | 2>(1);

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
    'text-body-sm text-ink border-line px-[var(--table-cell-padding-x)] pt-[var(--table-cell-padding-y)] pb-[var(--table-cell-padding-bottom)] text-left align-middle',
    // Row rule, dropped on the last row.
    'border-b [tr:last-child>&]:border-b-0',
    // A value never wraps: "Not measured" split over two lines read as two values.
    // Tabular figures, so a right-aligned column lines up place by place.
    numeric && 'whitespace-nowrap text-right tabular-nums',
    desktopOnly && desktopOnlyClasses,
  );

/**
 * A missing figure (which renders the `Not measured` placeholder) reads muted;
 * a measured one keeps the cell's ink. A score is a figure, not a state, so it
 * never takes a band colour.
 */
export const mutedWhenMissing = (value: number | null) =>
  value === null ? 'text-ink-muted' : undefined;

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
  const titleLines = useContext(TableTitleLinesContext);
  return (
    <span className="grid min-w-0">
      <ClampText
        lines={titleLines}
        className={cn(title ? textRole('itemTitle') : undefined, titleLines === 2 && 'min-h-[2lh]')}
      >
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
