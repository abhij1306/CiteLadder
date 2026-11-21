import type { ReactNode } from 'react';

import type { EventKind } from '@/components/ui/step-chart-parts';
import { ChartTable } from '@/components/ui/chart-frame';
import { textRole } from '@/components/ui/typography';
import { Value } from '@/components/ui/value';
import { absent, type Formatted, formattedText } from '@/lib/format';

export type TrendPoint = {
  label: string;
  axisLabel?: string;
  value: number | null;
  versionChange?: { note: string } | null;
  timestamp?: number;
  breakBefore?: boolean;
};

export type TrendSeries = {
  label: string;
  values: readonly (number | null)[];
  other?: boolean;
  identity?: string;
  mark?: ReactNode;
};

export type TrendEvent = { key: string; timestamp: number; label: string; kind?: EventKind };

export function plottedLines({
  data,
  name,
  mark,
  series,
}: Readonly<{
  data: readonly TrendPoint[];
  name: string;
  mark: ReactNode;
  series: readonly TrendSeries[];
}>) {
  return [
    { name, mark, identity: name, values: data.map((point) => point.value), other: false },
    ...series.slice(0, 3).map((entry) => ({
      name: entry.label,
      mark: entry.mark,
      identity: entry.identity ?? entry.label,
      values: entry.values,
      other: entry.other ?? false,
    })),
  ];
}

export function shownWith(format: (value: number) => string) {
  return (value: number | null | undefined): Formatted =>
    value === null || value === undefined ? absent() : format(value);
}

export type Shown = (value: number | null | undefined) => Formatted;

export function SeriesTable({
  label,
  data,
  lines,
  shown,
  eventLabels,
}: Readonly<{
  label: string;
  data: readonly TrendPoint[];
  lines: readonly Readonly<{ name: string; values: readonly (number | null)[] }>[];
  shown: Shown;
  eventLabels: readonly string[];
}>) {
  return (
    <ChartTable
      label={label}
      columns={data.map((entry) => entry.label)}
      rows={lines.map((line) => ({
        name: line.name,
        values: data.map((_, index) => formattedText(shown(line.values[index]))),
      }))}
      notes={[
        ...data.flatMap((entry) =>
          entry.versionChange
            ? [`Method changed at ${entry.label}: ${entry.versionChange.note}`]
            : [],
        ),
        ...eventLabels,
      ]}
    />
  );
}

export function summarise(
  label: string,
  data: readonly TrendPoint[],
  lines: readonly Readonly<{ name: string; values: readonly (number | null)[] }>[],
  shown: Shown,
) {
  const text = (value: number | null | undefined) => formattedText(shown(value));
  const parts = lines.flatMap((line) => {
    const first = line.values.findIndex((value) => value !== null);
    const last = lastMeasured(line.values);
    if (first < 0) return [`${line.name}: not measured`];
    return [
      `${line.name}: ${text(line.values[first])} on ${data[first]?.label ?? ''} to ${text(line.values[last])} on ${data[last]?.label ?? ''}`,
    ];
  });
  return `${label}. ${parts.join('; ')}.`;
}

export function SingleMeasurements({
  label,
  point,
  lines,
  format,
}: Readonly<{
  label: string;
  point: TrendPoint;
  lines: readonly Readonly<{ name: string; values: readonly (number | null)[] }>[];
  format: (value: number) => string;
}>) {
  return (
    <div data-single-measurement="" className="flex min-w-0 flex-col gap-2">
      <ul aria-label={label} className="flex min-w-0 flex-col">
        {lines.map((line) => {
          const value = line.values[0];
          return (
            <li key={line.name} className="flex min-w-0 items-center justify-between gap-4 py-1">
              <span className={textRole('body', 'text-ink-2 min-w-0 truncate')} title={line.name}>
                {line.name}
              </span>
              <Value
                className="shrink-0"
                value={value === null || value === undefined ? null : format(value)}
              />
            </li>
          );
        })}
      </ul>
      <p className={textRole('caption')}>{`Measured ${point.label}`}</p>
    </div>
  );
}

export function lastMeasured(values: readonly (number | null)[]) {
  for (let index = values.length - 1; index >= 0; index -= 1)
    if (values[index] !== null) return index;
  return -1;
}
