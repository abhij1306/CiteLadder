import type { ReactNode } from 'react';

import { MenuCheckboxItem } from '@/components/ui/menu';

export type FilterIcon = 'period' | 'engines' | 'market' | 'prompts' | 'topic';

type FilterOption<T extends string = string> = Readonly<{
  value: T;
  label: string;
  mark?: ReactNode;
}>;

export type FilterOptionGroup<T extends string = string> = Readonly<{
  label?: string;
  options: readonly FilterOption<T>[];
}>;

type FilterBase = Readonly<{
  id: string;
  label: string;
  valueLabel: string;
  isDefault: boolean;
  defaultLabel: string;
  reset: () => void;
  icon?: FilterIcon;
  inFilters?: boolean;
  windowLabel?: string;
  disabled?: boolean;
}>;

export type FilterDefinition = FilterBase &
  (
    | Readonly<{
        kind: 'choice';
        value: string;
        defaultValue: string;
        groups: readonly FilterOptionGroup[];
        onChange: (value: string) => void;
        searchable?: boolean;
      }>
    | Readonly<{ kind: 'custom'; content: ReactNode }>
  );

export function choiceFilter<T extends string>({
  id,
  label,
  value,
  defaultValue,
  groups,
  onChange,
  searchable,
  valueLabel,
  icon,
  windowLabel,
  disabled,
}: Readonly<{
  id: string;
  label: string;
  value: T;
  defaultValue: T;
  groups: readonly FilterOptionGroup<T>[];
  onChange: (value: T) => void;
  searchable?: boolean;
  valueLabel?: string;
  icon?: FilterIcon;
  windowLabel?: string;
  disabled?: boolean;
}>): FilterDefinition {
  const options = groups.flatMap((group) => group.options);
  const labelOf = (key: T) => options.find((option) => option.value === key)?.label ?? label;
  return {
    kind: 'choice',
    id,
    label,
    value,
    defaultValue,
    valueLabel: valueLabel ?? labelOf(value),
    isDefault: value === defaultValue,
    defaultLabel: labelOf(defaultValue),
    reset: () => onChange(defaultValue),
    icon,
    windowLabel,
    disabled,
    groups,
    searchable,
    onChange: (raw) => {
      const picked = options.find((option) => option.value === raw);
      if (picked) onChange(picked.value);
    },
  };
}

export function rangeFilter<T extends string>({
  value,
  defaultValue,
  options,
  onChange,
}: Readonly<{
  value: T;
  defaultValue: T;
  options: readonly FilterOption<T>[];
  onChange: (value: T) => void;
}>): FilterDefinition {
  return choiceFilter({
    id: 'range',
    label: 'Period',
    icon: 'period',
    value,
    defaultValue,
    groups: [{ options }],
    onChange,
  });
}

const EVERY = '__all__';

export function singleFilter({
  id,
  label,
  allLabel,
  value,
  options,
  onChange,
  icon,
}: Readonly<{
  id: string;
  label: string;
  allLabel: string;
  value: string | null;
  options: readonly FilterOption<string>[];
  onChange: (value: string | null) => void;
  icon?: FilterIcon;
}>): FilterDefinition {
  return choiceFilter({
    id,
    label,
    icon,
    value: value ?? EVERY,
    defaultValue: EVERY,
    groups: [{ options: [{ value: EVERY, label: allLabel }, ...options] }],
    onChange: (next) => onChange(next === EVERY ? null : next),
  });
}

export function manyFilter<T extends string>({
  id,
  label,
  allLabel,
  values,
  options,
  onChange,
  icon,
}: Readonly<{
  id: string;
  label: string;
  allLabel: string;
  values: readonly T[];
  options: readonly FilterOption<T>[];
  onChange: (values: T[]) => void;
  icon?: FilterIcon;
}>): FilterDefinition {
  const chosen = new Set<string>(values);
  const picked = options.filter((option) => chosen.has(option.value));
  const [only] = picked;
  return {
    kind: 'custom',
    id,
    label,
    icon,
    valueLabel: picked.length > 1 ? `${picked.length} selected` : (only?.label ?? allLabel),
    isDefault: picked.length === 0,
    defaultLabel: allLabel,
    reset: () => onChange([]),
    content: options.map((option) => (
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
        {option.mark ? <OptionText mark={option.mark} label={option.label} /> : option.label}
      </MenuCheckboxItem>
    )),
  };
}

export function OptionText({ mark, label }: Readonly<{ mark: ReactNode; label: string }>) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="text-ink flex size-4 shrink-0 items-center justify-center">{mark}</span>
      <span className="min-w-0 truncate">{label}</span>
    </span>
  );
}
