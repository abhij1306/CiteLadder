'use client';

import { useEffect, useState, type ReactNode } from 'react';

import { dataFillClass, type DataTone } from '@/components/ui/data-tone';
import { availabilityLabel } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Meter — the one horizontal bar for usage, progress and distribution, on a
 * 0–`max` scale.
 *
 *   - `kind="meter"` (default): a measurement within a known range — usage
 *     against an allowance, a score, a share of a distribution.
 *   - `kind="progress"`: completion of a task that is moving.
 *
 * The fill speaks `DataTone`: an outcome family when the bar carries a state
 * (usage nearing its limit), a series index when it carries one category's
 * identity in a distribution, `neutral` otherwise. Never accent.
 *
 * `value: null` is an unmeasured value, never zero: the empty track, no
 * `aria-valuenow`, and an availability `valueText` ("Not measured" by default).
 *
 * The drawing is decorative; the element carries `role`, `aria-value*` and a
 * spoken `aria-valuetext`, so the value is announced, not inferred from width.
 */
const SIZE = {
  /** 4px: inline in a row, beside a label and a value. */
  sm: 'h-1',
  /** 8px: a bar that is the row's subject. */
  md: 'h-2',
} as const;

export type MeterSize = keyof typeof SIZE;

function defaultValueText(value: number | null, max: number): string {
  if (value === null) return availabilityLabel('not_measured');
  if (max === 100) return `${value}%`;
  return `${value} of ${max}`;
}

export function Meter({
  value,
  max = 100,
  label,
  valueText,
  kind = 'meter',
  tone = 'neutral',
  size = 'sm',
  sweep = false,
  className,
}: Readonly<{
  /** The measured value, or null when it was not measured. */
  value: number | null;
  max?: number;
  /** The accessible name, e.g. "Prompt runs usage". */
  label: string;
  /**
   * Spoken value; defaults to "N%" on a 0–100 scale, else "N of max", and to
   * "Not measured" for a null value.
   */
  valueText?: string;
  kind?: 'meter' | 'progress';
  tone?: DataTone;
  size?: MeterSize;
  /** Grow from zero on mount (score bars). Respects reduced motion. */
  sweep?: boolean;
  className?: string;
}>) {
  const clamped = value === null ? null : Math.min(max, Math.max(0, value));
  const percent = clamped !== null && max > 0 ? (clamped / max) * 100 : 0;
  const [swept, setSwept] = useState(!sweep);

  useEffect(() => {
    if (!sweep) return;
    const frame = requestAnimationFrame(() => setSwept(true));
    return () => cancelAnimationFrame(frame);
  }, [sweep]);

  return (
    <div
      role={kind === 'progress' ? 'progressbar' : 'meter'} // NOSONAR -- a native <meter>/<progress> cannot carry the token fill, sweep transition or null-value state
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={clamped ?? undefined}
      aria-valuetext={valueText ?? defaultValueText(clamped, max)}
      className={cn('bg-well w-full overflow-hidden rounded-full', SIZE[size], className)}
    >
      {clamped === null ? null : (
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-[var(--motion-slow)] ease-[var(--ease-standard)] motion-reduce:transition-none',
            dataFillClass(tone),
          )}
          style={{ width: swept ? `${percent}%` : 0 }}
        />
      )}
    </div>
  );
}

/**
 * One row of a distribution: the bucket's name, its bar and its figure, in
 * three tracks every row of the list shares, so the bars start and end on one
 * line. The name track fits a short label ("Depth 4+"); the figure is
 * right-aligned in the figure face.
 */
export function MeterRow({
  name,
  figure,
  ...meter
}: Readonly<
  { name: ReactNode; figure: ReactNode } & Omit<Parameters<typeof Meter>[0], 'className'>
>) {
  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-[var(--compact-gap)]">
      <span className="type-caption">{name}</span>
      <Meter {...meter} />
      <span className="type-label font-numeric text-right">{figure}</span>
    </div>
  );
}
