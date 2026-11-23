import type { ReactNode } from 'react';

import type { ChartHeight } from '@/components/ui/chart';
import {
  MarkerMark,
  SERIES_FILL,
  SERIES_STROKE,
  type MarkerShape,
  type SeriesTone,
} from '@/components/ui/step-chart-parts';
import { SHEET_FACE } from '@/components/ui/slip';
import { InfoHint } from '@/components/ui/info-hint';
import { textRole } from '@/components/ui/typography';
import { ABSENCE_MARK, type Formatted, isAbsent } from '@/lib/format';
import { cn } from '@/lib/utils';

const FRAME_HEIGHT = {
  sm: 'min-h-[var(--chart-height-sm)]',
  md: 'min-h-[var(--chart-height-md)]',
  lg: 'min-h-[var(--chart-height-lg)]',
} as const satisfies Record<ChartHeight, string>;

export function ChartFrame({
  height,
  summary,
  children,
}: Readonly<{
  height?: ChartHeight;
  summary?: string;
  children: ReactNode;
}>) {
  return (
    <div
      data-chart-frame={height ?? 'auto'}
      className={cn('grid min-w-0 *:min-w-0', height && FRAME_HEIGHT[height])}
    >
      {summary ? <p className="sr-only">{summary}</p> : null}
      {children}
    </div>
  );
}

function SeriesSwatch({ tone, shape }: Readonly<{ tone: SeriesTone; shape?: MarkerShape }>) {
  if (shape)
    return (
      <svg
        aria-hidden
        width={16}
        height={10}
        viewBox="0 0 16 10"
        className="shrink-0 overflow-visible"
      >
        <line x1={0} x2={16} y1={5} y2={5} strokeWidth={2} className={SERIES_STROKE[tone]} />
        <MarkerMark
          x={8}
          y={5}
          shape={shape}
          className={cn(SERIES_STROKE[tone], tone === 'you' ? SERIES_FILL[tone] : 'fill-surface')}
        />
      </svg>
    );
  return (
    <span
      aria-hidden
      className={cn('rounded-mark inline-block h-0.5 w-3 shrink-0', SERIES_FILL[tone])}
    />
  );
}

export type KeyEntry = Readonly<{
  name: string;
  mark?: ReactNode;
  tone: SeriesTone;
  shape?: MarkerShape;
  value?: Formatted;
}>;

function KeyValue({ value }: Readonly<{ value: Formatted }>) {
  if (isAbsent(value))
    return <span className="type-caption text-ink-2 shrink-0">{ABSENCE_MARK}</span>;
  return <span className="type-caption text-ink shrink-0 tabular-nums">{value}</span>;
}

export function ChartKey({
  entries,
  eventsLabel,
}: Readonly<{ entries: readonly KeyEntry[]; eventsLabel?: string }>) {
  const item = textRole(
    'caption',
    'inline-flex max-w-[min(100%,20rem)] min-w-0 items-center gap-2',
  );
  return (
    <ul aria-hidden className="flex min-w-0 flex-wrap gap-x-6 gap-y-2">
      {entries.map((entry) => (
        <li key={entry.name} className={item}>
          <SeriesSwatch tone={entry.tone} shape={entry.shape} />
          {entry.mark}
          <span className="min-w-0 truncate" title={entry.name}>
            {entry.name}
          </span>
          {entry.value === undefined ? null : <KeyValue value={entry.value} />}
        </li>
      ))}
      {eventsLabel ? (
        <li className={item}>
          <svg aria-hidden viewBox="0 0 10 10" className="size-2.5 shrink-0">
            <path d="M5 0l5 5-5 5-5-5z" className="fill-positive" />
          </svg>
          {eventsLabel}
        </li>
      ) : null}
    </ul>
  );
}

const TIP_WIDTH = 216;
const TIP_GAP = 16;
const TIP_INSET = 8;

