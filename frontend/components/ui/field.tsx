import { useId, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

type ControlProps = {
  id: string;
  required?: boolean;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
};

/**
 * Field — a control with its label above (14/20 medium `ink`) and one line of
 * hint or error below (12/16; `ink-muted`, or `negative` for an error), 6px
 * apart. Never hint and error together: the error replaces the hint. An
 * optional counter ("48/200") sits at the right of that line in mono,
 * turning `ink` at the limit. The label is tied to the control through the
 * id passed to `children`.
 */
export function Field({
  label,
  hint,
  error,
  required,
  count,
  className,
  children,
}: Readonly<{
  label: string;
  hint?: string;
  error?: ReactNode;
  required?: boolean;
  /** The characters used and the limit, for a Textarea with `maxLength`. */
  count?: { used: number; max: number };
  className?: string;
  children: (props: ControlProps) => ReactNode;
}>) {
  const id = useId();
  const messageId = `${id}-msg`;
  const message = error ?? hint;

  return (
    <div className={cn('flex min-w-0 flex-col gap-2', className)}>
      <label htmlFor={id} className="text-body-sm text-ink">
        {label}
        {required ? <span className="text-ink-muted ms-0.5">*</span> : null}
      </label>
      {children({
        id,
        required,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': message ? messageId : undefined,
      })}
      <FieldFoot id={messageId} hint={hint} error={error} count={count} />
    </div>
  );
}

function FieldFoot({
  id,
  hint,
  error,
  count,
}: Readonly<{
  id: string;
  hint?: string;
  error?: ReactNode;
  count?: { used: number; max: number };
}>) {
  if (!hint && !error && !count) return null;
  // The error replaces the hint while it stands; an empty slot keeps the count right.
  let note: ReactNode = <span />;
  if (error) {
    note = (
      <p id={id} role="alert" className="text-caption text-negative">
        {error}
      </p>
    );
  } else if (hint) {
    note = (
      <p id={id} className="text-caption text-ink-muted">
        {hint}
      </p>
    );
  }
  return (
    <div className="flex items-start justify-between gap-3">
      {note}
      {count ? (
        <span
          className={cn(
            'ms-auto shrink-0 font-mono text-caption',
            count.used >= count.max ? 'text-ink' : 'text-ink-muted',
          )}
        >
          {`${count.used}/${count.max}`}
        </span>
      ) : null}
    </div>
  );
}
