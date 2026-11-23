import type { ReactNode } from 'react';

import type { FilterDefinition } from '@/components/ui/all-filters';
import { Button } from '@/components/ui/button';
import { FilterChip, FilterTrigger, ValueChip } from '@/components/ui/filter-chip';
import { FiltersMenu } from '@/components/ui/filters-menu';
import { Icon } from '@/components/ui/icon';
import {
  Menu,
  MenuContent,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
} from '@/components/ui/menu';
import { X } from '@/lib/icons';
import { batchUrlWrites } from '@/lib/navigation/url-state';

export type FilterBarProps = Readonly<{
  view?: ReactNode;
  lead?: ReactNode;
  search?: ReactNode;
  filters?: readonly FilterDefinition[];
  status?: ReactNode;
  actions?: ReactNode;
}>;

const ROW_ICON_CHIPS = 4;

function placeFilters(filters: readonly FilterDefinition[]): Readonly<{
  chips: readonly FilterDefinition[];
  menu: readonly FilterDefinition[];
}> {
  const icons = filters
    .filter((filter) => filter.icon && !filter.inFilters)
    .slice(0, ROW_ICON_CHIPS);
  const rest = filters.filter((filter) => !icons.includes(filter));
  if (rest.length === 1) return { chips: [...icons, ...rest], menu: [] };
  return { chips: icons, menu: rest };
}

function dataWindow(chips: readonly FilterDefinition[]): string | undefined {
  const period = chips.find((filter) => filter.icon === 'period' && filter.isDefault);
  return period ? (period.windowLabel ?? period.valueLabel) : undefined;
}

export function FilterBar({ view, lead, ...row }: FilterBarProps) {
  return (
    <fieldset
      data-filter-bar=""
      aria-label="Search and filters"
      className="flex min-h-[var(--control-md)] w-full min-w-0 flex-wrap items-center gap-2"
    >
      {view ? <div className="flex max-w-full min-w-0 shrink-0">{view}</div> : null}
      {lead ? <div className="flex max-w-full min-w-0 shrink-0">{lead}</div> : null}
      {view ? (
        <div className="flex min-w-[min(100%,16rem)] flex-[1_1_0] flex-wrap items-center justify-end gap-2">
          <Controls {...row} afterView />
        </div>
      ) : (
        <Controls {...row} />
      )}
    </fieldset>
  );
}

function Controls({
  search,
  filters = [],
  status,
  actions,
  afterView = false,
}: Omit<FilterBarProps, 'view' | 'lead'> & { afterView?: boolean }) {
  const { chips, menu } = placeFilters(filters);
  const set = filters.filter((filter) => !filter.isDefault);
  const windowLabel = dataWindow(chips);
  return (
    <>
      {search ? (
        <div className="rail:max-w-64 rail:grow rail:basis-[200px] min-w-0 basis-full">
          {search}
        </div>
      ) : null}
      {chips.map((filter) => (
        <div key={filter.id} className="flex min-w-0 shrink-0">
          <FilterChip filter={filter} />
        </div>
      ))}
      {menu.length > 0 ? (
        <div className="flex min-w-0 shrink-0">
          <FiltersMenu filters={menu} />
        </div>
      ) : null}
      {menu
        .filter((filter) => !filter.isDefault)
        .map((filter) => (
          <div key={filter.id} className="flex min-w-0 shrink-0">
            <ValueChip filter={filter} />
          </div>
        ))}
      {set.length > 0 ? (
        <div className="flex shrink-0">
          <Button
            variant="quiet"
            onClick={() =>
              batchUrlWrites(() => {
                for (const filter of set) filter.reset();
              })
            }
          >
            <Icon icon={X} />
            Clear
          </Button>
        </div>
      ) : null}
      {windowLabel || status !== undefined ? (
        <div
          data-strip-meta=""
          className={`${afterView ? 'rail:-order-1 ' : ''}rail:flex-[1_1_0] rail:justify-end rail:overflow-hidden flex min-w-0 items-center gap-1 whitespace-nowrap has-[>output:empty]:not-has-[>span]:hidden`}
        >
          {windowLabel ? (
            <span className="type-caption min-w-0 shrink truncate">
              {windowLabel}
              {status ? ' ·' : null}
            </span>
          ) : null}
          {status === undefined ? null : (
            <output
              aria-live="polite"
              className="type-caption block min-w-0 shrink truncate *:not-first:ms-2 empty:hidden"
            >
              {status}
            </output>
          )}
        </div>
      ) : null}
      {actions ? (
        <div className="phone:ms-0 phone:justify-start phone:flex-wrap ms-auto flex max-w-full min-w-0 shrink-0 items-center justify-end gap-2">
          {actions}
        </div>
      ) : null}
    </>
  );
}

export function FilterControls({
  filters,
  align = 'start',
}: Readonly<{ filters: readonly FilterDefinition[]; align?: 'start' | 'end' }>) {
  const [only, ...rest] = filters;
  if (!only) return null;
  if (rest.length > 0) return <FiltersMenu filters={filters} align={align} />;
  return <FilterChip filter={only} align={align} />;
}

export function FilterChoice<T extends string>({
  label,
  value,
  defaultValue,
  options,
  onChange,
}: Readonly<{
  label: string;
  value: T;
  defaultValue?: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}>) {
  return (
    <Menu>
      <MenuTrigger asChild>
        <FilterTrigger
          label={label}
          value={options.find((option) => option.value === value)?.label ?? label}
          active={defaultValue !== undefined && value !== defaultValue}
        />
      </MenuTrigger>
      <MenuContent>
        <MenuLabel>{label}</MenuLabel>
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
