import type { ComponentPropsWithoutRef, ReactNode, Ref } from 'react';
import { ChevronDown } from 'lucide-react';

import {
  AllFilters,
  ChoiceOptions,
  focusFieldOnEntry,
  type FilterDefinition,
} from '@/components/ui/all-filters';
import { FIELD_BOX } from '@/components/ui/input';
import {
  Menu,
  MenuContent,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
} from '@/components/ui/menu';
import { cn } from '@/lib/utils';

/**
 * What a route puts in its control row. A route passes these to its screen
 * template's `controls` (or a `DataTable`'s `toolbar`); it never renders a
 * `FilterBar` itself, so no feature draws a toolbar of its own. The slots are
 * the row's order (D57): a page fills slots, it never arranges controls.
 */
export type FilterBarProps = Readonly<{
  /**
   * A `SegmentedControl` choosing which set the content shows (Active |
   * Archived, Domains | URLs, Issues | Advisories). It leads the row.
   */
  view?: ReactNode;
  /** A `SearchField`, after the view. */
  search?: ReactNode;
  /**
   * Every filter of the list, after the search: period, market, engine, kind,
   * status and typed values alike. Two or more share the one All filters
   * menu; a lone filter is its own trigger ("Page kind: All page kinds"),
   * since a menu holding one entry is a click with nothing to choose.
   */
  filters?: readonly FilterDefinition[];
  /**
   * What the row shows, in caption at its end: the count describing the list
   * ("12 issues · 40 pages") or a live note ("Updating data… Previous data
   * shown."). A row that reports status passes `null` while idle, so its live
   * region is mounted before the first update and that update is announced.
   */
  status?: ReactNode;
  /** The row's one action on what it lists (Export), last. */
  actions?: ReactNode;
}>;

/**
 * FilterBar — the control row at the top of every list and report page, in
 * one order on every page: the view, the search, All filters, then the count
 * and the action at the row's end. Every control is 32px and 8 apart, across
 * and between wrapped rows alike. The search grows to 360px; on a phone it
 * keeps at least 12rem and wraps below the view rather than collapsing.
 */
export function FilterBar({ view, search, filters, status, actions }: FilterBarProps) {
  return (
    <fieldset
      data-filter-bar=""
      aria-label="Search and filters"
      className="flex min-h-[var(--control-md)] w-full min-w-0 flex-wrap items-center gap-2"
    >
      {view ? <div className="flex max-w-full min-w-0">{view}</div> : null}
      {search ? (
        <div className="shell:max-w-[360px] shell:flex-[1_1_240px] min-w-0 flex-[1_1_12rem]">
          {search}
        </div>
      ) : null}
      {filters ? <FilterControls filters={filters} /> : null}
      {status === undefined ? null : (
        <output className="type-caption ms-auto flex min-w-0 items-center gap-2 empty:hidden">
          {status}
        </output>
      )}
      {actions ? (
        // At the row's end; after a shown count it keeps the 8 between them.
        <div className="ms-auto flex max-w-full min-w-0 flex-wrap items-center justify-end gap-2 [output:not(:empty)+&]:ms-0">
          {actions}
        </div>
      ) : null}
    </fieldset>
  );
}

/**
 * FilterControls — a list's filters as its control row draws them: a lone
 * filter as its own trigger that opens its options, two or more behind All
 * filters. `align` is the edge the menu lines up with (`end` at a row's far
 * right).
 */
export function FilterControls({
  filters,
  align = 'start',
}: Readonly<{ filters: readonly FilterDefinition[]; align?: 'start' | 'end' }>) {
  const [only, ...rest] = filters;
  if (!only) return null;
  if (rest.length > 0) return <AllFilters filters={filters} align={align} />;
  return (
    <Menu>
      <MenuTrigger asChild>
        <FilterTrigger
          label={only.label}
          value={only.valueLabel}
          active={!only.isDefault}
          sizeTo={
            only.kind === 'choice'
              ? only.groups.flatMap((group) => group.options.map((option) => option.label))
              : [only.valueLabel]
          }
        />
      </MenuTrigger>
      <MenuContent align={align} onFocus={focusFieldOnEntry}>
        {only.kind === 'choice' ? <ChoiceOptions filter={only} /> : only.content}
      </MenuContent>
    </Menu>
  );
}

