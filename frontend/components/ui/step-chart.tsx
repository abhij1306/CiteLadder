import { useId, useState, type ComponentProps, type KeyboardEvent, type ReactNode } from 'react';

import { CHART_HEIGHT_PX, chartPath, useChartWidth, type ChartHeight } from '@/components/ui/chart';
import { ChartFrame, ChartKey, ChartTipSheet } from '@/components/ui/chart-frame';
import {
  lastMeasured,
  plottedLines,
  SeriesTable,
  type Shown,
  shownWith,
  SingleMeasurements,
  summarise,
  type TrendEvent,
  type TrendPoint,
  type TrendSeries,
} from '@/components/ui/series-data';
import { formattedText, isAbsent } from '@/lib/format';

export type { TrendEvent, TrendPoint, TrendSeries } from '@/components/ui/series-data';
import {
  AXIS_TEXT,
  EndLabels,
  EventLegend,
  EventTicks,
  GapBands,
  LABEL_CHAR_WIDTH,
  MARKER_SHAPES,
  Markers,
  SERIES_STROKE,
  YouFill,
  areaPath,
  gapBands,
  placeEndLabels,
  useSeriesTones,
  type MarkerShape,
  type SeriesTone,
} from '@/components/ui/step-chart-parts';
import {
  labelledIndexes,
  linePoints,
  onGrid,
  trendScale,
  type TrendScale,
} from '@/components/ui/trend-geometry';

type Line = {
  name: string;
  mark?: ReactNode;
  values: readonly (number | null)[];
  tone: SeriesTone;
  shape: MarkerShape;
};

const MARKER_LIMIT = 40;
const MAX_GRIDLINES = 4;
const defaultFormat = (value: number) => `${Math.round(value * 100) / 100}`;

function StepChartKeys({
  keyed,
  labelled,
  eventsLabel,
  entries,
}: Readonly<{
  keyed: boolean;
  labelled: boolean;
  eventsLabel?: string;
  entries: ComponentProps<typeof ChartKey>['entries'];
}>) {
  if (keyed) return <ChartKey eventsLabel={eventsLabel} entries={entries} />;
  if (labelled && eventsLabel) return <ChartKey entries={[]} eventsLabel={eventsLabel} />;
  return null;
}

