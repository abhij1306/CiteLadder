'use client';

import type { ComponentPropsWithoutRef, ReactNode, Ref } from 'react';
import { ChevronDown } from 'lucide-react';

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
 * What a route puts in its control band. A route passes these to its screen
 * template's `controls` (or a `DataTable`'s `toolbar`); it never renders a
 * `FilterBar` itself, so no feature draws a toolbar of its own.
 */
export type FilterBarProps = Readonly<{
  /**
   * A `SegmentedControl` choosing which view the content shows (Domains |
   * URLs). It leads the row and pushes the filters after it to the end.
   */
  view?: ReactNode;
  /** A `SearchField`. */
  search?: ReactNode;
  /**
   * The filters: `FilterTrigger`/`FilterChoice` menus, `Select`s, pressed-state
   * buttons, a `SegmentedControl`. A fragment, so each is one of the row's own
   * items and shares its one gap.
   */
  filters?: ReactNode;
  /**
   * A live note such as "Updating data… Previous data shown." A row that
   * reports status passes `null` while idle, so its live region is mounted
   * before the first update and that update is announced.
   */
  status?: ReactNode;
  /** Row-level actions (export, columns), aligned to the end. */
  actions?: ReactNode;
}>;

/**
 * FilterBar — the control band's one composition, in one row with one gap:
 * an optional view switch, search, then filters, then a status line, then
 * trailing actions pushed to the end. With a view switch, everything after it
 * sits at the end.
 *
 * It owns every number in the band: the 8px gap between items, the 8px above
 * and below the row, the 32px row height, the one search width and the one
 * `FilterField` width. The controls inside keep their one 32px height;
 * nothing here resizes them. Below the phone breakpoint the search and every
 * filter take the full row.
 */
export function FilterBar({ view, search, filters, status, actions }: FilterBarProps) {
  return (
    <div
      data-filter-bar=""
      className="flex min-h-[var(--control-height-md)] w-full min-w-0 flex-wrap items-center gap-2 py-2"
    >
      {view ? <div className="me-auto flex min-w-0">{view}</div> : null}
      {search ? <div className="desktop:w-56 w-full min-w-0">{search}</div> : null}
      {filters ? (
        // `contents` keeps the filters as the row's own flex items; it only
        // scopes the narrow-screen width to them (not the status or actions).
        // A `FilterField` takes its width from the custom property, so the
        // same field is the full row on a phone and the one filter width on
        // desktop without the two width rules competing.
        <div className="desktop:[&>*:not([data-filter-field])]:w-auto desktop:[--filter-field-width:var(--filter-width)] contents [--filter-field-width:100%] [&>*:not([data-filter-field])]:w-full">
          {filters}
        </div>
      ) : null}
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
 * FilterField — the one width a typed or picked filter value takes (a folder,
 * a status code, a minimum volume, a chart's bucket size): 160px, so a field
 * does not resize as its value changes and every such field in the product
 * reads at one width. The `Input` or `Select` inside fills it. In a
 * `FilterBar` it is the full row below desktop; elsewhere (a card header's
 * actions) it is always the one width.
 */
export function FilterField({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div
      data-filter-field=""
      className="w-[var(--filter-field-width,var(--filter-width))] min-w-0 shrink-0 [&>*]:w-full"
    >
      {children}
    </div>
  );
}

/**
 * FilterDivider — the hairline between two groups of filters in one band
 * (what is measured | how it is narrowed). Desktop only: on a phone every
 * filter takes its own row and the groups need no separator.
 */
export function FilterDivider() {
  return <span className="bg-border desktop:block mx-1 hidden h-5 w-px" aria-hidden />;
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
      {/* One form at every width: the name, the count and the chevron. A
          leading glyph that appeared only on wide screens made the same
          trigger two widths and wrapped the band at the owner's 982px. */}
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
}>) {
  return (
    <Dropdown>
      <DropdownTrigger asChild>
        <FilterTrigger
          label={label}
          hideLabel
          value={options.find((option) => option.value === value)?.label ?? label}
          active={defaultValue !== undefined && value !== defaultValue}
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
