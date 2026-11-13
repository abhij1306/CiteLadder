import {
  Fragment,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { ChevronLeft, SlidersHorizontal } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import {
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuTrigger,
} from '@/components/ui/menu';
import { SearchField } from '@/components/ui/search-field';
import { ControlCount } from '@/components/ui/tabs';

/** One choice in a filter's submenu. */
type FilterOption<T extends string = string> = Readonly<{ value: T; label: string }>;

/** A run of options under an optional small label ("Answer engines"). */
export type FilterOptionGroup<T extends string = string> = Readonly<{
  label?: string;
  options: readonly FilterOption<T>[];
}>;

type FilterBase = Readonly<{
  /** Stable key, unique in the menu. */
  id: string;
  /** The filter's name in the menu: "Surface". */
  label: string;
  /** What the filter is set to now, printed beside its name: "All surfaces". */
  valueLabel: string;
  /** Whether the filter is at its unfiltered value; the others are counted on the button. */
  isDefault: boolean;
}>;

/**
 * One filter in All filters. `choice` lists its options in a submenu with a
 * check on the selected one (build it with `choiceFilter`); `custom` draws its
 * own submenu body (menu items from `components/ui/menu`).
 */
export type FilterDefinition = FilterBase &
  (
    | Readonly<{
        kind: 'choice';
        value: string;
        groups: readonly FilterOptionGroup[];
        onChange: (value: string) => void;
        /** A search box above the options; on by default past `SEARCH_FROM` options. */
        searchable?: boolean;
      }>
    | Readonly<{ kind: 'custom'; content: ReactNode }>
  );

/** A list this long gets a search box, so a reader never scrolls for a prompt. */
const SEARCH_FROM = 10;

/**
 * A single-choice filter for All filters, typed by its values: the submenu
 * hands back only a value it offered, so `onChange` receives a `T`.
 */
export function choiceFilter<T extends string>({
  id,
  label,
  value,
  defaultValue,
  groups,
  onChange,
  searchable,
  valueLabel,
}: Readonly<{
  id: string;
  label: string;
  value: T;
  /** The unfiltered value. */
  defaultValue: T;
  groups: readonly FilterOptionGroup<T>[];
  onChange: (value: T) => void;
  searchable?: boolean;
  /** Overrides the selected option's label (a value the list no longer carries). */
  valueLabel?: string;
}>): FilterDefinition {
  const options = groups.flatMap((group) => group.options);
  return {
    kind: 'choice',
    id,
    label,
    value,
    valueLabel: valueLabel ?? options.find((option) => option.value === value)?.label ?? label,
    isDefault: value === defaultValue,
    groups,
    searchable,
    onChange: (raw) => {
      const picked = options.find((option) => option.value === raw);
      if (picked) onChange(picked.value);
    },
  };
}

/**
 * A multi-select filter for All filters: a check per option, any number on,
 * none on meaning unfiltered. The submenu stays open while the reader picks.
 */
export function manyFilter<T extends string>({
  id,
  label,
  allLabel,
  values,
  options,
  onChange,
}: Readonly<{
  id: string;
  label: string;
  /** The value shown while nothing is checked: "All intents". */
  allLabel: string;
  values: readonly T[];
  options: readonly FilterOption<T>[];
  onChange: (values: T[]) => void;
}>): FilterDefinition {
  const chosen = new Set<string>(values);
  const picked = options.filter((option) => chosen.has(option.value));
  const [only] = picked;
  return {
    kind: 'custom',
    id,
    label,
    valueLabel: picked.length > 1 ? `${picked.length} selected` : (only?.label ?? allLabel),
    isDefault: picked.length === 0,
    content: (
      <>
        <MenuLabel>{label}</MenuLabel>
        {options.map((option) => (
          <MenuCheckboxItem
            key={option.value || 'unspecified'}
            checked={chosen.has(option.value)}
            onSelect={(event) => {
              event.preventDefault();
              onChange(
                chosen.has(option.value)
                  ? values.filter((value) => value !== option.value)
                  : [...values, option.value],
              );
            }}
          >
            {option.label}
          </MenuCheckboxItem>
        ))}
      </>
    ),
  };
}

/** How many filters are off their default value. */
function activeFilterCount(filters: readonly FilterDefinition[]): number {
  return filters.filter((filter) => !filter.isDefault).length;
}

/**
 * AllFilters — every filter of a list behind one button, after the search in
 * its control row (`FilterBar` draws it from its `filters` when there are two
 * or more, D57; a lone filter is its own trigger, `FilterControls`). The menu
 * opens toward the content from the button's edge on that side (`align`):
 * `start` (the default), so the menu and its submenus open to the right and
 * never over the sidebar; `end` for a button at its row's far right. The
 * button counts the filters moved off their defaults
 * ("All filters (2)", D16); its menu lists each filter with its current value,
 * and each opens a submenu of its options with a check on the selected one.
 * Long lists get a search box. Radix's menu keyboard model throughout: arrows
 * move, Right or Enter opens a filter, Left comes back, Escape closes.
 *
 * On a phone a submenu has no room beside the menu, so there a filter opens
 * its options in the menu itself, under a Back row.
 *
 * The filters' state stays with their owners (URL state on every current
 * page); this only draws them.
 */
export function AllFilters({
  filters,
  label = 'All filters',
  align = 'start',
}: Readonly<{
  filters: readonly FilterDefinition[];
  label?: string;
  /** The button's edge the menu lines up with: `end` for a button at its row's far right. */
  align?: 'start' | 'end';
}>) {
  const narrow = useNarrowViewport();
  if (filters.length === 0) return null;
  const active = activeFilterCount(filters);
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button
          variant="secondary"
          // Its own width in a FilterBar too: stretched across a narrow row,
          // its menu opened at the far edge and every submenu flipped back
          // over it, where a quick move to an option closed the submenu.
          data-fit=""
          data-active={active > 0 || undefined}
          // The name is the visible text, its count included: "All filters (2)".
          aria-label={active > 0 ? `${label} (${active})` : label}
        >
          <Icon icon={SlidersHorizontal} />
          <span>
            {label}
            {active > 0 ? <ControlCount count={active} /> : null}
          </span>
        </Button>
      </MenuTrigger>
      <MenuContent align={align}>
        {narrow ? (
          <DrillInFilters filters={filters} />
        ) : (
          filters.map((filter) => (
            <MenuSub key={filter.id}>
              <MenuSubTrigger value={filter.valueLabel}>{filter.label}</MenuSubTrigger>
              {filter.kind === 'custom' ? (
                <MenuSubContent onFocus={focusFieldOnEntry}>{filter.content}</MenuSubContent>
              ) : (
                <ChoiceSubmenu filter={filter} />
              )}
            </MenuSub>
          ))
        )}
      </MenuContent>
    </Menu>
  );
}