/**
 * FilterTrigger — the button that opens a single-choice menu (`FilterChoice`),
 * drawn on the Select trigger recipe at the one filter width.
 *
 * The accessible name always contains the visible value, so a voice user can
 * say what is on screen.
 *
 *   - `label` names the filter ("Surface"). With a `value` it prints as a
 *     muted prefix ("Surface: All surfaces"); `hideLabel` keeps it for
 *     assistive tech only, so the name still contains the visible value.
 *   - `active` marks a choice moved off its default (`data-active`); the
 *     value says how.
 *   - `sizeTo` lists every value the trigger can show. The trigger then takes
 *     the width of the longest of them instead of the one filter width, so it
 *     fits its content and still never resizes when the choice changes.
 *
 * Use it as `<MenuTrigger asChild><FilterTrigger …/></MenuTrigger>`; it
 * forwards the ref and the trigger's props to the button.
 */
export function FilterTrigger({
  label,
  value,
  hideLabel = false,
  active = false,
  sizeTo,
  className,
  ref,
  ...props
}: Readonly<
  Omit<ComponentPropsWithoutRef<'button'>, 'children'> & {
    label: string;
    value?: ReactNode;
    hideLabel?: boolean;
    active?: boolean;
    /** Every value the trigger can show; it takes the longest one's width. */
    sizeTo?: readonly string[];
    ref?: Ref<HTMLButtonElement>;
  }
>) {
  const fit = sizeTo !== undefined && sizeTo.length > 0;
  return (
    <button
      ref={ref}
      type="button"
      data-active={active || undefined}
      data-fit={fit || undefined}
      className={cn(
        FIELD_BOX,
        'focus-input flex min-w-0 shrink-0 items-center gap-2 text-left disabled:cursor-not-allowed disabled:opacity-45',
        fit ? 'w-auto max-w-full' : 'shell:w-[var(--filter-width)]',
        className,
      )}
      {...props}
    >
      {fit ? (
        // Every option is laid in the same cell, unseen, so the cell is as
        // wide as the longest and the visible value never resizes the trigger.
        // The sizers draw their text as generated content: it adds no
        // readable text and no accessible name.
        <span className="grid min-w-0">
          {/* Only the longest labels can set the width; a long option list
              (every tracked prompt) must not become one node per option. */}
          {[...new Set(sizeTo)]
            .sort((a, b) => b.length - a.length)
            .slice(0, 6)
            .map((size) => (
              <span
                key={size}
                aria-hidden
                data-size={hideLabel ? size : `${label}: ${size}`}
                className="invisible col-start-1 row-start-1 whitespace-nowrap after:content-[attr(data-size)]"
              />
            ))}
          <span className="col-start-1 row-start-1 flex min-w-0">
            <FilterTriggerText label={label} value={value} hideLabel={hideLabel} />
          </span>
        </span>
      ) : (
        <FilterTriggerText label={label} value={value} hideLabel={hideLabel} />
      )}
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
 * FilterChoice — a single choice of how one card draws (a chart's plotted
 * metric), in that card's header actions: the trigger names the choice by
 * its visible value (`label` stays for assistive tech), the menu lists the
 * options. A list's filters are never this: they live in its row's All
 * filters (D57).
 */
export function FilterChoice<T extends string>({
  label,
  menuLabel = label,
  value,
  defaultValue,
  options,
  onChange,
  fit = false,
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
  /** Size the trigger to its longest option instead of the one filter width. */
  fit?: boolean;
}>) {
  return (
    <Menu>
      <MenuTrigger asChild>
        <FilterTrigger
          label={label}
          hideLabel
          value={options.find((option) => option.value === value)?.label ?? label}
          active={defaultValue !== undefined && value !== defaultValue}
          sizeTo={fit ? options.map((option) => option.label) : undefined}
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
