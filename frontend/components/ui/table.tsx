import {
  useRef,
  type HTMLAttributes,
  type MouseEvent,
  type ReactNode,
  type Ref,
  type TdHTMLAttributes,
  type ThHTMLAttributes,
} from 'react';

import { Absence } from '@/components/ui/absence';
import { Checkbox } from '@/components/ui/checkbox';
import { ClampText, UrlCutParts, useCut } from '@/components/ui/clamp-text';
import type { ScrollRegionProps } from '@/components/ui/scroll-edges';
import { Tag } from '@/components/ui/tag';
import { isTextCut, Tooltip } from '@/components/ui/tooltip';
import { textRole } from '@/components/ui/typography';
import { useDisplayTimeZone } from '@/lib/display-timezone';
import {
  type Absent,
  formatDisplayTimestamp,
  isAbsent,
  readableUrl,
  urlCellText,
} from '@/lib/format';
import { cn } from '@/lib/utils';

import './table-phone.css';

const tableHeadClasses = 'text-caption text-ink-2 whitespace-nowrap';
export function Table({
  children,
  className,
  fixed = false,
  wrapperClassName,
  wrapperRef,
  region,
  ariaLabel,
  ariaLabelledBy,
}: Readonly<{
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  fixed?: boolean;
  wrapperClassName?: string;
  wrapperRef?: Ref<HTMLDivElement>;
  region?: ScrollRegionProps;
}>) {
  return (
    <div
      {...region}
      ref={wrapperRef}
      className={cn(
        'table-frame bg-surface relative w-full max-w-full min-w-0 overflow-auto rounded-card',
        wrapperClassName,
      )}
    >
      <table
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        className={cn(
          'text-body-sm text-ink w-full border-separate border-spacing-0',
          fixed && 'table-fixed',
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
  const pressable = props.onClick !== undefined;
  return (
    <tr
      {...props}
      data-pressable={pressable || undefined}
      className={cn(
        'h-[var(--table-row-height)] transition-colors duration-[var(--motion-fast)]',
        pressable &&
          !highlight &&
          '[[data-public-surface]_&]:not-aria-selected:hover:overlay-hover',
        '[[data-public-surface]_&]:aria-selected:overlay-selected',
        highlight && '[[data-public-surface]_&]:bg-accent-wash',
        className,
      )}
      data-you={highlight || undefined}
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
  desktopOnly,
  scope = 'col',
  ...props
}: Readonly<ThHTMLAttributes<HTMLTableCellElement> & CellOptions>) {
  return (
    <th
      scope={scope}
      {...props}
      className={cn(
        tableHeadClasses,
        'aria-[sort=ascending]:text-ink aria-[sort=descending]:text-ink',
        'bg-well sticky top-0 z-10 h-[var(--table-header-height)] px-[var(--table-cell-padding-x)] text-left align-middle',
        numeric && 'tabular-nums text-right',
        desktopOnly && desktopOnlyClasses,
        className,
      )}
    >
      {children}
    </th>
  );
}

function isPlainText(children: ReactNode) {
  if (typeof children === 'string' || typeof children === 'number') return true;
  return (
    Array.isArray(children) &&
    children.length > 0 &&
    children.every((part) => typeof part === 'string' || typeof part === 'number')
  );
}

const cellClasses = ({ numeric, desktopOnly }: CellOptions) =>
  cn(
    'text-body-sm text-ink px-[var(--table-cell-padding-x)] py-[var(--table-cell-padding-y)] text-left align-middle',
    numeric && 'whitespace-nowrap text-right tabular-nums',
    desktopOnly && desktopOnlyClasses,
  );

function CellContent({
  children,
  numeric,
}: Readonly<{ children: ReactNode | Absent; numeric?: boolean }>) {
  if (isAbsent(children)) return <Absence state={children.absent} />;
  return !numeric && isPlainText(children) ? <ClampText>{children}</ClampText> : children;
}

export const mutedWhenMissing = (value: number | null) =>
  value === null ? 'text-ink-2' : undefined;

export function TableCell({
  children,
  className,
  numeric,
  desktopOnly,
  nested,
  ...props
}: Readonly<
  Omit<TdHTMLAttributes<HTMLTableCellElement>, 'children'> &
    CellOptions & {
      children?: ReactNode | Absent;
      nested?: boolean | 2;
    }
>) {
  return (
    <td
      {...props}
      className={cn(
        cellClasses({ numeric, desktopOnly }),
        nested === true && 'ps-[calc(var(--table-cell-padding-x)+16px)]',
        nested === 2 && 'ps-[calc(var(--table-cell-padding-x)+32px)]',
        className,
      )}
    >
      <CellContent numeric={numeric}>{children}</CellContent>
    </td>
  );
}

export function TableCellLines({
  primary,
  secondary,
  secondaryTooltip,
  title = false,
}: Readonly<{
  primary: ReactNode;
  secondary?: ReactNode;
  secondaryTooltip?: ReactNode;
  title?: boolean;
}>) {
  return (
    <span data-cell-lines="" className="flex min-w-0 items-baseline gap-2">
      <ClampText rowTitle className={cn('max-w-full shrink-0', title && textRole('body'))}>
        {primary}
      </ClampText>
      {secondary ? (
        <ClampText tooltip={secondaryTooltip} className="text-ink-2">
          {secondary}
        </ClampText>
      ) : null}
    </span>
  );
}

export function YouTag() {
  return <Tag className="text-ink font-medium">You</Tag>;
}

export function isRowSurfaceClick(event: MouseEvent<HTMLTableRowElement>): boolean {
  const row = event.currentTarget;
  if (!(event.target instanceof Element) || !row.contains(event.target)) return false;
  for (let node: Element | null = event.target; node && node !== row; node = node.parentElement)
    if (node.matches(ROW_CONTROL)) return false;
  return true;
}

const ROW_CONTROL =
  'a, button, input, label, [role="button"], [role="checkbox"], [role="switch"], [data-row-control]';

export function TableActionsCell({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <td data-row-control="" className={cn(cellClasses({}), 'whitespace-nowrap')}>
      <span className="flex items-center justify-end gap-2">{children}</span>
    </td>
  );
}

export function TableSelectCell({
  label,
  describedBy,
  checked,
  onCheckedChange,
  disabled,
}: Readonly<{
  label: string;
  describedBy?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean, range: boolean) => void;
  disabled?: boolean;
}>) {
  const range = useRef(false);
  return (
    <td
      data-row-control=""
      className={cellClasses({})}
      onClickCapture={(event) => {
        range.current = event.shiftKey;
      }}
    >
      <Checkbox
        aria-label={label}
        aria-describedby={describedBy}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(next) => onCheckedChange(next === true, range.current)}
      />
    </td>
  );
}

export function TableRowHeader({
  children,
  className,
}: Readonly<{ children: ReactNode; className?: string }>) {
  return (
    <th scope="row" className={cn(cellClasses({}), 'type-body', className)}>
      {isPlainText(children) ? <ClampText rowTitle>{children}</ClampText> : children}
    </th>
  );
}

export function UrlText({ url, origin = null }: Readonly<{ url: string; origin?: string | null }>) {
  const text = urlCellText(url, origin);
  const ref = useRef<HTMLSpanElement>(null);
  const cut = useCut(ref, anyPartCut);
  return (
    <Tooltip content={readableUrl(url)} shouldOpen={anyPartCut}>
      <span
        ref={ref}
        data-url-text=""
        data-truncated={cut || undefined}
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={cut ? 0 : undefined}
        className="rounded-mark flex min-w-0 whitespace-nowrap"
      >
        <UrlCutParts text={text} />
      </span>
    </Tooltip>
  );
}

function anyPartCut(node: HTMLElement) {
  return [...node.querySelectorAll(':scope > span')].some(isTextCut);
}

export function TableTime({
  value,
  fallback = null,
}: Readonly<{ value: string | null | undefined; fallback?: ReactNode }>) {
  const timeZone = useDisplayTimeZone();
  if (!value) return fallback;
  return (
    <ClampText className="text-ink-2 tabular-nums">
      <time dateTime={value}>{formatDisplayTimestamp(value, timeZone)}</time>
    </ClampText>
  );
}
