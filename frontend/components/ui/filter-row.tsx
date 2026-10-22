'use client';

import type { ComponentPropsWithoutRef, ReactNode, Ref } from 'react';
import { ChevronDown, type LucideIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dropdown,
  DropdownContent,
  DropdownLabel,
  DropdownRadioGroup,
  DropdownRadioItem,
  DropdownTrigger,
} from '@/components/ui/dropdown';
import { cn } from '@/lib/utils';

/**
 * FilterRow — the control band's one composition: search, then filters, then
 * a status line, then trailing actions (export, columns) pushed to the end.
 *
 * The search width is a role, decided here once:
 *
 *   - `sm` (224px) — a short list or a secondary search inside a card.
 *   - `md` (288px) — the default for a route's control band.
 *   - `lg` (up to 384px, growing into spare width) — search is the row's
 *     primary control (Prompts, Internal links).
 *
 * Below `sm` the search and every filter take the full row, stacking beneath
 * each other; a filter never sizes itself for narrow screens.
 * The row adds no box, rule or height of its own: the `PageShell` control band
 * (or the card header holding it) owns those.
 */
const SEARCH_WIDTH = {
  sm: 'w-full sm:w-56',
  md: 'w-full sm:w-72',
  lg: 'w-full sm:max-w-96 sm:min-w-56 sm:flex-1',
} as const;

export type SearchWidth = keyof typeof SEARCH_WIDTH;

export function FilterRow({
  search,
  searchWidth = 'md',
  children,
  status,
  actions,
  className,
}: Readonly<{
  /** A `SearchField`. */
  search?: ReactNode;
  searchWidth?: SearchWidth;
  /** The filters: `FilterTrigger` dropdowns, `FilterChip`s, a `SegmentedControl`. */
  children?: ReactNode;
  /** A live note such as "Updating data… Previous data shown." */
  status?: ReactNode;
  /** Row-level actions, aligned to the end. */
  actions?: ReactNode;
  className?: string;
}>) {
  return (
    <div className={cn('flex w-full min-w-0 flex-wrap items-center gap-2', className)}>
      {search ? <div className={cn('min-w-0', SEARCH_WIDTH[searchWidth])}>{search}</div> : null}
      {children ? (
        // `contents` keeps the filters as the row's own flex items; it only
        // scopes the narrow-screen width to them (not the status or actions).
        <div className="contents max-sm:[&>*]:w-full">{children}</div>
      ) : null}
      {/* A row that reports status keeps its live region mounted even while
          idle (`status={null}`), so the first update is announced. */}
      {status === undefined ? null : (
        <output className="type-caption flex min-w-0 items-center gap-2 empty:hidden">
          {status}
        </output>
      )}
      {actions ? <div className="ms-auto flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/**
 * FilterTrigger — the button that opens a filter menu.
 *
 * The accessible name always contains the visible value, so a voice user can
 * say what is on screen.
 *
 *   - `label` names the filter ("Surface"). With a `value` it prints as a
 *     muted prefix ("Surface: All surfaces"); `hideLabel` keeps it for
 *     assistive tech only, so the name still contains the visible value.
 *   - `count` is the number of active selections in a multi-select menu: a
 *     neutral count badge, announced as "N active".
 *   - `active` marks a filter moved off its default with the selected tint, so
 *     a narrowed view is visible at a glance; the value or count says how.
 *
 * Use it as `<DropdownTrigger asChild><FilterTrigger …/></DropdownTrigger>`;
 * it forwards the ref and the trigger's props to the button.
 */
export function FilterTrigger({
  label,
  value,
  hideLabel = false,
  count,
  active = false,
  icon: Icon,
  className,
  ref,
  ...props
}: Readonly<
  Omit<ComponentPropsWithoutRef<'button'>, 'children'> & {
    label: string;
    value?: ReactNode;
    hideLabel?: boolean;
    count?: number;
    active?: boolean;
    icon?: LucideIcon;
    ref?: Ref<HTMLButtonElement>;
  }
>) {
  const showCount = typeof count === 'number' && count > 0;
  return (
    <Button
      ref={ref}
      variant="secondary"
      data-active={active || showCount || undefined}
      className={cn((active || showCount) && 'bg-selected', className)}
      {...props}
    >
      {/* The glyph is a scanning aid, not the name: it shows from xl, where
          the row has room, so a full filter row still fits one line on a
          980px desktop. */}
      {Icon ? <Icon className="text-muted hidden size-4 shrink-0 xl:block" aria-hidden /> : null}
      <FilterTriggerText label={label} value={value} hideLabel={hideLabel} />
      {showCount ? (
        <>
          <span
            aria-hidden
            className="type-badge bg-neutral-bg text-foreground min-w-5 rounded-full px-2 tabular-nums"
          >
            {count}
          </span>
          <span className="sr-only">, {count} active</span>
        </>
      ) : null}
      <ChevronDown className="text-muted size-4 shrink-0" aria-hidden />
    </Button>
  );
}

function FilterTriggerText({
  label,
  value,
  hideLabel,
}: Readonly<{ label: string; value?: ReactNode; hideLabel: boolean }>) {
  if (value === undefined || value === null) return <span>{label}</span>;
  return (
    <span className="min-w-0 truncate">
      <span className={hideLabel ? 'sr-only' : 'text-muted'}>{label}:</span>{' '}
      <span className="text-foreground">{value}</span>
    </span>
  );
}

/**
 * FilterChoice — a single-choice filter menu: the trigger names the filter by its visible
 * value (`label` stays for assistive tech), the menu lists the options.
 */
export function FilterChoice<T extends string>({
  label,
  menuLabel = label,
  value,
  defaultValue,
  options,
  onChange,
  icon,
}: Readonly<{
  /** The trigger's accessible name prefix, e.g. "Select date range". */
  label: string;
  /** The heading inside the menu; defaults to `label`. */
  menuLabel?: string;
  value: T;
  /** The unfiltered value; any other value marks the trigger active. */
  defaultValue?: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  icon?: LucideIcon;
}>) {
  return (
    <Dropdown>
      <DropdownTrigger asChild>
        <FilterTrigger
          label={label}
          hideLabel
          value={options.find((option) => option.value === value)?.label ?? label}
          active={defaultValue !== undefined && value !== defaultValue}
          icon={icon}
        />
      </DropdownTrigger>
      <DropdownContent>
        <DropdownLabel>{menuLabel}</DropdownLabel>
        <DropdownRadioGroup value={value}>
          {options.map((option) => (
            <DropdownRadioItem
              key={option.value}
              value={option.value}
              onSelect={() => onChange(option.value)}
            >
              {option.label}
            </DropdownRadioItem>
          ))}
        </DropdownRadioGroup>
      </DropdownContent>
    </Dropdown>
  );
}
