import { scalarText } from '../text-order.ts';

export type MetricSeriesPoint = { date: string; value: number | null };

function numericValue(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (
    (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')) &&
    Number.isFinite(Number(value))
  )
    return Number(value);
  throw new TypeError('metric series value is not a finite number');
}

export function metricSeriesPoints(raw: unknown): MetricSeriesPoint[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entry): entry is Record<string, unknown> => {
      return entry !== null && typeof entry === 'object' && !Array.isArray(entry);
    })
    .map((entry) => ({ date: scalarText(entry.date), value: numericValue(entry.value) }));
}