/** Below this width a submenu cannot stand beside the menu (two 224px panels). */
const NARROW_QUERY = '(max-width: 639px)';

function subscribeNarrow(onChange: () => void) {
  const media = globalThis.matchMedia?.(NARROW_QUERY);
  media?.addEventListener('change', onChange);
  return () => media?.removeEventListener('change', onChange);
}

function useNarrowViewport(): boolean {
  return useSyncExternalStore(
    subscribeNarrow,
    () => globalThis.matchMedia?.(NARROW_QUERY).matches ?? false,
    () => false,
  );
}

/**
 * The phone form: the menu lists the filters; choosing one shows its options
 * in the same panel under a Back row, and Back returns to the list. The menu
 * unmounts on close, so it always reopens on the list.
 */
function DrillInFilters({ filters }: Readonly<{ filters: readonly FilterDefinition[] }>) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [returnTo, setReturnTo] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const open = filters.find((filter) => filter.id === openId);
  // Focus follows the step: the options (or their search box) going in, the
  // filter's own row coming back.
  useEffect(() => {
    const root = panel.current;
    if (!root) return;
    const target = open
      ? root.querySelector<HTMLElement>('input, [role="menuitemradio"]')
      : root.querySelector<HTMLElement>(`[data-filter-id="${returnTo ?? ''}"]`);
    target?.focus();
  }, [open, returnTo]);
  if (!open) {
    return (
      <div ref={panel} className="contents">
        {filters.map((filter) => (
          <MenuItem
            key={filter.id}
            data-filter-id={filter.id}
            aria-label={`${filter.label}: ${filter.valueLabel}`}
            value={filter.valueLabel}
            onSelect={(event) => {
              event.preventDefault();
              setOpenId(filter.id);
            }}
          >
            {filter.label}
          </MenuItem>
        ))}
      </div>
    );
  }
  return (
    <div ref={panel} className="contents">
      <MenuItem
        icon={<ChevronLeft />}
        onSelect={(event) => {
          event.preventDefault();
          setReturnTo(open.id);
          setOpenId(null);
        }}
      >
        All filters
      </MenuItem>
      <MenuSeparator />
      {open.kind === 'custom' ? open.content : <ChoiceOptions filter={open} />}
    </div>
  );
}

