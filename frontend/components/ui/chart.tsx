import { useEffect, useRef, useState } from 'react';

import { SERIES_FILL, SERIES_STROKE, type SeriesTone } from '@/components/ui/step-chart-parts';
import { percentText } from '@/lib/format';

export type ChartTone = 1 | 2 | 3 | 4 | 5;

export function chartTone(item: Readonly<{ other?: boolean }>, index: number): ChartTone {
  if (item.other) return 4;
  return index >= 3 ? 5 : ((index + 1) as ChartTone);
}

const CHART_SERIES = {
  1: 'you',
  2: 'rival-1',
  3: 'rival-2',
  4: 'other',
  5: 'rival-2',
} as const satisfies Record<ChartTone, SeriesTone>;

export const chartStroke = (tone: ChartTone) => SERIES_STROKE[CHART_SERIES[tone]];

export const chartFill = (tone: ChartTone) => SERIES_FILL[CHART_SERIES[tone]];

export const CHART_AXIS_TEXT = 'fill-ink-2 text-caption tabular-nums';

export const CHART_PLOT_FRAME = 'focus-ring relative w-full rounded-control';

export const CHART_DASH: Record<ChartTone, string | undefined> = {
  1: undefined,
  2: undefined,
  3: undefined,
  4: '4 3',
  5: '0.01 4.5',
};

export function chartPercent(value: number, total: number): string {
  if (!total) return '0%';
  return percentText(value / total);
}

export function chartTicks(min: number, max: number, count = 5): number[] {
  const span = max - min || 1;
  const raw = span / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = niceStep(raw / magnitude) * magnitude;
  const low = Math.floor(min / step) * step;
  const high = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let value = low; value <= high + step / 2; value += step) {
    ticks.push(Math.round(value * 1e6) / 1e6);
  }
  return ticks;
}

function niceStep(normalised: number): number {
  return [1, 2, 2.5, 5].find((step) => normalised <= step) ?? 10;
}

export function chartPath(points: readonly (readonly [number, number] | null)[]): string {
  let path = '';
  let pen = false;
  for (const point of points) {
    if (!point) {
      pen = false;
      continue;
    }
    path += `${pen ? 'L' : 'M'}${point[0].toFixed(1)} ${point[1].toFixed(1)}`;
    pen = true;
  }
  return path;
}

export function useChartWidth<T extends HTMLElement>(fallback = 640) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const measure = () => {
      const measured = Math.round(element.getBoundingClientRect().width);
      if (measured > 0) setWidth(measured);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

export type ChartHeight = 'sm' | 'md' | 'lg';

/**
 * The roles in pixels, for a chart that draws its plot to a measured box. The
 * same values as the `--chart-height-*` tokens in `apps/app/src/globals.css`.
 */
export const CHART_HEIGHT_PX = { sm: 160, md: 240, lg: 320 } as const satisfies Record<
  ChartHeight,
  number
>;
