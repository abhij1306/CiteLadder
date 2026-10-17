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
/**
 * Date-range presets. `latest` sends no bounds — the backend serves the
 * project's latest persisted snapshot at the requested granularity, so the
 * default landing always renders the freshest projection. A bounded preset
 * sends its token and the backend resolves the newest persisted snapshot of
 * that length; when none exists the empty payload comes back, which the
 * screen surfaces honestly rather than recomputing.
 */
export type AiReferralsRange = 'latest' | '30d' | '90d' | '1y';

export const RANGE_OPTIONS: readonly { value: AiReferralsRange; label: string }[] = [
  { value: 'latest', label: 'Latest synced window' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: '1y', label: 'Last 12 months' },
] as const;

export function rangeLabel(value: AiReferralsRange): string {
  return RANGE_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

/**
 * Resolve a range preset into the API query params it sends.
 *
 * A bounded preset sends its `range` TOKEN, never a `from`/`to` computed
 * here. That is the fix for the defect this surface shipped with: provider
 * data lags, so every sync window ends YESTERDAY while a browser computing
 * "last 30 days" anchors on TODAY — and the backend selected a snapshot by
 * exact window. The bounded presets therefore matched nothing and rendered
 * empty, every time. The server now resolves the newest persisted snapshot
 * of the preset's LENGTH and reports the window it actually served.
 *
 * `latest` still sends nothing at all, so the backend serves the project's
 * freshest persisted snapshot.
 */
export function rangeToParams(range: AiReferralsRange): AiReferralsRangeParams {
  return range === 'latest' ? {} : { range };
}

/** Snapshot bucket granularity — mirrors the backend contract vocabulary. */
export type AiReferralsGranularity = z.infer<typeof snapshotGranularitySchema>;

const BUCKET_NOUN: Record<AiReferralsGranularity, string> = {
  day: 'day',
  week: 'week',
  month: 'month',
};

/** Bucket-count badge label ("13 weeks", "1 day"). */
export function bucketCountLabel(granularity: AiReferralsGranularity, count: number): string {
  const noun = BUCKET_NOUN[granularity];
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}
