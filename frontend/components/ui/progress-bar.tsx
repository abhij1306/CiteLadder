import { useId } from 'react';

import { cn } from '@/lib/utils';

/** The busy segment: 36% of the track sliding across (slower under reduced motion). */
const BUSY_FILL = 'bg-ink absolute top-0 left-0 h-full w-[36%] animate-progress-busy';

/**
 * ProgressBar — a thin bar for work that takes more than a few seconds: a
 * prompt run, a crawl, an export. A 6px `radius-2xs` track in `line` with an
 * `ink` fill growing in 200ms; without `value` it is busy. The label (14/20
 * medium `ink`) sits left and the value (mono 13 `ink-secondary`) right; count
 * in the product's units with `valueLabel` ("48 of 120 prompts") when you can.
 * Never coloured by status.
 */
export function ProgressBar({
  label,
  value,
  max = 100,
  valueLabel,
  className,
}: Readonly<{
  label?: string;
  /** Omit for busy. */
  value?: number;
  max?: number;
  valueLabel?: string;
  className?: string;
}>) {
  const labelId = useId();
  const busy = value === undefined;
  const percent = busy ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  const shown = valueLabel ?? (busy ? null : `${Math.round(percent)}%`);
  return (
    <div className={cn('flex min-w-0 flex-col gap-2', className)}>
      <ProgressCaption labelId={labelId} label={label} shown={shown} />
      {/* The native bar carries the value to assistive technology (no value
          is busy); the drawn track beside it is decoration. */}
      <progress
        className="sr-only"
        aria-labelledby={label ? labelId : undefined}
        aria-label={label ? undefined : 'Progress'}
        max={max}
        value={busy ? undefined : value}
        aria-valuetext={valueLabel}
        aria-busy={busy || undefined}
      />
      <div aria-hidden className="bg-line rounded-2xs relative h-1.5 overflow-hidden">
        {busy ? (
          <span className={BUSY_FILL} />
        ) : (
          <span
            className="bg-ink block h-full transition-[width] duration-[var(--motion-slow)] ease-[var(--ease-standard)]"
            style={{ width: `${percent}%` }}
          />
        )}
      </div>
    </div>
  );
}

/** The label on the left and the shown value on the right, when either exists. */
function ProgressCaption({
  labelId,
  label,
  shown,
}: Readonly<{ labelId: string; label?: string; shown: string | null }>) {
  if (!label && !shown) return null;
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span id={labelId} className="text-body-sm text-ink">
        {label}
      </span>
      {shown ? (
        <span className="text-ink-secondary text-caption font-mono whitespace-nowrap">{shown}</span>
      ) : null}
    </div>
  );
}

/**
 * BusyBar —a background refresh over content that stays visible: the
 * ProgressBar's busy segment on a 2px track along the region's top edge,
 * positioned so appearing and disappearing never moves the content.
 */
export function BusyBar({ active, label }: Readonly<{ active: boolean; label: string }>) {
  if (!active) return null;
  return (
    <div className="bg-line absolute inset-x-0 top-0 z-1 h-0.5 overflow-hidden">
      <progress className="sr-only" aria-label={label} aria-busy />
      <span aria-hidden className={BUSY_FILL} />
    </div>
  );
}
