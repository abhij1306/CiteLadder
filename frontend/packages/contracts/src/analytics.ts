import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared snapshot-projection vocabulary.
//
// These two shapes belong to no single surface: AI Referrals and Performance
// both read dated metric series, and AI Referrals still offers a day/week/
// month bucket control. They mirror the API's one owner
// (`services/api/src/analytics`), so neither surface forks a second
// definition of what a bucket or a series point is.
// ---------------------------------------------------------------------------

/** Snapshot bucket granularity (`AiReferralsSnapshot.granularity`). */
export const snapshotGranularitySchema = z.enum(['day', 'week', 'month']);

/**
 * One dated point of a metric series. A `null` value is an UNAVAILABLE bucket
 * and renders as a chart gap — never coerced to a misleading zero.
 */
const metricSeriesPointSchema = z.object({
  date: z.string(),
  value: z.number().nullable(),
});

export const metricSeriesSchema = z.array(metricSeriesPointSchema);