export function chartTipLeft(x: number, frameWidth: number) {
  const right = x + TIP_GAP;
  const left = right + TIP_WIDTH > frameWidth - TIP_INSET ? x - TIP_GAP - TIP_WIDTH : right;
  const max = Math.max(TIP_INSET, frameWidth - TIP_INSET - TIP_WIDTH);
  return Math.round(Math.min(max, Math.max(TIP_INSET, left)));
}

export function ChartTipSheet({
  title,
  x,
  frameWidth,
  top,
  rows,
  note,
}: Readonly<{
  title: string;
  x: number;
  frameWidth: number;
  top: number;
  rows: readonly KeyEntry[];
  note?: string;
}>) {
  return (
    <div
      aria-hidden
      className={cn(
        SHEET_FACE,
        'rounded-card pointer-events-none absolute z-20 flex w-54 flex-col gap-1 p-3',
      )}
      style={{ left: chartTipLeft(x, frameWidth), top: Math.round(top) }}
    >
      <p className="type-caption tabular-nums">{title}</p>
      {rows.map((row) => (
        <div key={row.name} className={textRole('caption', 'flex items-center gap-2 text-ink')}>
          <SeriesSwatch tone={row.tone} />
          {row.mark}
          <span className="min-w-0 flex-1 truncate">{row.name}</span>
          {row.value === undefined ? null : <KeyValue value={row.value} />}
        </div>
      ))}
      {note ? <p className={textRole('caption')}>{note}</p> : null}
    </div>
  );
}

export function ChartTable({
  label,
  columns,
  rows,
  notes,
}: Readonly<{
  label: string;
  columns: readonly string[];
  rows: readonly Readonly<{ name: string; values: readonly string[] }>[];
  notes: readonly string[];
}>) {
  return (
    <div className="sr-only">
      <table>
        <caption>{label}</caption>
        <thead>
          <tr>
            <th scope="col">Series</th>
            {columns.map((column, index) => (
              <th key={`${column}-${index}`} scope="col" className="text-right">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.name}>
              <th scope="row">{row.name}</th>
              {row.values.map((value, index) => (
                <td key={`${columns[index]}-${index}`} className="text-right tabular-nums">
                  {value}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {notes.length ? (
        <ul aria-label={`${label}: marked`}>
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

const measuredAt = (values: readonly (number | null | undefined)[], index: number) =>
  values[index] !== null && values[index] !== undefined;

export function breakNote(
  data: readonly Readonly<{ breakBefore?: boolean }>[],
  lines: readonly Readonly<{ values: readonly (number | null | undefined)[] }>[],
  bridged = false,
): string | null {
  const gap = lines.some((line) => {
    const measured = line.values.map((value) => value !== null && value !== undefined);
    return measured.slice(measured.indexOf(true), measured.lastIndexOf(true)).includes(false);
  });
  const breaks = data.flatMap((point, index) => (index > 0 && point.breakBefore ? [index] : []));
  const bridge = breaks.some((index) =>
    lines.some((line) => measuredAt(line.values, index - 1) && measuredAt(line.values, index)),
  );
  const parts = [
    gap ? 'A gap is a period with no reading.' : null,
    bridged && bridge ? 'A dashed line joins runs measured under different conditions.' : null,
    !bridged && breaks.length
      ? 'A line starts again where the measurement conditions changed.'
      : null,
  ].filter((part) => part !== null);
  return parts.length ? parts.join(' ') : null;
}

export function ChartBreakNote({
  data,
  lines,
  placement = 'caption',
  bridged = false,
}: Readonly<{
  data: Parameters<typeof breakNote>[0];
  lines: Parameters<typeof breakNote>[1];
  placement?: 'caption' | 'hint';
  bridged?: boolean;
}>) {
  const note = breakNote(data, lines, bridged);
  if (!note) return null;
  if (placement === 'hint')
    return (
      <span className="self-start">
        <InfoHint label="About breaks in the line">{note}</InfoHint>
      </span>
    );
  return <p className={textRole('caption')}>{note}</p>;
}
