import { createContext, useContext } from 'react';

import type { TrendScale } from '@/components/ui/trend-geometry';
import { cn } from '@/lib/utils';

export type SeriesTone = 'you' | 'rival-1' | 'rival-2' | 'rival-3' | 'rival-4' | 'other';

export const SERIES_STROKE: Record<SeriesTone, string> = {
  you: 'stroke-data-you',
  'rival-1': 'stroke-data-rival-1',
  'rival-2': 'stroke-data-rival-2',
  'rival-3': 'stroke-data-rival-3',
  'rival-4': 'stroke-data-rival-4',
  other: 'stroke-data-other',
};

export const SERIES_FILL: Record<SeriesTone, string> = {
  you: 'fill-data-you bg-data-you',
  'rival-1': 'fill-data-rival-1 bg-data-rival-1',
  'rival-2': 'fill-data-rival-2 bg-data-rival-2',
  'rival-3': 'fill-data-rival-3 bg-data-rival-3',
  'rival-4': 'fill-data-rival-4 bg-data-rival-4',
  other: 'fill-data-other bg-data-other',
};

const SERIES_TEXT: Record<SeriesTone, string> = {
  you: 'fill-accent-text',
  'rival-1': 'fill-ink',
  'rival-2': 'fill-data-rival-2',
  'rival-3': 'fill-data-rival-3',
  'rival-4': 'fill-data-rival-4',
  other: 'fill-ink-2',
};

const RIVALS = ['rival-1', 'rival-2', 'rival-3', 'rival-4'] as const;

export const SeriesTonesContext = createContext<ReadonlyMap<string, SeriesTone> | null>(null);

export function seriesTones(identities: readonly string[]): ReadonlyMap<string, SeriesTone> {
  return new Map(identities.map((identity, index) => [identity, RIVALS[index] ?? 'other']));
}

export function seriesTone(
  line: Readonly<{ other?: boolean }>,
  index: number,
  firstIsYou: boolean,
): SeriesTone {
  if (line.other) return 'other';
  if (firstIsYou) return index === 0 ? 'you' : (RIVALS[index - 1] ?? 'rival-4');
  return RIVALS[index] ?? 'rival-4';
}

export function useSeriesTones(
  lines: readonly Readonly<{ identity: string; other?: boolean }>[],
  firstIsYou: boolean,
): SeriesTone[] {
  const known = useContext(SeriesTonesContext);
  return lines.map((line, index) => {
    if (line.other || (firstIsYou && index === 0)) return seriesTone(line, index, firstIsYou);
    return known?.get(line.identity) ?? seriesTone(line, index, firstIsYou);
  });
}

export const AXIS_TEXT = 'fill-ink-2 type-caption tabular-nums';

const END_LABEL_GAP = 16;
export const LABEL_CHAR_WIDTH = 7.3;

export type EndLabel = Readonly<{
  key: string;
  text: string;
  tone: SeriesTone;
  x: number;
  y: number;
}>;

export function placeEndLabels(
  ends: readonly Omit<EndLabel, 'x'>[],
  right: number,
): EndLabel[] | null {
  const sorted = [...ends].sort((a, b) => a.y - b.y);
  for (let index = 1; index < sorted.length; index += 1) {
    const above = sorted[index - 1];
    const below = sorted[index];
    if (above && below && below.y - above.y < END_LABEL_GAP) return null;
  }
  return sorted.map((end) => ({ ...end, x: right + 8 }));
}

export function EndLabels({ labels }: Readonly<{ labels: readonly EndLabel[] }>) {
  return (
    <g data-end-labels="">
      {labels.map((label) => (
        <text
          key={label.key}
          x={label.x}
          y={label.y}
          dominantBaseline="middle"
          className={cn('type-caption tabular-nums', SERIES_TEXT[label.tone])}
        >
          {label.text}
        </text>
      ))}
    </g>
  );
}

export type GapBand = Readonly<{ from: number; to: number }>;

export function gapBands(values: readonly (number | null)[], scale: TrendScale): GapBand[] {
  const bands: GapBand[] = [];
  let start: number | null = null;
  const edge = (index: number, side: -1 | 1) => {
    const here = scale.x(index);
    const next = values[index + side] === undefined ? null : scale.x(index + side);
    return next === null ? here + side * 12 : (here + next) / 2;
  };
  values.forEach((value, index) => {
    if (value === null && start === null) start = index;
    if (value !== null && start !== null) {
      bands.push({ from: edge(start, -1), to: edge(index - 1, 1) });
      start = null;
    }
  });
  if (start !== null) bands.push({ from: edge(start, -1), to: edge(values.length - 1, 1) });
  return bands;
}

export function GapBands({
  bands,
  top,
  bottom,
  word,
}: Readonly<{
  bands: readonly GapBand[];
  top: number;
  bottom: number;
  word: string;
}>) {
  return (
    <g data-gap-bands="">
      {bands.map((band) => {
        const width = Math.max(4, band.to - band.from);
        return (
          <g key={band.from}>
            <rect
              x={band.from}
              y={top}
              width={width}
              height={bottom - top}
              rx={2}
              className="fill-well"
            />
            {width >= word.length * LABEL_CHAR_WIDTH + 16 ? (
              <text
                x={band.from + width / 2}
                y={top + 14}
                textAnchor="middle"
                className={AXIS_TEXT}
              >
                {word}
              </text>
            ) : null}
          </g>
        );
      })}
    </g>
  );
}

export type EventKind = 'panel' | 'model' | 'action';

const EVENT_FILL: Record<EventKind, string> = {
  panel: 'fill-ink-2',
  model: 'fill-warning',
  action: 'fill-positive',
};

type PlacedEvent = Readonly<{ key: string; label: string; x: number; kind?: EventKind }>;

