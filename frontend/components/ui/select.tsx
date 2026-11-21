import { useId, type ReactNode } from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';

import { TRIGGER_BOX } from '@/components/ui/input';
import { MENU_PANEL, menuItemClasses } from '@/components/ui/menu';
import { Check, ChevronDown, ChevronUp } from '@/lib/icons';
import { cn } from '@/lib/utils';

const EMPTY_VALUE = '__citeladder_empty_value__';

/** An empty value with no empty option shows the placeholder (Radix's `''`). */
function shownValue(
  value: string | undefined,
  options: readonly { value: string }[],
): string | undefined {
  if (value === '' && !options.some((option) => option.value === '')) return '';
  return radixValue(value);
}

function radixValue(value: string | undefined): string | undefined {
  return value === '' ? EMPTY_VALUE : value;
}

type SelectOption<T extends string> = {
  value: T;
  label: ReactNode;
  detail?: string;
  description?: string;
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
  const detailId = useId();
  return (
    <SelectPrimitive.Root
      value={shownValue(value, options)}
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
          'focus-input press',
          TRIGGER_BOX,
          'data-[placeholder]:text-ink-2 flex w-auto min-w-0 items-center justify-between gap-2 text-start disabled:cursor-not-allowed disabled:opacity-60',
          className,
        )}
      >
        <span className="min-w-0 flex-1 truncate text-start">
          <SelectPrimitive.Value placeholder={placeholder} />
        </span>
        <SelectPrimitive.Icon asChild>
          <ChevronDown className="text-ink-2 size-3.5 shrink-0" aria-hidden />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={6}
          collisionPadding={8}
          className={cn(
            MENU_PANEL,
            'max-h-[min(18.5rem,var(--radix-select-content-available-height))] min-w-[max(15rem,var(--radix-select-trigger-width))]',
          )}
        >
          <SelectPrimitive.ScrollUpButton className="text-ink-2 flex h-[var(--control-md)] items-center justify-center">
            <ChevronUp className="size-3.5" aria-hidden />
          </SelectPrimitive.ScrollUpButton>
          <SelectPrimitive.Viewport>
            {options.map((option, index) => (
              <SelectPrimitive.Item
                key={option.value}
                value={radixValue(option.value) ?? EMPTY_VALUE}
                disabled={option.disabled}
                aria-describedby={option.detail ? `${detailId}-${index}` : undefined}
                className={menuItemClasses({
                  className: cn('pe-8', option.description && 'min-h-12'),
                })}
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">
                    <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                  </span>
                  {option.description ? (
                    <span className="type-caption">{option.description}</span>
                  ) : null}
                </span>
                {option.detail ? (
                  <span id={`${detailId}-${index}`} className="type-caption ms-auto tabular-nums">
                    {option.detail}
                  </span>
                ) : null}
                <SelectPrimitive.ItemIndicator className="absolute right-2 inline-flex items-center">
                  <Check className="size-3.5" aria-hidden />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
          <SelectPrimitive.ScrollDownButton className="text-ink-2 flex h-[var(--control-md)] items-center justify-center">
            <ChevronDown className="size-3.5" aria-hidden />
          </SelectPrimitive.ScrollDownButton>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
