import { useId, type ReactNode } from 'react';

import { cn } from '@/lib/utils';
import { textRole } from '@/components/ui/typography';

/**
 * Field — wraps a control with a label, optional hint, and an inline
 * error. The label is associated to the control via a generated id (passed
 * through the `children` render prop) for accessibility.
 */
export function Field({
  label,
  hint,
  error,
  required,
  className,
  labelClassName,
  children,
}: Readonly<{
  label: string;
  hint?: string;
  error?: ReactNode;
  required?: boolean;
  className?: string;
  labelClassName?: string;
  children: (props: {
    id: string;
    required?: boolean;
    'aria-invalid'?: boolean;
    'aria-describedby'?: string;
  }) => ReactNode;
}>) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy =
    [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cn('grid gap-2', className)}>
      <label htmlFor={id} className={textRole('label', labelClassName)}>
        {label}
        {required ? <span className="text-muted ms-0.5">*</span> : null}
      </label>
      {children({
        id,
        required,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': describedBy,
      })}
      {hint && !error ? (
        <span id={hintId} className="type-caption">
          {hint}
        </span>
      ) : null}
      {error ? (
        <span id={errorId} role="alert" className="type-caption text-danger-text">
          {error}
        </span>
      ) : null}
    </div>
  );
}
