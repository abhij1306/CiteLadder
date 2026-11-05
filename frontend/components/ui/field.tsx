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
      <label htmlFor={id} className="text-label text-ink">
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

/**
 * FormRow — one row of a settings card: the label and a one-sentence
 * description in a 2-part column, the control (or a stack of controls) in a
 * 3-part column that stops at `container-narrow`, `space-8` apart with
 * `space-6` above and below; consecutive rows are divided by a `line` rule.
 * Below the desktop breakpoint the columns stack. Pass the control without its own label and
 * its id as `htmlFor`.
 */
export function FormRow({
  label,
  description,
  htmlFor,
  children,
}: Readonly<{
  label: string;
  description?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
}>) {
  const LabelTag = htmlFor ? 'label' : 'p';
  return (
    <div className="border-line desktop:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] desktop:gap-[var(--page-section-gap)] grid grid-cols-1 gap-3 py-[var(--card-padding)] first:pt-0 last:pb-0 [&+&]:border-t">
      <div>
        <LabelTag {...(htmlFor ? { htmlFor } : {})} className="text-label text-ink block">
          {label}
        </LabelTag>
        {description ? <p className="text-body-sm text-ink-secondary mt-1">{description}</p> : null}
      </div>
      <div className="max-w-narrow flex min-w-0 flex-col gap-3">{children}</div>
    </div>
  );
}
