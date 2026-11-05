'use client';

import type { ReactNode } from 'react';
import * as RadioGroupPrimitive from '@radix-ui/react-radio-group';

import { cn } from '@/lib/utils';

export type RadioOption<T extends string> = {
  value: T;
  label: ReactNode;
  disabled?: boolean;
  description?: ReactNode;
};

/**
 * The 16px radio: a 1px `line` circle (`line-strong` on hover, decision
 * D5); selected is an `ink` disc with
 * a `surface` centre (an inset 4px ring), so the mark never changes size.
 */
const RADIO =
  'focus-ring bg-surface border-line data-[state=unchecked]:hover:border-line-strong data-[state=checked]:bg-ink data-[state=checked]:border-ink data-[state=checked]:ring-surface size-4 shrink-0 rounded-full border transition-[background-color,border-color,box-shadow] ring-inset data-[state=checked]:ring-4 disabled:cursor-not-allowed';

/**
 * RadioGroup — one choice from two to five options. `list` (default) stacks
 * the options with `space-3` between; `cards` lays them out as selectable
 * cards (`surface`, `shadow-xs`, `radius-md`, 16px padding) for choices that
 * need a sentence each, the selected card drawn with a 1px `ink` ring as a
 * shadow so it never resizes. Arrow keys move and select (Radix).
 */
export function RadioGroup<T extends string>({
  value,
  onValueChange,
  options,
  ariaLabel,
  className,
  variant = 'list',
  columns = 1,
}: Readonly<{
  value: T;
  onValueChange: (value: T) => void;
  options: readonly RadioOption<T>[];
  ariaLabel: string;
  className?: string;
  variant?: 'list' | 'cards';
  /** Cards per row. */
  columns?: 1 | 2 | 3;
}>) {
  return (
    <RadioGroupPrimitive.Root
      value={value}
      onValueChange={(next) => {
        const option = options.find((candidate) => candidate.value === next);
        if (option) onValueChange(option.value);
      }}
      aria-label={ariaLabel}
      data-radio-variant={variant}
      className={cn(
        variant === 'cards'
          ? cn(
              'grid gap-3',
              columns === 2 && 'desktop:grid-cols-2',
              columns === 3 && 'desktop:grid-cols-3',
            )
          : 'flex flex-col gap-3',
        className,
      )}
    >
      {options.map((option) =>
        variant === 'cards' ? (
          <RadioCard key={option.value} option={option} selected={option.value === value} />
        ) : (
          <label
            key={option.value}
            className={cn(
              'text-ink inline-flex cursor-pointer items-start gap-3',
              option.disabled && 'cursor-not-allowed opacity-45',
            )}
          >
            {/* The 16px circle centres on the 20px first line. */}
            <RadioGroupPrimitive.Item
              value={option.value}
              disabled={option.disabled}
              className={cn(RADIO, 'mt-0.5')}
            />
            {radioText(option)}
          </label>
        ),
      )}
    </RadioGroupPrimitive.Root>
  );
}

/** The option's label (and description), the text that names its radio. */
function radioText<T extends string>(option: RadioOption<T>) {
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <span className={cn('text-body-sm', option.description != null && 'font-medium')}>
        {option.label}
      </span>
      {option.description != null ? (
        <span className="text-body-sm text-ink-secondary">{option.description}</span>
      ) : null}
    </span>
  );
}

function RadioCard<T extends string>({
  option,
  selected,
}: Readonly<{ option: RadioOption<T>; selected: boolean }>) {
  return (
    <label
      className={cn(
        'bg-surface text-ink flex cursor-pointer items-start gap-3 rounded-md p-4 transition-[background-color,box-shadow]',
        selected ? 'ring-ink ring-1' : 'shadow-xs hover:bg-surface-sunken',
        option.disabled && 'cursor-not-allowed opacity-45 hover:bg-surface',
      )}
    >
      <RadioGroupPrimitive.Item
        value={option.value}
        disabled={option.disabled}
        className={cn(RADIO, 'mt-0.5')}
      />
      {radioText(option)}
    </label>
  );
}
