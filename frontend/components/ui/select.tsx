'use client';

import type { ReactNode } from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';

import { menuItemVariants, menuPanelClasses } from '@/components/ui/menu-variants';
import { cn } from '@/lib/utils';

const EMPTY_VALUE = '__citeladder_empty_value__';

function radixValue(value: string | undefined): string | undefined {
  return value === '' ? EMPTY_VALUE : value;
}

type SelectOption<T extends string> = {
  value: T;
  label: ReactNode;
  disabled?: boolean;
};

export type SelectProps<T extends string> = {
  value?: T;
  defaultValue?: T;
  onValueChange?: (value: T) => void;
  options: readonly SelectOption<T>[];
  placeholder?: string;
  ariaLabel: string;
  disabled?: boolean;
  invalid?: boolean;
  'aria-invalid'?: boolean;
  className?: string;
  id?: string;
  required?: boolean;
  'aria-describedby'?: string;
  'aria-labelledby'?: string;
};

export function Select<T extends string>({
  value,
  defaultValue,
  onValueChange,
  options,
  placeholder,
  ariaLabel,
  disabled,
  invalid,
  'aria-invalid': ariaInvalid,
  className,
  id,
  required,
  'aria-describedby': ariaDescribedBy,
  'aria-labelledby': ariaLabelledBy,
}: Readonly<SelectProps<T>>) {
  return (
    <SelectPrimitive.Root
      value={radixValue(value)}
      defaultValue={radixValue(defaultValue)}
      onValueChange={(next) => onValueChange?.((next === EMPTY_VALUE ? '' : next) as T)}
      disabled={disabled}
    >
      <SelectPrimitive.Trigger
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        aria-invalid={invalid || ariaInvalid || undefined}
        aria-required={required || undefined}
        id={id}
        className={cn(
          'focus-ring bg-input text-foreground data-[placeholder]:text-muted flex h-[var(--control-height-md)] min-w-0 items-center justify-between gap-2 rounded-[var(--radius-control)] px-3 text-field border border-border transition-[border-color,background-color] enabled:hover:border-border-strong disabled:cursor-not-allowed disabled:bg-disabled disabled:text-muted disabled:border-border-subtle aria-invalid:border-danger aria-invalid:enabled:hover:border-danger data-[state=open]:bg-selected enabled:active:bg-active',
          className,
        )}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon asChild>
          <ChevronDown className="text-muted size-4 shrink-0" aria-hidden />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={6}
          collisionPadding={8}
          className={cn(
            menuPanelClasses,
            'max-h-[min(20rem,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)]',
          )}
        >
          <SelectPrimitive.ScrollUpButton className="text-muted flex h-[var(--menu-item-height)] items-center justify-center">
            <ChevronUp className="size-4" aria-hidden />
          </SelectPrimitive.ScrollUpButton>
          <SelectPrimitive.Viewport>
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={radixValue(option.value) ?? EMPTY_VALUE}
                disabled={option.disabled}
                className={cn(menuItemVariants(), 'cursor-default py-1 pr-8 pl-3 select-none')}
              >
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="absolute right-2 inline-flex items-center">
                  <Check className="size-4" aria-hidden />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
          <SelectPrimitive.ScrollDownButton className="text-muted flex h-[var(--menu-item-height)] items-center justify-center">
            <ChevronDown className="size-4" aria-hidden />
          </SelectPrimitive.ScrollDownButton>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
