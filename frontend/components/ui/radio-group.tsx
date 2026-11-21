import type { ReactNode } from 'react';
import * as RadioGroupPrimitive from '@radix-ui/react-radio-group';

import { cn } from '@/lib/utils';

export type RadioOption<T extends string> = {
  value: T;
  label: ReactNode;
  disabled?: boolean;
  description?: ReactNode;
};

const RADIO =
  'press [--press:0.95] focus-ring bg-panel border-rule enabled:data-[state=unchecked]:hover:border-control-line data-[state=checked]:bg-primary data-[state=checked]:border-primary data-[state=checked]:ring-panel hit-area [--target-hit:var(--target-min)] size-4 shrink-0 rounded-full border ring-inset data-[state=checked]:ring-4 disabled:cursor-not-allowed';

const LIST_LAYOUT = {
  list: 'flex flex-col gap-3',
  inline: 'flex flex-row flex-wrap gap-x-6 gap-y-2',
} as const;

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
  variant?: 'list' | 'inline' | 'cards';
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
              columns === 2 && 'column-split:grid-cols-2',
              columns === 3 && 'column-split:grid-cols-3',
            )
          : LIST_LAYOUT[variant],
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
              'text-ink inline-flex cursor-pointer items-start gap-2',
              option.disabled && 'cursor-not-allowed opacity-60',
            )}
          >
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

function radioText<T extends string>(option: RadioOption<T>) {
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="type-body">{option.label}</span>
      {option.description != null ? (
        <span className="type-body text-ink-2">{option.description}</span>
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
        'text-ink flex cursor-pointer items-start gap-2 rounded-control border p-4 transition-[background-color,border-color]',
        selected ? 'bg-panel overlay-selected border-control-line' : 'bg-panel border-rule',
        !selected && !option.disabled && 'hover:overlay-hover',
        option.disabled && 'cursor-not-allowed opacity-60',
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