export function StepChart({
  data,
  name,
  mark,
  series = [],
  events = [],
  label,
  height: heightRole = 'md',
  yMin,
  yMax,
  yFormat = defaultFormat,
  format = yFormat,
  legend = true,
  eventsLabel,
  eventLegend = false,
  you = true,
  lonePoint = 'list',
}: Readonly<{
  data: readonly TrendPoint[];
  name?: string;
  mark?: ReactNode;
  series?: readonly TrendSeries[];
  events?: readonly TrendEvent[];
  label: string;
  height?: ChartHeight;
  yMin?: number;
  yMax?: number;
  yFormat?: (value: number) => string;
  format?: (value: number) => string;
  legend?: boolean;
  eventsLabel?: string;
  eventLegend?: boolean;
  you?: boolean;
  lonePoint?: 'list' | 'plot';
}>) {
  const [plotRef, width] = useChartWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const fillId = `you-fill-${useId().replaceAll(':', '')}`;
  const height = CHART_HEIGHT_PX[heightRole];
  const plotted = plottedLines({ data, name: name ?? label, mark, series });
  const tones = useSeriesTones(plotted, you);
  const toned = plotted.map((line, index) => ({
    name: line.name,
    mark: line.mark,
    values: line.values,
    tone: tones[index] ?? 'other',
  }));
  const shown = shownWith(format);
  const [only] = data;
  const lone = lonePointMode(lonePoint, data.length);
  if (only && lone.list) {
    return (
      <ChartFrame>
        <SingleMeasurements label={label} point={only} lines={toned} format={format} />
        <SeriesTable
          label={label}
          data={data}
          lines={toned}
          shown={shown}
          eventLabels={events.map((event) => event.label)}
        />
      </ChartFrame>
    );
  }
  const latestOf = (line: Pick<Line, 'values'>) => line.values[lastMeasured(line.values)] ?? null;
  const latestText = (line: Pick<Line, 'values'>) => {
    const at = lastMeasured(line.values);
    const asOf = at >= 0 && at < data.length - 1 ? data[at] : undefined;
    const value = shown(line.values[at]);
    return asOf && !isAbsent(value) ? `${value} · as of ${asOf.axisLabel ?? asOf.label}` : value;
  };
  const labelText = (line: Pick<Line, 'name' | 'values'>) => {
    const latest = formattedText(latestText(line));
    return toned.length === 1 ? latest : `${line.name} ${latest}`;
  };
  const gutter = onGrid(
    Math.min(
      width * 0.35,
      Math.max(...toned.map((line) => labelText(line).length)) * LABEL_CHAR_WIDTH + 16,
    ),
  );
  const scaleFor = (padRight: number) =>
    trendScale({
      width,
      height,
      lines: toned.map((line) => line.values),
      timestamps: data.map((point) => point.timestamp),
      yMin,
      yMax,
      padRight,
      tickCount: 3,
      maxTicks: MAX_GRIDLINES,
      tickWidth: (ticks) => Math.max(...ticks.map((tick) => yFormat(tick).length)),
    });
  const labelled = scaleFor(gutter);
  const ends = toned.flatMap((line) => {
    const latest = latestOf(line);
    return latest === null
      ? []
      : [{ key: line.name, text: labelText(line), tone: line.tone, y: labelled.y(latest) }];
  });
  const endLabels = lone.endLabels(ends, toned.length, labelled.right);
  const scale = endLabels ? labelled : scaleFor(24);
  const keyed = !endLabels && toned.length >= lone.keyedFrom;
  const lines = shapedLines(toned, keyed);
  const count = data.length;
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = keyedPoint(event, active, count);
    if (next !== undefined) setActive(next);
  };
  const placed = placedEvents(data, events, scale);

  return (
    <ChartFrame height={heightRole} summary={summarise(label, data, lines, shown)}>
      <div className="flex min-w-0 flex-col gap-4">
        <StepChartKeys
          keyed={legend && keyed}
          labelled={Boolean(endLabels) || lines.length === 1}
          eventsLabel={placed.length ? eventsLabel : undefined}
          entries={lines.map((line) => ({
            name: line.name,
            mark: line.mark,
            tone: line.tone,
            shape: line.shape,
            value: latestText(line),
          }))}
        />
        {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
        <div // NOSONAR
          ref={plotRef}
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
          role="group"
          // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
          tabIndex={count ? 0 : undefined} // NOSONAR
          aria-label={`${label}. Use the left and right arrow keys to read each point.`}
          onKeyDown={onKeyDown}
          onMouseMove={(event) =>
            count &&
            setActive(
              scale.nearest(event.clientX - event.currentTarget.getBoundingClientRect().left),
            )
          }
          onMouseLeave={() => setActive(null)}
          onBlur={() => setActive(null)}
          className="focus-ring rounded-control relative w-full"
          style={{ height }}
        >
          <StepPlot
            data={data}
            lines={lines}
            scale={scale}
            width={width}
            height={height}
            active={active}
            yFormat={yFormat}
            fillId={fillId}
            endLabels={endLabels}
            events={placed}
            eventLegend={eventLegend}
          />
          <StepChartTip
            data={data}
            lines={lines}
            active={active}
            scale={scale}
            width={width}
            keyed={keyed}
            shown={shown}
          />
        </div>
        <EventLegend events={placed} shown={eventLegend} />
      </div>
      <SeriesTable
        label={label}
        data={data}
        lines={lines}
        shown={shown}
        eventLabels={placed.map((event) => event.label)}
      />
    </ChartFrame>
  );
}

function lonePointMode(lonePoint: 'list' | 'plot', count: number) {
  const plot = count === 1 && lonePoint === 'plot';
  return {
    list: count === 1 && !plot,
    keyedFrom: plot ? 1 : 2,
    endLabels: (ends: Parameters<typeof placeEndLabels>[0], lines: number, right: number) =>
      !plot && ends.length === lines ? placeEndLabels(ends, right) : null,
  };
}

function shapedLines(lines: readonly Omit<Line, 'shape'>[], keyed: boolean): Line[] {
  return lines.map((line, index) => ({
    ...line,
    shape: keyed ? (MARKER_SHAPES[index % MARKER_SHAPES.length] ?? 'circle') : 'circle',
  }));
}

function keyedPoint(
  event: KeyboardEvent<HTMLDivElement>,
  active: number | null,
  count: number,
): number | null | undefined {
  const from = active ?? count - 1;
  if (event.key === 'Escape') return null;
  if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return undefined;
  event.preventDefault();
  return event.key === 'ArrowRight' ? Math.min(count - 1, from + 1) : Math.max(0, from - 1);
}

function StepChartTip({
  data,
  lines,
  active,
  scale,
  width,
  keyed,
  shown,
}: Readonly<{
  data: readonly TrendPoint[];
  lines: readonly Line[];
  active: number | null;
  scale: TrendScale;
  width: number;
  keyed: boolean;
  shown: Shown;
}>) {
  const point = active === null ? undefined : data[active];
  if (active === null || !point) return null;
  return (
    <ChartTipSheet
      title={point.label}
      top={scale.padTop}
      x={scale.x(active)}
      frameWidth={width}
      note={point.versionChange?.note}
      rows={lines.map((line) => ({
        name: line.name,
        mark: line.mark,
        tone: line.tone,
        shape: keyed ? line.shape : undefined,
        value: shown(line.values[active]),
      }))}
    />
  );
}

