import type { TrendPoint } from '@/components/ui/series-data';
import type { AiReferrals, AiSource } from '@/lib/api/ai-traffic';
import { formatShortDate } from '@/lib/format';
import { label } from './vocabulary';

type SeriesPoint = { date: string; value: number | null };

type Bucketing = Readonly<{ granularity: AiReferrals['granularity']; windowEnd: string | null }>;

function bucketBounds(day: string, granularity: AiReferrals['granularity']) {
  const at = new Date(`${day}T00:00:00Z`);
  const [year, month, date] = [at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()];
  const monday = date - ((at.getUTCDay() + 6) % 7);
  const iso = (day: number, month: number) =>
    new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
  switch (granularity) {
    case 'day':
      return { start: iso(date, month), end: iso(date, month) };
    case 'week':
      return { start: iso(monday, month), end: iso(monday + 6, month) };
    case 'month':
      return { start: iso(1, month), end: iso(0, month + 1) };
    default: {
      const unreachable: never = granularity;
      return unreachable;
    }
  }
}

function chartPoints(
  points: readonly SeriesPoint[],
  { granularity, windowEnd }: Bucketing,
  scale: (value: number) => number,
): TrendPoint[] {
  const first = points[0];
  const last = points.at(-1);
  const partialFirst =
    first !== undefined && bucketBounds(first.date, granularity).start !== first.date;
  const partialLast =
    last !== undefined &&
    windowEnd !== null &&
    bucketBounds(last.date, granularity).end > windowEnd;
  return points.map((point, index) => {
    const day = formatShortDate(point.date);
    const cutFirst = partialFirst && index === 0;
    const cutLast = partialLast && index === points.length - 1;
    let label = day;
    if (cutLast) label = `${day} (in progress)`;
    else if (cutFirst) label = `${day} (partial ${granularity})`;
    return {
      label,
      axisLabel: formatShortDate(bucketBounds(point.date, granularity).start),
      value: point.value === null ? null : scale(point.value),
      breakBefore: cutLast || (partialFirst && index === 1),
    };
  });
}

export function toCountChartPoints(points: readonly SeriesPoint[], bucketing: Bucketing) {
  return chartPoints(points, bucketing, Math.round);
}

export function toPercentChartPoints(points: readonly SeriesPoint[], bucketing: Bucketing) {
  return chartPoints(points, bucketing, (value) => Math.round(value * 1000) / 10);
}

export function countDomainMax(values: readonly number[]): number {
  const max = values.length ? Math.max(...values) : 0;
  if (max <= 100) return 100;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  return Math.ceil(max / magnitude) * magnitude;
}

const AI_SOURCE_LABELS: Record<AiSource, string> = {
  chatgpt: 'ChatGPT',
  gemini: 'Gemini',
  claude: 'Claude',
  perplexity: 'Perplexity',
  copilot: 'Copilot',
  google_ai_overview: 'Google AI Overview',
  other: 'Other',
};

export const aiSourceLabel = (source: string) => label(AI_SOURCE_LABELS, source);

export function totalSourceSessions(sources: AiReferrals['sources']): number {
  return sources.reduce((sum, row) => sum + row.sessions, 0);
}

export function isAiReferralsEmpty(data: AiReferrals): boolean {
  return data.referral_volume.length === 0 && data.referral_share.length === 0;
}
