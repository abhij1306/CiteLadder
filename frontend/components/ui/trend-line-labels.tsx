import type { TrendScale } from '@/components/ui/trend-geometry';

type LabelledLine = Readonly<{ name: string; values: readonly (number | null)[] }>;

const END_LABEL_GAP = 14;
const LABEL_CHAR_WIDTH = 7.4;

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
  const placed = ends.reduce<typeof ends>((above, end) => {
    const floor = (above.at(-1)?.y ?? scale.padTop + 6 - END_LABEL_GAP) + END_LABEL_GAP;
    return [...above, { ...end, y: Math.min(bottom - 4, Math.max(end.y, floor)) }];
  }, []);
  return (
    <g data-line-labels="">
      {placed.map(({ line, x, y }) => {
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
            className="fill-ink-2 stroke-surface text-caption"
          >
            {line.name}
          </text>
        );
      })}
    </g>
  );
}