function StepPlot({
  data,
  lines,
  scale,
  width,
  height,
  active,
  yFormat,
  fillId,
  endLabels,
  events,
  eventLegend,
}: Readonly<{
  data: readonly TrendPoint[];
  lines: readonly Line[];
  scale: TrendScale;
  width: number;
  height: number;
  active: number | null;
  yFormat: (value: number) => string;
  fillId: string;
  endLabels: ReturnType<typeof placeEndLabels>;
  events: ReturnType<typeof placedEvents>;
  eventLegend: boolean;
}>) {
  const breaks = data.map((point) => point.breakBefore === true);
  const bottom = scale.padTop + scale.plotHeight;
  const markers = data.length <= MARKER_LIMIT;
  const sparse = new Set(labelledIndexes(scale, data.length));
  const keyed = lines.some((line) => line.shape !== 'circle');
  return (
    <svg
      aria-hidden
      focusable="false"
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="block overflow-visible"
    >
      <GapBands
        bands={gapBands(lines[0]?.values ?? [], scale)}
        top={scale.padTop}
        bottom={bottom}
        word="No reading"
      />
      {scale.ticks.map((tick) => {
        const y = Math.round(scale.y(tick)) + 0.5;
        return (
          <g key={`tick-${tick}`}>
            <line
              x1={scale.padLeft}
              x2={scale.right}
              y1={y}
              y2={y}
              shapeRendering="crispEdges"
              className="stroke-rule"
            />
            <text
              x={scale.padLeft - 8}
              y={y}
              textAnchor="end"
              dominantBaseline="middle"
              className={AXIS_TEXT}
            >
              {yFormat(tick)}
            </text>
          </g>
        );
      })}
      {labelledIndexes(scale, data.length).map((index) => (
        <text
          key={`date-${index}`}
          x={scale.x(index)}
          y={height - 8}
          textAnchor="middle"
          className={AXIS_TEXT}
        >
          {data[index]?.axisLabel ?? data[index]?.label}
        </text>
      ))}
      {data.map((point, index) =>
        point.versionChange ? (
          <line
            key={`version-${point.label}-${index}`}
            data-version-marker=""
            x1={scale.x(index)}
            x2={scale.x(index)}
            y1={scale.padTop}
            y2={bottom}
            strokeDasharray="4 3"
            className="stroke-warning"
          />
        ) : null,
      )}
      <EventTicks events={events} top={scale.padTop} bottom={bottom} legend={eventLegend} />
      {active === null ? null : (
        <line
          x1={Math.round(scale.x(active)) + 0.5}
          x2={Math.round(scale.x(active)) + 0.5}
          y1={scale.padTop}
          y2={bottom}
          shapeRendering="crispEdges"
          className="stroke-control-line"
        />
      )}
      {[...lines].reverse().map((line) => {
        const points = linePoints(line.values, breaks, scale);
        const marked = markedPoints(points, { markers, keyed, sparse });
        return (
          <g key={line.name} data-trend-line={line.tone}>
            {line.tone === 'you' ? <YouFill id={fillId} d={areaPath(points, bottom)} /> : null}
            <path
              d={chartPath(points)}
              fill="none"
              strokeWidth={line.tone === 'you' ? 2 : 1.5}
              strokeLinejoin="round"
              strokeLinecap="round"
              className={SERIES_STROKE[line.tone]}
            />
            {marked ? <Markers points={marked} tone={line.tone} shape={line.shape} /> : null}
          </g>
        );
      })}
      {endLabels ? <EndLabels labels={endLabels} /> : null}
    </svg>
  );
}

function placedEvents(
  data: readonly TrendPoint[],
  events: readonly TrendEvent[],
  scale: TrendScale,
) {
  const stamps = data.flatMap((point) => (point.timestamp === undefined ? [] : [point.timestamp]));
  if (stamps.length < 2 || stamps.length !== data.length) return [];
  const first = Math.min(...stamps);
  const span = Math.max(...stamps) - first;
  if (span <= 0) return [];
  return events.flatMap((event) => {
    const offset = event.timestamp - first;
    if (!Number.isFinite(offset) || offset < 0 || offset > span) return [];
    return [{ key: event.key, label: event.label, kind: event.kind, x: scale.xAt(offset / span) }];
  });
}

function markedPoints(
  points: ReturnType<typeof linePoints>,
  {
    markers,
    keyed,
    sparse,
  }: Readonly<{ markers: boolean; keyed: boolean; sparse: ReadonlySet<number> }>,
) {
  if (markers || points.filter(Boolean).length === 1) return points;
  return keyed ? points.map((at, index) => (sparse.has(index) ? at : null)) : null;
}