/**
 * Opened from the keyboard, a submenu panel takes focus; a field in it (a
 * choice list's search box, a custom filter's typed value) takes it instead, so
 * typing edits the field rather than jumping by letter. After the menu has
 * moved focus to its first option in the same event.
 */
export function focusFieldOnEntry(event: FocusEvent<HTMLDivElement>) {
  if (event.target !== event.currentTarget) return;
  const input = event.currentTarget.querySelector('input');
  if (input) queueMicrotask(() => input.focus());
}

type ChoiceFilter = Extract<FilterDefinition, { kind: 'choice' }>;

function isSearchable(filter: ChoiceFilter): boolean {
  const total = filter.groups.reduce((sum, group) => sum + group.options.length, 0);
  return filter.searchable ?? total > SEARCH_FROM;
}

function ChoiceSubmenu({ filter }: Readonly<{ filter: ChoiceFilter }>) {
  const searchable = isSearchable(filter);
  return (
    <MenuSubContent
      onFocus={focusFieldOnEntry}
      onKeyDown={(event) => {
        // Up from the first option goes back to the search box.
        if (!searchable || event.key !== 'ArrowUp') return;
        const first = event.currentTarget.querySelector('[role="menuitemradio"]');
        if (event.target !== first) return;
        event.preventDefault();
        event.currentTarget.querySelector('input')?.focus();
      }}
    >
      <ChoiceOptions filter={filter} />
    </MenuSubContent>
  );
}

/** A choice filter's options: a search box on a long list, then the options by group. */
export function ChoiceOptions({ filter }: Readonly<{ filter: ChoiceFilter }>) {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const groups = needle
    ? filter.groups
        .map((group) => ({
          ...group,
          options: group.options.filter((option) => option.label.toLowerCase().includes(needle)),
        }))
        .filter((group) => group.options.length > 0)
    : filter.groups;
  return (
    <>
      {isSearchable(filter) ? (
        <div className="bg-surface sticky top-0 z-10 pb-1">
          <SearchField
            value={query}
            onValueChange={setQuery}
            aria-label={`Search ${filter.label.toLowerCase()}`}
            placeholder="Search"
            onKeyDown={searchKeys}
          />
        </div>
      ) : (
        <MenuLabel>{filter.label}</MenuLabel>
      )}
      <MenuRadioGroup value={filter.value}>
        {groups.map((group, index) => (
          <Fragment key={group.label ?? `group-${index}`}>
            {index > 0 ? <MenuSeparator /> : null}
            {group.label ? <MenuLabel>{group.label}</MenuLabel> : null}
            {group.options.map((option) => (
              <MenuRadioItem
                key={option.value}
                value={option.value}
                onSelect={() => filter.onChange(option.value)}
              >
                {option.label}
              </MenuRadioItem>
            ))}
          </Fragment>
        ))}
      </MenuRadioGroup>
      {groups.length === 0 ? (
        <p className="text-body-sm text-ink-muted px-2 py-2">No matches</p>
      ) : null}
    </>
  );
}

/**
 * A typed field inside a filter menu (a custom filter's value, a choice list's
 * search box): its keys edit the text, so they stop before the menu, which
 * would otherwise jump to an item by letter or close the submenu on Left.
 * Escape and Tab pass through, and so does Left from an empty field, which
 * returns to the list. Returns whether the key stayed with the field.
 */
export function menuFieldKeys(event: KeyboardEvent<HTMLInputElement>): boolean {
  if (event.key === 'Escape' || event.key === 'Tab') return false;
  if (event.key === 'ArrowLeft' && event.currentTarget.value === '') return false;
  event.stopPropagation();
  return true;
}

/** The search box's keys stay with it; Down moves to the first option. */
function searchKeys(event: KeyboardEvent<HTMLInputElement>) {
  if (!menuFieldKeys(event) || event.key !== 'ArrowDown') return;
  event.preventDefault();
  const menu = event.currentTarget.closest('[role="menu"]');
  const first = menu?.querySelector<HTMLElement>('[role="menuitemradio"]');
  first?.focus();
}
