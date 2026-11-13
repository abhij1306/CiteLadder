import type { TrendScale } from '@/components/ui/trend-geometry';

/** A plotted line as its end label reads it: its name and its values. */
type LabelledLine = Readonly<{ name: string; values: readonly (number | null)[] }>;

/** The vertical room one end label needs, so two labels never overprint. */
const END_LABEL_GAP = 14;
/** A caption glyph's average width, the estimate the axis ticks also use. */
const LABEL_CHAR_WIDTH = 7.4;

/**
 * Each line's name just above and before its latest measured point, pushed
 * apart where two lines end close together and kept inside the plot. The
 * labels are drawn over a surface halo so they stay legible across a line.
 */
export function LineEndLabels({
  lines,
  scale,
  bottom,
}: Readonly<{ lines: readonly LabelledLine[]; scale: TrendScale; bottom: number }>) {
  const ends = lines
    .flatMap((line) => {
      for (let index = line.values.length - 1; index >= 0; index -= 1) {
        const value = line.values[index];
        if (value !== null && value !== undefined)
          return [{ line, x: scale.x(index), y: scale.y(value) - 10 }];
      }
      return [];
    })
    .sort((a, b) => a.y - b.y);
  // Each label sits at its line's end, or just below the label above it.
  const placed = ends.reduce<typeof ends>((above, end) => {
    const floor = (above.at(-1)?.y ?? scale.padTop + 6 - END_LABEL_GAP) + END_LABEL_GAP;
    return [...above, { ...end, y: Math.min(bottom - 4, Math.max(end.y, floor)) }];
  }, []);
  return (
    <g data-line-labels="">
      {placed.map(({ line, x, y }) => {
        // A line that ends near the left edge has no room before its point:
        // its label would run over the axis ticks, so it reads after the point.
        const fitsBefore = x - 6 - line.name.length * LABEL_CHAR_WIDTH >= scale.padLeft;
        return (
          <text
            key={line.name}
            x={fitsBefore ? x - 6 : x + 6}
            y={y}
            textAnchor={fitsBefore ? 'end' : 'start'}
            dominantBaseline="middle"
            paintOrder="stroke"
            strokeWidth={3}
            className="fill-ink-secondary stroke-surface text-caption"
          >
            {line.name}
          </text>
        );
      })}
    </g>
  );
}
