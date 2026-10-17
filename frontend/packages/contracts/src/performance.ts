import { z } from 'zod';

import { integrationProviderSchema } from './integrations.ts';

// ---------------------------------------------------------------------------
// Performance (projection over persisted TrafficSnapshot / dimension stat rows
// — no read-time recomputation and no provider calls anywhere)
//
// Every nullable field below is contractual, and each null means "not
// measured" rather than a zero a reader could mistake for an observation:
//   - a null series value is an unmeasured bucket (a chart gap);
//   - null clicks/impressions mean the window has no `gsc_day_daily` evidence
//     at all, not that nobody clicked;
//   - null ctr/position mean the aggregate had zero impressions;
//   - null sessions/key events mean no included GA4 row fed the window;
//   - a null `comparison` means none was requested, and a comparison block
//     with a null `snapshot_id` means one was requested but is not projected.
// ---------------------------------------------------------------------------

const responseObject = <Shape extends z.ZodRawShape>(shape: Shape) => z.object(shape);
const uuid = () => z.uuid();

export const performanceRangeSchema = z.enum([
  'day',
  'week',
  'month',
  '3_months',
  '6_months',
  'last_synced',
  'custom',
]);
export const performanceCompareSchema = z.enum(['none', 'previous', 'year_over_year', 'custom']);
export const performanceDimensionSchema = z.enum([
  'query',
  'page',
  'country',
  'device',
  'search_appearance',
  'day',
  // Bing's own two breakdowns. They are a SEPARATE panel, never tabs beside
  // the Search Console six: the engines report different populations, so a
  // reader must always know which one a row came from.
  'bing_query',
  'bing_page',
]);
const evidenceStateSchema = z.enum(['not_run', 'observed_zero', 'available']);
/** The chart's BUCKET size — distinct from the range, which is its LENGTH. */
export const performanceGranularitySchema = z.enum(['day', 'week', 'month']);

const performanceSeriesPointSchema = responseObject({
  date: z.string(),
  value: z.number().nullable(),
});

const metricSeries = z.array(performanceSeriesPointSchema);

const performanceTotalsSchema = responseObject({
  clicks: z.number().int().nullable(),
  impressions: z.number().int().nullable(),
  ctr: z.number().nullable(),
  position: z.number().nullable(),
  sessions: z.number().int().nullable(),
  key_events: z.number().nullable(),
});

// GA4 is deliberately absent from the series: it renders as a compact,
// non-interactive summary row, so all four chart metrics come from one
// provider and one dataset.
const performanceSeriesSchema = responseObject({
  clicks: metricSeries,
  impressions: metricSeries,
  ctr: metricSeries,
  position: metricSeries,
});

export const performanceWindowSchema = responseObject({
  snapshot_id: uuid().nullable(),
  window_start: z.string(),
  window_end: z.string(),
  evidence_state: evidenceStateSchema,
  totals: performanceTotalsSchema,
  series: performanceSeriesSchema,
});

const performanceCoverageSchema = responseObject({
  earliest_date: z.string().nullable(),
  latest_date: z.string().nullable(),
  covered_days: z.number().int(),
  analytics_quality: z
    .record(
      z.string(),
      z.array(
        z.object({ day: z.string(), revision: z.number().nullable(), flags: z.array(z.string()) }),
      ),
    )
    .default({}),
});

const performanceDimensionCountsSchema = responseObject({
  query: z.number().int(),
  page: z.number().int(),
  country: z.number().int(),
  device: z.number().int(),
  search_appearance: z.number().int(),
  day: z.number().int(),
  bing_query: z.number().int(),
  bing_page: z.number().int(),
});

/**
 * `GET /projects/{id}/readiness` — where a project sits after its connect.
 *
 * The stages are distinct STATES, never a progress percentage: nothing
 * connected, connected with no import enqueued, importing, an import that
 * failed outright, core data ready with analysis still computing, and
 * analysis ready. `import_failed` is off the ladder rather than on it —
 * nothing further is coming, so rendering it as a slower `importing` would
 * spin forever in front of an import that needs retrying.
 */
export const projectReadinessStageSchema = z.enum([
  'not_connected',
  'connected',
  'importing',
  'import_failed',
  'core_data_ready',
  'analysis_ready',
]);

export const projectReadinessSchema = responseObject({
  project_id: uuid(),
  stage: projectReadinessStageSchema,
  connection_count: z.number().int(),
  // The engines actually connected to this project. A surface uses it to
  // decide whether an engine's panel belongs on screen at all: no Bing
  // connection is not the same answer as a Bing panel measuring nothing.
  providers: z.array(integrationProviderSchema),
  backfill_state: z.string().nullable(),
  // The date EVERY mapped connection has imported through; null as soon as
  // one of them has imported nothing.
  imported_through: z.string().nullable(),
  has_performance_snapshot: z.boolean(),
  has_demand_snapshot: z.boolean(),
  opportunity_count: z.number().int(),
});

// `GET /projects/{id}/performance`
export const performanceDashboardSchema = responseObject({
  project_id: uuid(),
  range: performanceRangeSchema,
  granularity: performanceGranularitySchema,
  compare: performanceCompareSchema,
  selected: performanceWindowSchema,
  comparison: performanceWindowSchema.nullable(),
  coverage: performanceCoverageSchema,
  dimension_counts: performanceDimensionCountsSchema,
  // Dimensions whose provider report is never collected. Their table renders
  // as UNAVAILABLE, never as an observed-empty result.
  unavailable_dimensions: z.array(performanceDimensionSchema),
  formula_version: z.string(),
  normalization_version: z.string(),
});

export const performanceMetricsSchema = responseObject({
  clicks: z.number().int().nullable(),
  impressions: z.number().int().nullable(),
  ctr: z.number().nullable(),
  position: z.number().nullable(),
});

// A key absent from the comparison period was NOT observed there, which is
// different from having been observed at zero — so `comparison_metrics` is
// null and the difference column renders unavailable.
const performanceTableRowSchema = responseObject({
  dimension_key: z.string(),
  display_value: z.string(),
  metrics: performanceMetricsSchema,
  comparison_metrics: performanceMetricsSchema.nullable(),
});

// `total_count` is the snapshot's persisted per-dimension count — never a
// `COUNT(*)` issued per page navigation.
export const performanceTablePageSchema = responseObject({
  dimension: performanceDimensionSchema,
  items: z.array(performanceTableRowSchema),
  next_cursor: z.string().nullable(),
  total_count: z.number().int(),
  page_size: z.number().int(),
});

export const performanceRangeTaskSchema = responseObject({
  task_id: uuid(),
  status: z.string(),
  window_start: z.string(),
  window_end: z.string(),
});
