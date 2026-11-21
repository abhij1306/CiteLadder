import { useContext } from 'react';
import { Cell, Pie, PieChart } from 'recharts';

import { chartPercent } from '@/components/ui/chart';
import { ChartTable } from '@/components/ui/chart-frame';
import { seriesColor } from '@/components/ui/chart-tooltip';
import {
  SERIES_FILL,
  SeriesTonesContext,
  seriesTone,
  type SeriesTone,
} from '@/components/ui/step-chart-parts';
import { textRole } from '@/components/ui/typography';
import { formatCount } from '@/lib/format';
import { cn } from '@/lib/utils';

export type Part = Readonly<{
  label: string;
  value: number;
  you?: boolean;
  other?: boolean;
  identity?: string;
  status?: PartStatus;
}>;

type PartStatus = 'positive' | 'neutral' | 'negative' | 'warning';

const STATUS_INK: Record<PartStatus, { color: string; fill: string }> = {
  positive: { color: 'var(--color-positive)', fill: 'bg-positive' },
  neutral: { color: 'var(--color-data-other)', fill: 'bg-data-other' },
  negative: { color: 'var(--color-negative)', fill: 'bg-negative' },
  warning: { color: 'var(--color-warning)', fill: 'bg-warning' },
};

const WELL = 'var(--color-well)';

type Row = Readonly<{
  label: string;
  value: number;
  ink: { part: string; color: string; fill: string } | null;
  share: number;
}>;

function partInk(status: PartStatus | undefined, tone: SeriesTone): NonNullable<Row['ink']> {
  if (status) return { part: status, ...STATUS_INK[status] };
  return { part: tone, color: seriesColor(tone), fill: SERIES_FILL[tone] };
}

export function PartDonut({
  parts,
  total,
  totalLabel,
  remainderLabel = 'Unclassified',
  format = formatCount,
  label,
}: Readonly<{
  parts: readonly Part[];
  total?: number;
  totalLabel?: string;
  remainderLabel?: string;
  format?: (value: number) => string;
  label: string;
}>) {
  const shown = parts.slice(0, 4);
  const sum = shown.reduce((carry, part) => carry + part.value, 0);
  const whole = Math.max(total ?? sum, sum);
  const remainder = whole - sum;
  const hasYou = shown.some((part) => part.you);
  const known = useContext(SeriesTonesContext);
  const rows: Row[] = shown.map((part, index) => {
    const rank = shown.slice(0, index).filter((before) => !before.you && !before.other).length;
    const placed = seriesTone(part, hasYou ? rank + 1 : rank, hasYou);
    let tone: SeriesTone = part.you ? 'you' : placed;
    if (!part.you && !part.other) tone = known?.get(part.identity ?? part.label) ?? placed;
    const ink = partInk(part.status, tone);
    return { label: part.label, value: part.value, ink, share: whole ? part.value / whole : 0 };
  });
  if (remainder > 0)
    rows.push({ label: remainderLabel, value: remainder, ink: null, share: remainder / whole });
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-3">
      <ChartTable
        label={totalLabel ? `${label}: ${format(whole)} ${totalLabel}` : label}
        columns={['Share', 'Value']}
        rows={rows.map((row) => ({
          name: row.label,
          values: [chartPercent(row.value, whole), format(row.value)],
        }))}
        notes={[]}
      />
      <div aria-hidden className="relative w-36 shrink-0">
        <DonutRing
          size={144}
          segments={rows.map((row) => ({
            key: row.label,
            share: row.share,
            color: row.ink?.color ?? WELL,
          }))}
        />
        {totalLabel ? (
          <span className="absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className={textRole('figure')}>{format(whole)}</span>
            <span className={textRole('caption')}>{totalLabel}</span>
          </span>
        ) : null}
      </div>
      <ul aria-hidden className="flex min-w-44 flex-1 flex-col gap-2">
        {rows.map((row) => (
          <li key={row.label} className={textRole('body', 'flex min-w-0 items-center gap-2')}>
            <span
              data-part={row.ink?.part ?? 'remainder'}
              className={cn('rounded-full size-2 shrink-0', row.ink?.fill ?? 'bg-well')}
            />
            <span className="text-ink min-w-0 flex-1 truncate" title={row.label}>
              {row.label}
            </span>
            <span className="text-ink shrink-0 tabular-nums">{chartPercent(row.value, whole)}</span>
            <span className="text-ink-2 w-10 shrink-0 text-right tabular-nums">
              {format(row.value)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

type DonutSegment = Readonly<{
  key: string;
  share: number;
  color: string;
}>;

function DonutRing({
  segments,
  size,
}: Readonly<{ segments: readonly DonutSegment[]; size: number }>) {
  const drawn = segments.filter((segment) => segment.share > 0);
  const data = drawn.length ? drawn : [{ key: 'empty', share: 1, color: WELL }];
  return (
    <div aria-hidden className="block w-full">
      <PieChart
        width={size}
        height={size}
        style={{ width: '100%', height: 'auto', aspectRatio: 1 }}
      >
        <Pie
          data={data.map((segment) => ({ ...segment }))}
          dataKey="share"
          nameKey="key"
          startAngle={90}
          endAngle={-270}
          innerRadius="68%"
          outerRadius="100%"
          paddingAngle={data.length > 1 ? 2 : 0}
          cornerRadius={4}
          stroke="none"
          isAnimationActive={false}
        >
          {data.map((segment) => (
            <Cell key={segment.key} fill={segment.color} />
          ))}
        </Pie>
      </PieChart>
    </div>
  );
}
