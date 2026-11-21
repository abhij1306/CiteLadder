import { useEffect, useRef, useState } from 'react';

import type { FilterDefinition } from '@/components/ui/all-filters';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { FilterOptions, focusFieldOnEntry } from '@/components/ui/filter-options';
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuTrigger,
} from '@/components/ui/menu';
import { ControlCount } from '@/components/ui/tabs';
import { ChevronLeft, ListFilter } from '@/lib/icons';
import { useMediaQuery } from '@/lib/use-media-query';

function activeFilterCount(filters: readonly FilterDefinition[]): number {
  return filters.filter((filter) => !filter.isDefault).length;
}

export function FiltersMenu({
  filters,
  align = 'start',
}: Readonly<{ filters: readonly FilterDefinition[]; align?: 'start' | 'end' }>) {
  const narrow = useMediaQuery(NARROW_QUERY);
  if (filters.length === 0) return null;
  const active = activeFilterCount(filters);
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button
          variant="secondary"
          data-active={active > 0 || undefined}
          aria-label={active > 0 ? `Filters (${active})` : 'Filters'}
        >
          <Icon icon={ListFilter} />
          <span>
            Filters
            {active > 0 ? <ControlCount count={active} /> : null}
          </span>
        </Button>
      </MenuTrigger>
      <MenuContent align={align}>
        {narrow ? (
          <DrillInFilters filters={filters} />
        ) : (
          <>
            <MenuLabel>More filters</MenuLabel>
            {filters.map((filter) => (
              <MenuSub key={filter.id}>
                <MenuSubTrigger value={filter.valueLabel} disabled={filter.disabled}>
                  {filter.label}
                </MenuSubTrigger>
                <FilterSubmenu filter={filter} />
              </MenuSub>
            ))}
          </>
        )}
      </MenuContent>
    </Menu>
  );
}

const NARROW_QUERY = '(max-width: 639px)';

function DrillInFilters({ filters }: Readonly<{ filters: readonly FilterDefinition[] }>) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [returnTo, setReturnTo] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const open = filters.find((filter) => filter.id === openId);
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
            disabled={filter.disabled}
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
        Filters
      </MenuItem>
      <MenuSeparator />
      <FilterOptions filter={open} />
    </div>
  );
}

function FilterSubmenu({ filter }: Readonly<{ filter: FilterDefinition }>) {
  return (
    <MenuSubContent onFocus={focusFieldOnEntry}>
      <FilterOptions filter={filter} />
    </MenuSubContent>
  );
}