function groupedEvents(events: readonly PlacedEvent[]) {
  const groups = new Map<number, PlacedEvent[]>();
  for (const event of events) groups.set(event.x, [...(groups.get(event.x) ?? []), event]);
  return [...groups].map(([x, members]) => {
    const kinds = new Set(members.map((event) => event.kind ?? 'action'));
    const [only] = kinds;
    return {
      x,
      key: members.map((event) => event.key).join('|'),
      label: members.map((event) => event.label).join('; '),
      count: members.length,
      fill: kinds.size === 1 && only ? EVENT_FILL[only] : 'fill-ink',
    };
  });
}

const diamond = (x: number, y: number, r: number) =>
  `M${x} ${y - r}l${r} ${r}-${r} ${r}-${r}-${r}z`;

export function EventTicks({
  events,
  top,
  bottom,
  legend,
}: Readonly<{
  events: readonly PlacedEvent[];
  top: number;
  bottom: number;
  legend: boolean;
}>) {
  const labelled = !legend && events.length <= 3;
  return (
    <g data-event-ticks="">
      {groupedEvents(events).map((event) => (
        <g key={event.key} data-event-marker="">
          <line
            x1={event.x}
            x2={event.x}
            y1={top}
            y2={bottom}
            strokeDasharray="2 3"
            className="stroke-control-line"
          />
          <path d={diamond(event.x, top - 6, 5)} className={event.fill} />
          {event.count > 1 ? (
            <text
              x={event.x + 8}
              y={top - 6}
              dominantBaseline="middle"
              className="fill-ink type-caption tabular-nums"
            >
              {event.count}
            </text>
          ) : null}
          {labelled ? (
            <text
              x={event.x + 8}
              y={bottom - 12}
              dominantBaseline="middle"
              className="fill-ink type-caption"
            >
              {event.label.length > 28 ? `${event.label.slice(0, 27)}…` : event.label}
            </text>
          ) : null}
        </g>
      ))}
    </g>
  );
}

export function EventLegend({
  events,
  shown,
}: Readonly<{ events: readonly PlacedEvent[]; shown: boolean }>) {
  if (!shown || !events.length) return null;
  return (
    <ul aria-hidden className="flex min-w-0 flex-wrap gap-x-6 gap-y-2">
      {events.map((event) => (
        <li key={event.key} className="type-caption inline-flex min-w-0 items-center gap-2">
          <svg aria-hidden viewBox="0 0 10 10" className="size-2.5 shrink-0">
            <path d={diamond(5, 5, 5)} className={EVENT_FILL[event.kind ?? 'action']} />
          </svg>
          <span className="min-w-0">{event.label}</span>
        </li>
      ))}
    </ul>
  );
}

export function areaPath(
  points: readonly (readonly [number, number] | null)[],
  floor: number,
): string {
  const runs: (readonly [number, number])[][] = [[]];
  for (const point of points) {
    if (point) runs.at(-1)?.push(point);
    else if (runs.at(-1)?.length) runs.push([]);
  }
  return runs
    .filter((run) => run.length > 1)
    .map((run) => {
      const line = run.map(([x, y]) => `L${x.toFixed(1)} ${y.toFixed(1)}`).join('');
      const first = run[0]?.[0] ?? 0;
      const last = run.at(-1)?.[0] ?? 0;
      return `M${first.toFixed(1)} ${floor.toFixed(1)}${line}L${last.toFixed(1)} ${floor.toFixed(1)}Z`;
    })
    .join('');
}

export function YouFill({ id, d }: Readonly<{ id: string; d: string }>) {
  return (
    <>
      <defs>
        <linearGradient id={id} x1={0} x2={0} y1={0} y2={1} className="text-data-you">
          <stop offset="0%" stopColor="currentColor" stopOpacity={0.16} />
          <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
        </linearGradient>
      </defs>
      <path data-you-fill="" d={d} fill={`url(#${id})`} />
    </>
  );
}

export const MARKER_SHAPES = ['circle', 'square', 'diamond', 'triangle'] as const;
export type MarkerShape = (typeof MARKER_SHAPES)[number];

export function MarkerMark({
  x,
  y,
  shape,
  className,
}: Readonly<{ x: number; y: number; shape: MarkerShape; className: string }>) {
  switch (shape) {
    case 'square':
      return (
        <rect
          x={x - 2.5}
          y={y - 2.5}
          width={5}
          height={5}
          strokeWidth={1.5}
          className={className}
        />
      );
    case 'diamond':
      return (
        <path
          d={`M${x} ${y - 3.5}L${x + 3.5} ${y}L${x} ${y + 3.5}L${x - 3.5} ${y}Z`}
          strokeWidth={1.5}
          className={className}
        />
      );
    case 'triangle':
      return (
        <path
          d={`M${x} ${y - 3.5}L${x + 3.5} ${y + 3}L${x - 3.5} ${y + 3}Z`}
          strokeWidth={1.5}
          className={className}
        />
      );
    case 'circle':
      return <circle cx={x} cy={y} r={3} strokeWidth={1.5} className={className} />;
    default: {
      const unknown: never = shape;
      return unknown;
    }
  }
}

export function Markers({
  points,
  tone,
  shape = 'circle',
}: Readonly<{
  points: readonly (readonly [number, number] | null)[];
  tone: SeriesTone;
  shape?: MarkerShape;
}>) {
  const className = cn(SERIES_STROKE[tone], tone === 'you' ? SERIES_FILL[tone] : 'fill-surface');
  return points.map((point, index) =>
    point ? (
      <g key={`${index}-${point[0]}`} data-marker-shape={shape}>
        <MarkerMark x={point[0]} y={point[1]} shape={shape} className={className} />
      </g>
    ) : null,
  );
}
