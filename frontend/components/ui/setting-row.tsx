import { useId, type ReactNode } from 'react';

import { FieldFoot, type ControlProps } from '@/components/ui/field';
import { SLIP_FACE } from '@/components/ui/slip';
import { StateHeadingLevelContext } from '@/components/ui/state-heading-level';
import { textRole } from '@/components/ui/typography';
import { cn } from '@/lib/utils';

export function SettingsGroup({
  title,
  status,
  description,
  action,
  id,
  region = true,
  children,
}: Readonly<{
  title: ReactNode;
  status?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  id?: string;
  region?: boolean;
  children: ReactNode;
}>) {
  const titleId = useId();
  return (
    <section
      id={id}
      aria-labelledby={region ? titleId : undefined}
      data-settings-group=""
      className="grid min-w-0 gap-3"
    >
      <header className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div className="grid min-w-0 flex-1 basis-60 gap-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h2
              id={titleId}
              className={textRole('heading', 'flex min-w-0 items-center gap-2 break-words')}
            >
              {title}
            </h2>
            {status}
          </div>
          {description ? <p className={textRole('caption')}>{description}</p> : null}
        </div>
        {action ? <div className="flex flex-wrap items-center gap-2">{action}</div> : null}
      </header>
      <StateHeadingLevelContext value={3}>{children}</StateHeadingLevelContext>
    </section>
  );
}

export function SettingRows({
  label,
  foot,
  children,
}: Readonly<{ label?: string; foot?: ReactNode; children: ReactNode }>) {
  return (
    <div
      data-setting-rows=""
      aria-label={label}
      role={label ? 'group' : undefined}
      className={settingRowsClasses()}
    >
      {children}
      {foot ? <div className="flex flex-wrap items-center justify-end gap-2">{foot}</div> : null}
    </div>
  );
}

export function settingRowsClasses(className?: string) {
  return cn(
    SLIP_FACE,
    'divide-rule grid min-w-0 divide-y overflow-hidden *:min-h-13 *:px-4 *:py-3',
    className,
  );
}

export function SettingRow({
  label,
  description,
  value,
  action,
  control,
  children,
}: Readonly<{
  label: ReactNode;
  description?: ReactNode;
  control?: ReactNode;
  value?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
}>) {
  const hasValue = value !== undefined && value !== null;
  return (
    <div data-setting-row="" className="grid min-w-0 content-center gap-3">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <RowName label={label} description={description} />
        {hasValue || action ? (
          <div className="flex max-w-full min-w-0 flex-wrap items-center justify-end gap-2">
            {hasValue ? (
              <div className={textRole('body', 'text-ink-2 min-w-0 text-end break-words')}>
                {value}
              </div>
            ) : null}
            {action}
          </div>
        ) : null}
        {control ? <div className="grid w-80 max-w-full min-w-0 *:w-full">{control}</div> : null}
      </div>
      {children}
    </div>
  );
}

export function SettingField({
  label,
  hint,
  error,
  required,
  inline = false,
  children,
}: Readonly<{
  label: string;
  hint?: string;
  error?: ReactNode;
  required?: boolean;
  inline?: boolean | 'wide';
  children: (props: ControlProps) => ReactNode;
}>) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');
  const control = children({
    id,
    required,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy || undefined,
  });
  return (
    <div
      data-setting-row=""
      className={
        inline
          ? 'flex min-w-0 flex-wrap items-center justify-between gap-x-6 gap-y-2'
          : 'grid min-w-0 gap-2'
      }
    >
      <div className="grid min-w-0 flex-1 basis-60 content-start gap-0.5">
        <label htmlFor={id} className={textRole('label')}>
          {label}
          {required ? (
            <span aria-hidden="true" className="text-ink-2 ms-0.5">
              *
            </span>
          ) : null}
        </label>
        {hint ? (
          <p id={hintId} className={textRole('caption')}>
            {hint}
          </p>
        ) : null}
      </div>
      <div
        className={cn(
          'grid min-w-0 gap-1',
          inline === true && 'w-44 max-w-full *:w-full',
          inline === 'wide' && 'w-80 max-w-full *:w-full',
        )}
      >
        {control}
        {error ? <FieldFoot id={errorId} error={error} /> : null}
      </div>
    </div>
  );
}

function RowName({ label, description }: Readonly<{ label: ReactNode; description?: ReactNode }>) {
  return (
    <div className="grid min-w-0 flex-1 basis-60 gap-0.5">
      <div className={textRole('label')}>{label}</div>
      {description === undefined || description === null ? null : (
        <div className={textRole('caption', 'min-w-0 break-words')}>{description}</div>
      )}
    </div>
  );
}
