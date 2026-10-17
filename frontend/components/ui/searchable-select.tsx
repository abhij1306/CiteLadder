'use client';

import { useId, useRef, useState, type ReactNode } from 'react';

import { Input } from '@/components/ui/input';
import { menuItemVariants, menuPanelClasses } from '@/components/ui/menu-variants';
import { cn } from '@/lib/utils';

export type SearchableSelectOption = { value: string; label: string; detail?: string };

type SelectOptionRenderer = (option: SearchableSelectOption) => ReactNode;

/** An editable combobox for locally filtered or server-backed options. */
export function SearchableSelect({
  id,
  ariaLabel,
  value,
  options,
  placeholder,
  disabled,
  onBlur,
  onSearchChange,
  onChange,
  renderLeading,
  renderOptionEnd,
  unknownValueFallback,
  inputClassName,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
  'aria-required': ariaRequired,
}: Readonly<{
  id?: string;
  ariaLabel: string;
  value: string;
  options: readonly SearchableSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  onBlur?: () => void;
  onSearchChange?: (query: string) => void;
  onChange: (value: string) => void;
  renderLeading?: SelectOptionRenderer;
  renderOptionEnd?: SelectOptionRenderer;
  unknownValueFallback?: (value: string) => string;
  inputClassName?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  'aria-required'?: boolean;
}>) {
  const listId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState<string | null>(null);
  const [highlight, setHighlight] = useState(0);

  const selected = options.find((option) => option.value === value);
  const text = inputText(query, selected?.label, unknownValueFallback, value);
  const needle = (query ?? '').trim().toLowerCase();
  const filtered = needle ? options.filter((option) => matches(option, needle)) : options;
  const showList = open && filtered.length > 0;
  // Options can shrink under an in-flight search after the highlight moved, so
  // every read clamps to the list actually rendered rather than the stale index.
  const activeIndex = Math.min(highlight, filtered.length - 1);
  const activeOption = filtered[activeIndex];

  const commit = (option: SearchableSelectOption) => {
    onChange(option.value);
    setQuery(null);
    setOpen(false);
  };

  const close = ({ blurred = false }: { blurred?: boolean } = {}) => {
    if (blurred && query !== null) {
      const exact = exactOption(options, query);
      if (exact) {
        commit(exact);
        onBlur?.();
        return;
      }
    }
    setOpen(false);
    setQuery(null);
    if (blurred) onBlur?.();
  };

  return (
    <div ref={containerRef} className="relative">
      {renderLeading && selected ? (
        <span className="pointer-events-none absolute top-1/2 left-3 z-1 -translate-y-1/2">
          {renderLeading(selected)}
        </span>
      ) : null}
      <Input
        id={id}
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- An editable ARIA combobox supports filtering where a native select cannot.
        role="combobox"
        aria-label={ariaLabel}
        aria-controls={listId}
        aria-expanded={showList}
        aria-autocomplete="list"
        aria-activedescendant={showList && activeOption ? `${listId}-${activeIndex}` : undefined}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
        aria-required={ariaRequired}
        autoComplete="off"
        value={text}
        disabled={disabled}
        placeholder={placeholder}
        className={cn(renderLeading && selected && 'pl-10', inputClassName)}
        onFocus={() => {
          setOpen(true);
          setQuery('');
          setHighlight(0);
        }}
        onChange={(event) => {
          const nextQuery = event.target.value;
          setQuery(nextQuery);
          onSearchChange?.(nextQuery);
          setOpen(true);
          setHighlight(0);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setOpen(true);
            setHighlight((current) => Math.min(current + 1, filtered.length - 1));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
            setHighlight((current) => Math.max(current - 1, 0));
          } else if (event.key === 'Enter') {
            if (open && activeOption) {
              event.preventDefault();
              commit(activeOption);
            }
          } else if (event.key === 'Escape') {
            close();
          }
        }}
        onBlur={() => {
          setTimeout(() => {
            if (!containerRef.current?.contains(document.activeElement)) close({ blurred: true });
          }, 0);
        }}
      />
      {showList ? (
        <ul
          id={listId}
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role, jsx-a11y/no-noninteractive-element-to-interactive-role -- The popup uses ARIA options while focus remains in the editable combobox.
          role="listbox"
          aria-label={ariaLabel}
          data-open="true"
          className={cn(menuPanelClasses, 'absolute mt-1 max-h-56 w-full overflow-auto')}
        >
          {filtered.map((option, index) => (
            <li
              key={option.value}
              // By position, not value: a value may hold characters that are
              // not valid in an id reference (spaces, for one).
              id={`${listId}-${index}`}
              // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role, jsx-a11y/no-noninteractive-element-to-interactive-role -- ARIA listbox options keep focus on the editable input.
              role="option"
              aria-selected={option.value === value}
              className={cn(
                menuItemVariants({ selected: option.value === value }),
                'grid gap-x-3',
                optionGridClass(Boolean(renderLeading), Boolean(renderOptionEnd)),
                index === activeIndex && option.value !== value && 'bg-hover',
              )}
              onMouseDown={(event) => {
                event.preventDefault();
                commit(option);
              }}
              onMouseEnter={() => setHighlight(index)}
            >
              {renderLeading ? renderLeading(option) : null}
              <span className="grid min-w-0 gap-0.5">
                <span className="truncate">{option.label}</span>
                {option.detail ? (
                  <span className="text-muted truncate">{option.detail}</span>
                ) : null}
              </span>
              {renderOptionEnd ? renderOptionEnd(option) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function matches(option: SearchableSelectOption, needle: string) {
  return `${option.label} ${option.value} ${option.detail ?? ''}`.toLowerCase().includes(needle);
}

function exactOption(options: readonly SearchableSelectOption[], query: string) {
  const needle = query.trim().toLowerCase();
  return options.find(
    (option) => option.label.toLowerCase() === needle || option.value.toLowerCase() === needle,
  );
}

function optionGridClass(hasLeading: boolean, hasEnd: boolean) {
  if (hasLeading && hasEnd) return 'grid-cols-[auto_minmax(0,1fr)_auto]';
  if (hasLeading) return 'grid-cols-[auto_minmax(0,1fr)]';
  if (hasEnd) return 'grid-cols-[minmax(0,1fr)_auto]';
  return 'grid-cols-[minmax(0,1fr)]';
}

function inputText(
  query: string | null,
  selectedLabel: string | undefined,
  unknownValueFallback: ((value: string) => string) | undefined,
  value: string,
) {
  if (query !== null) return query;
  if (selectedLabel) return selectedLabel;
  return unknownValueFallback ? unknownValueFallback(value) : value;
}
