/** The scale layer of `TrendChart`, split out so the chart file stays legible. */

/**
 * Axis tick text, in viewBox units.
 *
 * The chart scales to its container, so this is multiplied by
 * `containerWidth / width`. Keep that ratio near 1.5-2 (see the `width` the
 * visibility chart passes) or the ticks render below a readable size -- at a
 * 480-unit viewBox in a 620px column, 7 units came out as 9px.
 */
const TICK_FONT_SIZE = 9;

/**
 * The scale a reader needs to place a point, drawn only when asked for.
 *
 * A sparkline is a shape: it says "up" or "down" and nothing about how far. The
 * moment the same chart carries several brands it stops being a shape and
 * becomes a comparison, and a comparison without a scale cannot be read — a
 * point sitting halfway up an unlabelled box could be 50% or 5%. Passing an
 * axis label opts a chart into ticks, gridlines and titles; the charts that are
 * still shapes are left alone.
 */
export function ChartAxes({
  x,
  y,
  innerWidth,
  innerHeight,
  ticks,
  xTicks,
  xAxisLabel,
  yAxisLabel,
  height,
}: Readonly<{
  x: number;
  y: number;
  innerWidth: number;
  innerHeight: number;
  ticks: readonly { at: number; text: string }[];
  xTicks: readonly { at: number; text: string; anchor: 'start' | 'middle' | 'end' }[];
  xAxisLabel?: string;
  yAxisLabel?: string;
  height: number;
}>) {
  return (
    <g aria-hidden>
      {/* Tick VALUES without tick lines. A gridline behind every tick puts a
          horizontal rule through the series at exactly the heights a reader is
          trying to compare against; the number in the gutter already places the
          point, and the two axis lines already bound the plot. */}
      {ticks.map((tick) => (
        <text
          key={`y-${tick.at}`}
          x={x - 5}
          y={tick.at}
          textAnchor="end"
          dominantBaseline="middle"
          fontSize={TICK_FONT_SIZE}
          className="fill-muted"
        >
          {tick.text}
        </text>
      ))}
      {/* The two axis lines: the value axis up the left, the date axis along
          the bottom. */}
      <line
        x1={x}
        y1={y}
        x2={x}
        y2={y + innerHeight}
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
        className="stroke-border"
      />
      <line
        x1={x}
        y1={y + innerHeight}
        x2={x + innerWidth}
        y2={y + innerHeight}
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
        className="stroke-border"
      />
      {xTicks.map((tick) => (
        <text
          key={`x-${tick.text}-${tick.at}`}
          x={tick.at}
          y={y + innerHeight + TICK_FONT_SIZE + 3}
          textAnchor={tick.anchor}
          fontSize={TICK_FONT_SIZE}
          className="fill-muted"
        >
          {tick.text}
        </text>
      ))}
      {xAxisLabel ? (
        <text
          x={x + innerWidth / 2}
          y={height - 1}
          textAnchor="middle"
          fontSize={TICK_FONT_SIZE}
          className="fill-secondary"
        >
          {xAxisLabel}
        </text>
      ) : null}
      {yAxisLabel ? (
        <text
          transform={`rotate(-90 ${TICK_FONT_SIZE} ${y + innerHeight / 2})`}
          x={TICK_FONT_SIZE}
          y={y + innerHeight / 2}
          textAnchor="middle"
          fontSize={TICK_FONT_SIZE}
          className="fill-secondary"
        >
          {yAxisLabel}
        </text>
      ) : null}
    </g>
  );
}
