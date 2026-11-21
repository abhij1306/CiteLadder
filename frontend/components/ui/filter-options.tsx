import { Fragment, useState, type FocusEvent, type KeyboardEvent } from 'react';

import { OptionText, type FilterDefinition } from '@/components/ui/all-filters';
import {
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
} from '@/components/ui/menu';
import { SearchField } from '@/components/ui/search-field';

const SEARCH_FROM = 10;

type ChoiceFilter = Extract<FilterDefinition, { kind: 'choice' }>;

function isSearchable(filter: ChoiceFilter): boolean {
  const total = filter.groups.reduce((sum, group) => sum + group.options.length, 0);
  return filter.searchable ?? total > SEARCH_FROM;
}

export function FilterOptions({ filter }: Readonly<{ filter: FilterDefinition }>) {
  return (
    <>
      <MenuLabel>{filter.label}</MenuLabel>
      {filter.kind === 'choice' ? <ChoiceOptions filter={filter} /> : filter.content}
      {filter.isDefault ? null : (
        <>
          <MenuSeparator />
          <MenuItem onSelect={filter.reset}>Reset to {resetTarget(filter.defaultLabel)}</MenuItem>
        </>
      )}
    </>
  );
}

function resetTarget(label: string): string {
  const [first = '', second] = label.split(' ');
  const named = second === undefined || /^[A-Z]/.test(second) || /[A-Z]/.test(first.slice(1));
  return named ? label : `${label.charAt(0).toLowerCase()}${label.slice(1)}`;
}

function ChoiceOptions({ filter }: Readonly<{ filter: ChoiceFilter }>) {
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
        <div className="bg-raised sticky top-0 z-10 pb-1">
          <SearchField
            value={query}
            onValueChange={setQuery}
            aria-label={`Search ${filter.label.toLowerCase()}`}
            placeholder="Search"
            onKeyDown={searchKeys}
          />
        </div>
      ) : null}
      <MenuRadioGroup
        value={filter.value}
        onKeyDown={isSearchable(filter) ? backToSearch : undefined}
      >
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
                <span className="flex min-w-0 items-center">
                  {option.mark ? (
                    <OptionText mark={option.mark} label={option.label} />
                  ) : (
                    <span className="min-w-0 truncate">{option.label}</span>
                  )}
                  {option.value === filter.defaultValue ? <DefaultHint /> : null}
                </span>
              </MenuRadioItem>
            ))}
          </Fragment>
        ))}
      </MenuRadioGroup>
      {groups.length === 0 ? <p className="text-body-sm text-ink-2 px-2 py-2">No matches</p> : null}
    </>
  );
}

export function DefaultHint() {
  return (
    <span
      aria-hidden
      data-hint="Default"
      className="text-ink-2 type-caption ms-auto shrink-0 ps-4 after:content-[attr(data-hint)]"
    />
  );
}

export function focusFieldOnEntry(event: FocusEvent<HTMLDivElement>) {
  if (event.target !== event.currentTarget) return;
  const input = event.currentTarget.querySelector('input');
  if (input) queueMicrotask(() => input.focus());
}

export function menuFieldKeys(event: KeyboardEvent<HTMLInputElement>): boolean {
  if (event.key === 'Escape' || event.key === 'Tab') return false;
  if (event.key === 'ArrowLeft' && event.currentTarget.value === '') return false;
  event.stopPropagation();
  return true;
}

function backToSearch(event: KeyboardEvent<HTMLDivElement>) {
  if (event.key !== 'ArrowUp') return;
  const first = event.currentTarget.querySelector('[role="menuitemradio"]');
  if (event.target !== first) return;
  event.preventDefault();
  event.currentTarget.closest('[role="menu"]')?.querySelector('input')?.focus();
}

function searchKeys(event: KeyboardEvent<HTMLInputElement>) {
  if (!menuFieldKeys(event) || event.key !== 'ArrowDown') return;
  event.preventDefault();
  const menu = event.currentTarget.closest('[role="menu"]');
  const first = menu?.querySelector<HTMLElement>('[role="menuitemradio"]');
  first?.focus();
}
