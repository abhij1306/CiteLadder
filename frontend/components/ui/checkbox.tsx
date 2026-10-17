'use client';

import type { ReactNode } from 'react';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check, Minus } from 'lucide-react';

import { cn } from '@/lib/utils';

type VisibleCheckboxLabel = Exclude<ReactNode, null | undefined | boolean>;

type AccessibleCheckbox =
  | { label: VisibleCheckboxLabel; 'aria-label'?: never }
  | { label?: never; 'aria-label': string };

export type CheckboxProps = AccessibleCheckbox & {
  checked: boolean | 'indeterminate';
  onCheckedChange: (checked: boolean | 'indeterminate') => void;
  disabled?: boolean;
  className?: string;
  id?: string;
  name?: string;
  required?: boolean;
  'aria-describedby'?: string;
};

function checkboxStateClass(checked: boolean | 'indeterminate', disabled: boolean | undefined) {
  if (disabled) return 'border-border-subtle bg-disabled text-muted';
  return cn(
    'text-accent-fg',
    checked
      ? 'border-accent bg-accent'
      : 'border-border-bold bg-input group-hover:border-border-strong',
  );
}

export function Checkbox({
  checked,
  onCheckedChange,
  label,
  disabled,
  className,
  id,
  name,
  required,
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedBy,
}: Readonly<CheckboxProps>) {
  if ((label == null || typeof label === 'boolean') && !ariaLabel) {
    throw new Error('Checkbox requires a visible label or aria-label.');
  }

  const boxStateClass = checkboxStateClass(checked, disabled);
  const control = (
    <CheckboxPrimitive.Root
      id={id}
      name={name}
      required={required}
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
      className="focus-ring group enabled:hover:bg-hover enabled:active:bg-active disabled:bg-disabled grid min-h-[var(--control-height-md)] min-w-[var(--control-height-md)] shrink-0 place-items-center rounded-[var(--radius-control)] disabled:cursor-not-allowed"
    >
      <span
        className={cn(
          'grid size-4 place-items-center rounded-xs border transition-[background-color,border-color] duration-[var(--motion-fast)]',
          boxStateClass,
        )}
      >
        <CheckboxPrimitive.Indicator>
          {checked === 'indeterminate' ? (
            <Minus className="size-3" aria-hidden />
          ) : (
            <Check className="size-3" aria-hidden />
          )}
        </CheckboxPrimitive.Indicator>
      </span>
    </CheckboxPrimitive.Root>
  );

  if (label == null || typeof label === 'boolean') {
    return <span className={className}>{control}</span>;
  }

  return (
    <label className={cn('type-body text-foreground inline-flex items-center gap-2', className)}>
      {control}
      <span className={cn(disabled && 'text-muted')}>{label}</span>
    </label>
  );
}
