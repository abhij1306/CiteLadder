/**
 * Shared display-format vocabulary — ONE owner for the
 * date / count / URL / snapshot-granularity formatters the Traffic,
 * AI Referrals, and Settings→Integrations surfaces all render with.
 *
 * The domain modules (`lib/traffic/traffic`, `lib/ai-traffic/options`,
 * `lib/ai-traffic/series`) re-export these under their local names so
 * domain import sites stay local; new code should import from here.
 *
 * Everything is pure and framework-free. Calendar bucket dates are fixed to
 * UTC; timestamp displays receive an explicit resolved timezone. Unparseable
 * input passes through untouched — never a fabricated value.
 */
import type { z } from 'zod';

import type { snapshotGranularitySchema } from '@citeladder/contracts/analytics';

/** Snapshot bucket granularity — mirrors the backend contract vocabulary. */
type BucketGranularity = z.infer<typeof snapshotGranularitySchema>;

export type DataAvailabilityState =
  | 'not_measured'
  | 'not_run'
  | 'not_set'
  | 'unavailable'
  | 'not_applicable'
  | 'unknown';

const availabilityLabels: Readonly<Record<DataAvailabilityState, string>> = {
  not_measured: 'Not measured',
  not_run: 'Not run',
  not_set: 'Not set',
  unavailable: 'Unavailable',
  not_applicable: 'Not applicable',
  unknown: 'Unknown',
};

/** Human-readable product vocabulary for explicit missing-data states. */
export function availabilityLabel(state: DataAvailabilityState): string {
  return availabilityLabels[state];
}

/** A persisted fraction (0.125) as a percentage ("12.5%"); null is not measured. */
export function formatPercent(fraction: number | null, decimals = 0): string {
  if (fraction === null) return availabilityLabel('not_measured');
  return `${(fraction * 100).toFixed(decimals)}%`;
}

/**
 * The mark a missing MEASUREMENT renders as, everywhere it is shown.
 *
 * `not_measured` is the one availability state with no words on screen: a
 * metric card, a table cell and a chart label all print this dash, because the
 * phrase said the same thing at every figure on the page and crowded out the
 * figures that WERE measured. The words stay the accessible name — every
 * renderer pairs the mark with `availabilityLabel('not_measured')` in sr-only
 * text, so nothing is lost to a screen reader.
 *
 * It must never be an empty string: a blank and a measured zero look identical,
 * and those are opposite findings.
 *
 * Workflow states a reader can ACT on — "Not run", "Failed", "Not set" — keep
 * their words. Those are answers, not absent numbers.
 */
export const MISSING_MARK = '–';

export const GRANULARITY_OPTIONS: readonly { value: BucketGranularity; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
] as const;

/** `2026-07-23` → `Jul 23` (series bucket labels + active-run windows). */
export function formatShortDate(isoDay: string): string {
  const date = new Date(`${isoDay}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return isoDay;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** `2026-07-23` → `Jul 23, 2026` (window labels in notes). */
export function formatWindowDate(isoDay: string): string {
  const date = new Date(`${isoDay}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return isoDay;
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** A persisted instant, rendered in the selected display timezone. */
export function formatDisplayTimestamp(timestamp: string, timeZone: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  try {
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone,
      timeZoneName: 'short',
    }).format(date);
  } catch {
    return timeZone === 'UTC' ? timestamp : formatDisplayTimestamp(timestamp, 'UTC');
  }
}

/** Date portion of a persisted instant, using the same display timezone. */
export function formatDisplayDate(timestamp: string, timeZone: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  try {
    return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone }).format(date);
  } catch {
    return timeZone === 'UTC' ? timestamp : formatDisplayDate(timestamp, 'UTC');
  }
}

/** Compact chart label for a persisted instant. */
export function formatDisplayShortDate(timestamp: string, timeZone: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  try {
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone }).format(
      date,
    );
  } catch {
    return timeZone === 'UTC' ? timestamp : formatDisplayShortDate(timestamp, 'UTC');
  }
}

export function formatScore(score: number | null): string {
  return score === null || Number.isNaN(score)
    ? availabilityLabel('not_measured')
    : `${Math.round(score)}`;
}

/** Convert the shared unavailable sentinel to a nullable display value. */
export function measured(value: string): string | null {
  return value === availabilityLabel('not_measured') ? null : value;
}

const numberFormat = new Intl.NumberFormat('en-US');

/** Whole-number grouping for counts (`1,162,000`). */
export function formatCount(value: number): string {
  return numberFormat.format(value);
}

/** A grouped count with its noun, pluralized with a trailing `s` (`1 answer`, `1,200 answers`). */
export function pluralCount(count: number, noun: string): string {
  return `${formatCount(count)} ${noun}${count === 1 ? '' : 's'}`;
}
