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
  /** A sub-option of the checkbox above it (a subtopic under its topic). */
  nested?: boolean;
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
      ? 'border-accent-fill bg-accent-fill'
      : 'border-border-bold bg-input group-hover:border-border-strong',
  );
}

export function Checkbox({
  checked,
  onCheckedChange,
  label,
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
    <label
      className={cn(
        'type-body text-foreground inline-flex items-center gap-2',
        // A sub-option sits one checkbox in from its parent, so the tree reads.
        nested && 'ms-6',
        className,
      )}
    >
      {control}
      <span className={cn(disabled && 'text-muted')}>{label}</span>
    </label>
  );
}

/**
 * CheckboxCaption — a caption line under a labelled checkbox, starting where
 * the label's text starts (the 32px target plus the label's 8px gap above),
 * so a notice or an error reads as part of that choice. Point the checkbox's
 * `aria-describedby` at its `id`.
 *
 * `tone="error"` is the danger ink and an alert while `shown`; while not
 * shown it keeps its line (invisible and hidden from assistive tech), so the
 * form does not move when the error appears.
 */
export function CheckboxCaption({
  id,
  tone = 'note',
  shown = true,
  children,
}: Readonly<{
  id: string;
  tone?: 'note' | 'error';
  shown?: boolean;
  children: ReactNode;
}>) {
  const error = tone === 'error';
  return (
    <p
      id={id}
      role={error && shown ? 'alert' : undefined}
      aria-hidden={shown ? undefined : true}
      className={cn(
        'type-caption ps-[calc(var(--control-height-md)+0.5rem)]',
        error && 'text-danger-text',
        !shown && 'invisible',
      )}
    >
      {children}
    </p>
  );
}
