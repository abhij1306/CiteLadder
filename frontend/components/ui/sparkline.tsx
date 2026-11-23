import { chartFill, chartPath, chartStroke, type ChartTone } from '@/components/ui/chart';
import { cn } from '@/lib/utils';

const WIDTH = 80;
const HEIGHT = 24;
const PAD = 3;

const SPARK_TONE = { accent: 1, ink: 2, muted: 3 } as const satisfies Record<string, ChartTone>;

export type SparklineTone = keyof typeof SPARK_TONE;

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

export function Sparkline({
  values,
  tone = 'ink',
  label,
  className,
}: Readonly<{
  values: readonly (number | null)[];
  tone?: SparklineTone;
  label?: string;
  className?: string;
}>) {
  const points = sparkPoints(values);
  const last = points.at(-1);
  const chartTone = SPARK_TONE[tone];
  return (
    <svg // NOSONAR
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
        className={chartStroke(chartTone)}
      />
      {last ? <circle cx={last[0]} cy={last[1]} r={2.25} className={chartFill(chartTone)} /> : null}
    </svg>
  );
}
