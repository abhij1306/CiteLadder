'use client';

import { useId, type ReactNode } from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';

import { menuItemVariants, menuPanelClasses } from '@/components/ui/menu-variants';
import { cn } from '@/lib/utils';

const EMPTY_VALUE = '__citeladder_empty_value__';

const SIZER = 'invisible col-start-1 row-start-1 h-0 overflow-hidden whitespace-nowrap';

/**
 * One choice's label, taking width but no height and no ink. A text label is
 * drawn by CSS from an attribute, so it adds no text to the page: assistive
 * technology and text queries see the selected value alone.
 */
function SizerLabel({ label }: Readonly<{ label: ReactNode }>) {
  if (label === undefined || label === null || label === '') return null;
  if (typeof label === 'string')
    return (
      <span
        aria-hidden
        data-select-sizer={label}
        className={cn(SIZER, 'before:content-[attr(data-select-sizer)]')}
      />
    );
  return (
    <span aria-hidden className={SIZER}>
      {label}
    </span>
  );
}

function radixValue(value: string | undefined): string | undefined {
  return value === '' ? EMPTY_VALUE : value;
}

type SelectOption<T extends string> = {
  value: T;
  label: ReactNode;
  /**
   * A figure beside the label in the menu (a count). It never reaches the
   * trigger, so a detail that loads late or changes does not resize it.
   */
  detail?: string;
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
          'focus-ring bg-input text-foreground data-[placeholder]:text-muted flex h-[var(--control-height-md)] min-w-0 items-center justify-between gap-2 rounded-[var(--radius-control)] px-3 text-field border border-border-bold transition-[border-color,background-color] enabled:hover:border-muted disabled:cursor-not-allowed disabled:bg-disabled disabled:text-muted disabled:border-border-subtle aria-invalid:border-danger aria-invalid:enabled:hover:border-danger data-[state=open]:bg-selected enabled:active:bg-active',
          className,
        )}
      >
        {/* The value shares one grid cell with every option label, drawn
            invisibly, so the trigger is as wide as its widest choice and
            choosing another never resizes it or moves its neighbours. */}
        <span className="grid min-w-0 flex-1 text-start">
          <span className="col-start-1 row-start-1 min-w-0 truncate">
            <SelectPrimitive.Value placeholder={placeholder} />
          </span>
          <SizerLabel label={placeholder} />
          {options.map((option) => (
            <SizerLabel key={option.value} label={option.label} />
          ))}
        </span>
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
            {options.map((option, index) => (
              <SelectPrimitive.Item
                key={option.value}
                value={radixValue(option.value) ?? EMPTY_VALUE}
                disabled={option.disabled}
                aria-describedby={option.detail ? `${detailId}-${index}` : undefined}
                className={cn(menuItemVariants(), 'cursor-default py-1 pr-8 pl-3 select-none')}
              >
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                {option.detail ? (
                  <span id={`${detailId}-${index}`} className="text-muted font-numeric ms-auto">
                    {option.detail}
                  </span>
                ) : null}
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
