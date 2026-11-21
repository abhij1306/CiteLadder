/**
 * AI Referrals toolbar vocabulary: the date-range presets and snapshot
 * granularity driving the `/ai-traffic` screen.
 *
 * The range presets are OWNED here, mirroring the Performance surface's
 * server-resolved range contract: the default `latest` preset
 * sends NO bounds so the backend serves the project's freshest persisted
 * snapshot, and a bounded preset sends its `range` TOKEN for the server to
 * resolve against persisted evidence. Neither mode derives a date from the
 * browser clock — see `rangeToParams`. This module also carries the
 * AI-referrals-specific granularity vocabulary (`day | week | month` — the backend
 * `snapshotGranularitySchema`, NOT the visibility trend's `run | week |
 * month`) plus the bucket-count labels the cards use.
 */
import type { z } from 'zod';

import type { AiReferralsRangeParams } from '@/lib/api/ai-traffic';
import type { snapshotGranularitySchema } from '@citeladder/contracts/analytics';
export type AiReferralsRange = 'latest' | '30d' | '90d' | '1y';

/** Every sync writes the 30-day preset, so an empty default means nothing synced yet. */
export const DEFAULT_RANGE: AiReferralsRange = '30d';

export const RANGE_OPTIONS: readonly { value: AiReferralsRange; label: string }[] = [
  { value: 'latest', label: 'Latest synced window' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: '1y', label: 'Last 12 months' },
] as const;

export function rangeLabel(value: AiReferralsRange): string {
  return RANGE_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

export function rangeToParams(range: AiReferralsRange): AiReferralsRangeParams {
  return range === 'latest' ? {} : { range };
}

export type AiReferralsGranularity = z.infer<typeof snapshotGranularitySchema>;

const BUCKET_NOUN: Record<AiReferralsGranularity, string> = {
  day: 'day',
  week: 'week',
  month: 'month',
};

export function bucketCountLabel(granularity: AiReferralsGranularity, count: number): string {
  const noun = BUCKET_NOUN[granularity];
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}
