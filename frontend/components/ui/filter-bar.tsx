'use client';

import type { ComponentPropsWithoutRef, ReactNode, Ref } from 'react';
import { ChevronDown } from 'lucide-react';

import { FIELD_BOX } from '@/components/ui/input';
import {
  Menu,
  MenuContent,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
} from '@/components/ui/menu';
import { ControlCount } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

/**
 * What a route puts in its control band. A route passes these to its screen
 * template's `controls` (or a `DataTable`'s `toolbar`); it never renders a
 * `FilterBar` itself, so no feature draws a toolbar of its own.
 */
export type FilterBarProps = Readonly<{
  /** A `SegmentedControl` choosing which view the content shows (Domains | URLs). It leads the row. */
  view?: ReactNode;
  /** A `SearchField`. */
  search?: ReactNode;
  /**
   * The filters: `FilterTrigger`/`FilterChoice` menus, `FilterField`s, a
   * `SegmentedControl`. A fragment, so each is one of the strip's own items.
   */
  filters?: ReactNode;
  /**
   * A live note such as "Updating data… Previous data shown." A row that
   * reports status passes `null` while idle, so its live region is mounted
   * before the first update and that update is announced.
   */
  status?: ReactNode;
  /** The strip's one secondary action (Export), at the end. */
  actions?: ReactNode;
}>;

/**
 * FilterBar — the control strip at the top of every list and report page:
 * search first, then the filters, then the action at the end, every control
 * 36px and 8 apart. Filter triggers keep one width (224px) whatever their
 * value says, so choosing a filter never moves the strip; the search grows to
 * 360px.
 *
 * Below 1280px it takes two rows: search and the action, then the filters
 * sharing the second row in equal widths. On a phone the search keeps at
 * least 12rem and wraps below the view rather than collapsing.
 */
export function FilterBar({ view, search, filters, status, actions }: FilterBarProps) {
  return (
    <fieldset
      data-filter-bar=""
      aria-label="Search and filters"
      className="shell:gap-y-2 flex min-h-[var(--control-md)] w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-1"
    >
      {view ? <div className="flex min-w-0">{view}</div> : null}
      {/* The search never shrinks below 12rem: where the view leaves less
          room on its row (a phone) it wraps to a row of its own. */}
      {search ? (
        <div className="shell:max-w-[360px] shell:flex-[1_1_240px] min-w-0 flex-[1_1_12rem]">
          {search}
        </div>
      ) : null}
      {actions ? (
        <div className="shell:order-last ms-auto flex max-w-full min-w-0 flex-wrap items-center justify-end gap-2">
          {actions}
        </div>
      ) : null}
      {filters ? (
        <>
          {/* Below 1280px the filters start their own row. */}
          <span aria-hidden className="shell:hidden order-2 h-0 basis-full" />
          <div className="shell:order-none shell:[&>*]:flex-none shell:[&>*]:basis-auto contents [&>*]:order-3 [&>*]:min-w-0 [&>*]:flex-1 [&>*]:basis-0">
            {filters}
          </div>
        </>
      ) : null}
      {status === undefined ? null : (
        <output className="type-caption shell:order-none order-4 flex min-w-0 items-center gap-2 empty:hidden">
          {status}
        </output>
      )}
    </fieldset>
  );
}

/**
 * FilterField — the one width a typed or picked filter value takes (a folder,
 * a status code, a minimum volume, a chart's bucket size): the filter width,
 * so a field never resizes as its value changes. The `Input` or `Select`
 * inside fills it.
 */
export function FilterField({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div data-filter-field="" className="shell:w-[var(--filter-width)] min-w-0 shrink-0 *:w-full">
      {children}
    </div>
  );
}

/**
 * FilterTrigger — the button that opens a filter menu, drawn on the Select
 * trigger recipe at the one filter width.
 *
 * The accessible name always contains the visible value, so a voice user can
 * say what is on screen.
 *
 *   - `label` names the filter ("Surface"). With a `value` it prints as a
 *     muted prefix ("Surface: All surfaces"); `hideLabel` keeps it for
 *     assistive tech only, so the name still contains the visible value.
 *   - `count` is the number of active selections in a multi-select menu: a
 *     count in brackets after the name (`ControlCount`, D16), announced as
 *     "N active".
 *   - `active` marks a filter moved off its default (`data-active`); the
 *     value or count says how.
 *
 * Use it as `<MenuTrigger asChild><FilterTrigger …/></MenuTrigger>`; it
 * forwards the ref and the trigger's props to the button.
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
    <button
      ref={ref}
      type="button"
      data-active={active || showCount || undefined}
      className={cn(
        FIELD_BOX,
        'focus-input shell:w-[var(--filter-width)] flex min-w-0 shrink-0 items-center gap-2 text-left disabled:cursor-not-allowed disabled:opacity-45',
        className,
      )}
      {...props}
    >
      <FilterTriggerText label={label} value={value} hideLabel={hideLabel} />
      {showCount ? (
        <>
          <span aria-hidden>
            <ControlCount count={count} />
          </span>
          <span className="sr-only">, {count} active</span>
        </>
      ) : null}
      <ChevronDown className="text-ink-muted ms-auto size-4 shrink-0" aria-hidden />
    </button>
  );
}

function FilterTriggerText({
  label,
  value,
  hideLabel,
}: Readonly<{ label: string; value?: ReactNode; hideLabel: boolean }>) {
  if (value === undefined || value === null) return <span className="truncate">{label}</span>;
  return (
    <span className="min-w-0 truncate">
      <span className={hideLabel ? 'sr-only' : 'text-ink-muted'}>{label}:</span>{' '}
      <span className="text-ink">{value}</span>
    </span>
  );
}

/**
 * FilterChoice — a single-choice filter menu: the trigger names the filter by
 * its visible value (`label` stays for assistive tech), the menu lists the
 * options.
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
    <Menu>
      <MenuTrigger asChild>
        <FilterTrigger
          label={label}
          hideLabel
          value={options.find((option) => option.value === value)?.label ?? label}
          active={defaultValue !== undefined && value !== defaultValue}
        />
      </MenuTrigger>
      <MenuContent>
        <MenuLabel>{menuLabel}</MenuLabel>
        <MenuRadioGroup value={value}>
          {options.map((option) => (
            <MenuRadioItem
              key={option.value}
              value={option.value}
              onSelect={() => onChange(option.value)}
            >
              {option.label}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  );
}
