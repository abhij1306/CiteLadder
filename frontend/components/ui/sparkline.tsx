import { CHART_FILL, CHART_STROKE, chartPath, type ChartTone } from '@/components/ui/chart';
import { cn } from '@/lib/utils';

const WIDTH = 80;
const HEIGHT = 24;
const PAD = 3;

const SPARK_TONE = { accent: 1, ink: 2, muted: 3 } as const satisfies Record<string, ChartTone>;

export type SparklineTone = keyof typeof SPARK_TONE;

/** The points on the series' own min-to-max scale; a `null` stays a gap. */
function sparkPoints(values: readonly (number | null)[]) {
  const measured = values.filter((value): value is number => value !== null);
  const low = measured.length ? Math.min(...measured) : 0;
  const span = (measured.length ? Math.max(...measured) : 1) - low || 1;
  const step = values.length > 1 ? (WIDTH - PAD * 2) / (values.length - 1) : 0;
  return values.map((value, index) =>
    value === null
      ? null
      : ([PAD + index * step, PAD + (HEIGHT - PAD * 2) * (1 - (value - low) / span)] as const),
  );
}

/**
 * Sparkline — a fixed 80 × 24 line for a table cell or a stat: the shape of
 * the last few weeks, with a dot on the latest value. Scaled to its own min
 * and max, so levels are compared by the number beside it, never the line.
 * No axes, tooltips or fills. Decorative unless given a `label`.
 */
export function Sparkline({
  values,
  tone = 'ink',
  label,
  className,
}: Readonly<{
  /** Oldest first; `null` is unavailable and leaves a gap. */
  values: readonly (number | null)[];
  /** `accent` for your brand, `ink` for the leader, `muted` for others. */
  tone?: SparklineTone;
  /** Its name, when no number sits beside it. */
  label?: string;
  className?: string;
}>) {
  const points = sparkPoints(values);
  const last = points.at(-1);
  const chartTone = SPARK_TONE[tone];
  return (
    <svg // NOSONAR -- an inline SVG drawing is named with role="img", not an <img> file
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      width={WIDTH}
      height={HEIGHT}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className={cn('inline-block shrink-0 overflow-visible align-middle', className)}
    >
      <path
        d={chartPath(points)}
        fill="none"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={CHART_STROKE[chartTone]}
      />
      {last ? (
        <circle cx={last[0]} cy={last[1]} r={2.25} className={CHART_FILL[chartTone]} />
      ) : null}
    </svg>
  );
}
