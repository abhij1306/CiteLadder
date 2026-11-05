'use client';

import type { ReactNode } from 'react';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check, Minus } from 'lucide-react';

import { cn } from '@/lib/utils';

type VisibleCheckboxLabel = Exclude<ReactNode, null | undefined | boolean>;

type AccessibleCheckbox =
  | { label: VisibleCheckboxLabel; description?: ReactNode; 'aria-label'?: never }
  | { label?: never; description?: never; 'aria-label': string };

export type CheckboxProps = AccessibleCheckbox & {
  checked: boolean | 'indeterminate';
  onCheckedChange: (checked: boolean | 'indeterminate') => void;
  disabled?: boolean;
  className?: string;
  /** A child of a "select all" checkbox above it, indented by `space-6`. */
  nested?: boolean;
  id?: string;
  name?: string;
  required?: boolean;
  'aria-describedby'?: string;
};

/**
 * The 16px box: `surface` with the soft field edge (`line`, `shadow-edge`,
 * `line-strong` on hover; decision D5); checked and
 * indeterminate are an `ink` fill with an `on-ink` check or dash. Shared with
 * the table's row checkbox.
 */
const CHECK_BOX =
  'focus-ring bg-surface border-line shadow-edge data-[state=unchecked]:hover:border-line-strong text-on-ink data-[state=checked]:bg-ink data-[state=checked]:border-ink data-[state=indeterminate]:bg-ink data-[state=indeterminate]:border-ink grid size-4 shrink-0 place-items-center rounded-xs border transition-[background-color,border-color] duration-[var(--motion-fast)] disabled:cursor-not-allowed';

function Box({
  checked,
  onCheckedChange,
  disabled,
  id,
  name,
  required,
  ariaLabel,
  ariaDescribedBy,
}: Readonly<{
  checked: boolean | 'indeterminate';
  onCheckedChange: (checked: boolean | 'indeterminate') => void;
  disabled?: boolean;
  id?: string;
  name?: string;
  required?: boolean;
  ariaLabel?: string;
  ariaDescribedBy?: string;
}>) {
  return (
    <CheckboxPrimitive.Root
      id={id}
      name={name}
      required={required}
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
      className={CHECK_BOX}
    >
      <CheckboxPrimitive.Indicator>
        {checked === 'indeterminate' ? (
          <Minus className="size-3 [stroke-width:3]" aria-hidden />
        ) : (
          <Check className="size-3 [stroke-width:3]" aria-hidden />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

/**
 * Checkbox — a 16px box with a label (14/20 `ink`) and an optional
 * description below it in `ink-secondary`, which turns the label medium. The
 * whole row is the click target; focus is the 2px ring on the box. Disabled is
 * 45%, with the reason in the description.
 */
export function Checkbox({
  checked,
  onCheckedChange,
  label,
  description,
  disabled,
  className,
  nested = false,
  id,
  name,
  required,
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedBy,
}: Readonly<CheckboxProps>) {
  if ((label == null || typeof label === 'boolean') && !ariaLabel) {
    throw new Error('Checkbox requires a visible label or aria-label.');
  }

  const box = (
    <Box
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      id={id}
      name={name}
      required={required}
      ariaLabel={ariaLabel}
      ariaDescribedBy={ariaDescribedBy}
    />
  );

  if (label == null || typeof label === 'boolean') {
    return <span className={cn('inline-flex h-5 items-center', className)}>{box}</span>;
  }

  return (
    <label
      className={cn(
        'text-ink inline-flex cursor-pointer items-start gap-3',
        disabled && 'cursor-not-allowed opacity-45',
        nested && 'ms-6',
        className,
      )}
    >
      <span className="inline-flex h-5 shrink-0 items-center">{box}</span>
      <span className="flex min-w-0 flex-col">
        <span className={cn('text-body-sm', description != null && 'font-medium')}>{label}</span>
        {description != null ? (
          <span className="text-body-sm text-ink-secondary">{description}</span>
        ) : null}
      </span>
    </label>
  );
}
