import type { ReactNode } from 'react';
import { useId } from 'react';

import { dataFillClass, type DataTone } from '@/components/ui/data-tone';
import { availabilityLabel } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Meter — a labelled value against a maximum on a thin bar: prompts tracked,
 * pages crawled, a brand's share of answers. The label (14/20 `ink`) sits left and
 * the value (14/20 `ink-secondary`, tabular) right, over a 6px `chart-grid`
 * track; `hint` says the consequence under it.
 *
 * `tone` is `ink` by default; `accent` only for your own brand's share;
 * `warning` from about 90% of a limit and `negative` when a limit is hit.
 * A score out of 100 is a `ScoreRing` (its number alone in a table), and
 * work in progress a `ProgressBar`.
 *
 * `value: null` is an unmeasured value, never zero: an empty track, no
 * `aria-valuenow`, and "Not measured" as the spoken value.
 */
export type MeterTone = 'ink' | 'accent' | 'warning' | 'negative';

const METER_FILL = {
  ink: 'bg-ink',
  accent: 'bg-data-1',
  warning: 'bg-warning',
  negative: 'bg-negative',
} as const satisfies Record<MeterTone, string>;

function percentOf(value: number | null, max: number) {
  if (value === null || max <= 0) return null;
  return (Math.min(max, Math.max(0, value)) / max) * 100;
}

/** The 6px track and its fill, labelled by the caller. */
function MeterTrack({
  value,
  max,
  fill,
  labelledBy,
  label,
  valueText,
}: Readonly<{
  value: number | null;
  max: number;
  fill: string;
  labelledBy?: string;
  label?: string;
  valueText: string;
}>) {
  const percent = percentOf(value, max);
  return (
    <div // NOSONAR -- a native <meter> cannot draw the token fill or the unmeasured state
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- A native <meter> cannot draw the token fill or the unmeasured state.
      role="meter"
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value === null ? undefined : Math.min(max, Math.max(0, value))}
      aria-valuetext={valueText}
      className="bg-chart-grid rounded-2xs block h-1.5 w-full overflow-hidden"
    >
      {percent === null ? null : (
        <span className={cn('block h-full', fill)} style={{ width: `${percent}%` }} />
      )}
    </div>
  );
}

export function Meter({
  label,
  value,
  max = 100,
  valueLabel,
  hint,
  tone = 'ink',
}: Readonly<{
  label: string;
  /** The measured value, or null when it was not measured. */
  value: number | null;
  max?: number;
  /** The shown and spoken value, e.g. "124 of 500 prompts"; defaults to "N / max". */
  valueLabel?: string;
  /** The consequence, e.g. "New prompts wait at the limit". */
  hint?: ReactNode;
  tone?: MeterTone;
}>) {
  const labelId = useId();
  const shown =
    valueLabel ?? (value === null ? availabilityLabel('not_measured') : `${value} / ${max}`);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span id={labelId} className="text-body-sm text-ink truncate">
          {label}
        </span>
        <span className="text-body-sm text-ink-secondary whitespace-nowrap tabular-nums">
          {shown}
        </span>
      </div>
      <MeterTrack
        value={value}
        max={max}
        fill={METER_FILL[tone]}
        labelledBy={labelId}
        valueText={shown}
      />
      {hint ? <p className="text-caption text-ink-muted">{hint}</p> : null}
    </div>
  );
}

/**
 * One row of a distribution: the bucket's name, its track and its figure, in
 * three columns every row of the list shares, so the tracks start and end on
 * one line. The fill takes the series' data tone.
 */
export function MeterRow({
  name,
  figure,
  value,
  max = 100,
  label,
  tone,
}: Readonly<{
  name: ReactNode;
  figure: ReactNode;
  value: number | null;
  max?: number;
  /** The accessible name of the track, e.g. "Depth 2 share of pages". */
  label: string;
  tone: DataTone;
}>) {
  const percent = percentOf(value, max);
  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-3">
      <span className="text-caption text-ink-secondary">{name}</span>
      <MeterTrack
        value={value}
        max={max}
        fill={dataFillClass(tone)}
        label={label}
        valueText={percent === null ? availabilityLabel('not_measured') : `${Math.round(percent)}%`}
      />
      <span className="text-body-sm text-ink text-right tabular-nums">{figure}</span>
    </div>
  );
}
