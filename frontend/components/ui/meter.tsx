import type { ReactNode } from 'react';
import { useId } from 'react';

import { Absence } from '@/components/ui/absence';
import { availabilityLabel, formatPercent } from '@/lib/format';
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
  accent: 'bg-data-you',
  warning: 'bg-warning',
  negative: 'bg-negative',
} as const satisfies Record<MeterTone, string>;

const FILL_MOTION =
  'block h-full [transition:width_var(--motion-slide)_var(--ease-standard),background-color_var(--motion-open)_var(--ease-standard)]';

function percentOf(value: number | null, max: number) {
  if (value === null || max <= 0) return null;
  return (Math.min(max, Math.max(0, value)) / max) * 100;
}

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
      className="bg-well [[data-public-surface]_&]:bg-rule rounded-mark block h-1.5 w-full overflow-hidden"
    >
      {percent === null ? null : (
        <span className={cn(FILL_MOTION, fill)} style={{ width: `${percent}%` }} />
      )}
    </div>
  );
}

export function MeterLabelRow({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 [[data-public-surface]_&]:flex-nowrap">
      {children}
    </div>
  );
}

const METER_MAX = 100;

export function Meter({
  label,
  value,
  valueLabel,
  tone = 'ink',
}: Readonly<{
  label: string;
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
    valueLabel ?? (value === null ? availabilityLabel('not_measured') : `${value} / ${METER_MAX}`);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <MeterLabelRow>
        <span
          id={labelId}
          className="text-body-sm text-ink [[data-public-surface]_&]:min-w-0 [[data-public-surface]_&]:break-words"
        >
          {label}
        </span>
        <span className="text-body-sm text-ink-2 whitespace-nowrap tabular-nums">
          {valueLabel === undefined && value === null ? <Absence state="not_measured" /> : shown}
        </span>
      </MeterLabelRow>
      <MeterTrack
        value={value}
        max={METER_MAX}
        fill={METER_FILL[tone]}
        labelledBy={labelId}
        valueText={shown}
      />
    </div>
  );
}

export function CellMeter({
  label,
  value,
  max,
  valueText,
  tone,
}: Readonly<{ label: string; value: number; max: number; valueText: string; tone: MeterTone }>) {
  const shown = Math.min(max, Math.max(0, value));
  const percent = max > 0 ? (shown / max) * 100 : 100;
  return (
    <div // NOSONAR -- a native <meter> cannot draw the token fill
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- A native <meter> cannot draw the token fill.
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={shown}
      aria-valuetext={valueText}
      data-meter-tone={tone}
      className="bg-well rounded-mark block h-2 w-30 overflow-hidden"
    >
      <span className={cn(FILL_MOTION, METER_FILL[tone])} style={{ width: `${percent}%` }} />
    </div>
  );
}

const ROW_FILL = { neutral: 'bg-control-line', accent: 'bg-data-you' } as const;

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
  label: string;
  tone: keyof typeof ROW_FILL;
}>) {
  const percent = percentOf(value, max);
  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-3">
      <span className="text-caption text-ink-2">{name}</span>
      <MeterTrack
        value={value}
        max={max}
        fill={ROW_FILL[tone]}
        label={label}
        valueText={
          percent === null ? availabilityLabel('not_measured') : formatPercent(percent / 100)
        }
      />
      <span className="text-body-sm text-ink text-right tabular-nums">{figure}</span>
    </div>
  );
}
