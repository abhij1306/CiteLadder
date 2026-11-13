import { z } from 'zod';

const responseObject = <Shape extends z.ZodRawShape>(shape: Shape) => z.object(shape);

export const demandSignalSchema = responseObject({
  id: z.uuid(),
  snapshot_id: z.uuid(),
  signal_type: z.string(),
  state: z.string(),
  topic_cluster: z.string(),
  page_url: z.string(),
  evidence: z.record(z.string(), z.unknown()),
  metrics: z.record(z.string(), z.unknown()),
  coverage: z.record(z.string(), z.unknown()),
  limitations: z.array(z.string()),
  priority_score: z.number().nullable(),
  priority_inputs: z.record(z.string(), z.unknown()),
  created_at: z.string(),
  // The Action this signal was promoted into; null when it was not.
  action_id: z.uuid().nullable(),
});

/** The detectors one demand snapshot runs; every snapshot reports each of them. */
export const demandDetectorSchema = z.enum([
  'striking_distance',
  'cannibalization',
  'property_relative_ctr_gap',
  'high_impression_low_ctr',
  'query_trends',
]);
export type DemandDetector = z.infer<typeof demandDetectorSchema>;

/** How far one detector ran: in full, partly, not at all, or held back for history. */
export const demandDetectorStateSchema = z.enum([
  'available',
  'partial',
  'unavailable',
  'insufficient_history',
]);
export type DemandDetectorState = z.infer<typeof demandDetectorStateSchema>;

/** What a snapshot's detectors found: written by the snapshot task, read by the signal filters. */
export const demandSnapshotSummarySchema = responseObject({
  signal_count: z.number().int(),
  counts_by_type: z.record(z.string(), z.number().int()),
  detectors: z.record(
    demandDetectorSchema,
    responseObject({
      state: demandDetectorStateSchema,
      counts_by_classification: z.record(z.string(), z.number().int()),
      limitations: z.array(z.string()),
    }),
  ),
});
export type DemandSnapshotSummary = z.infer<typeof demandSnapshotSummarySchema>;

/**
 * The detectors' thresholds from the API's demand policy, sent with the
 * snapshot so the screen states each rule from the values the detectors read
 * and never restates them. Shares are fractions (0.1 is 10%).
 */
export const demandDetectorPolicySchema = responseObject({
  striking_distance: responseObject({
    min_impressions: z.number(),
    min_position: z.number(),
    max_position: z.number(),
  }),
  cannibalization: responseObject({
    min_page_impressions: z.number(),
    min_page_share: z.number(),
  }),
  ctr_gap: responseObject({
    min_candidate_impressions: z.number(),
    relative_threshold: z.number(),
    absolute_threshold: z.number(),
    min_cohort_rows: z.number(),
    min_cohort_impressions: z.number(),
  }),
  low_ctr: responseObject({
    min_impressions: z.number(),
    ctr_threshold: z.number(),
    max_signals: z.number(),
  }),
  trends: responseObject({
    window_days: z.number(),
    required_days: z.number(),
    emerging_ratio: z.number(),
    declining_ratio: z.number(),
  }),
});
export type DemandDetectorPolicy = z.infer<typeof demandDetectorPolicySchema>;

export const demandSnapshotSchema = responseObject({
  id: z.uuid(),
  project_id: z.uuid(),
  window_start: z.string(),
  window_end: z.string(),
  source_hash: z.string(),
  prior_snapshot_id: z.uuid().nullable(),
  source_artifact_ids: z.array(z.string()),
  source_metric_row_ids: z.array(z.string()),
  coverage: z.record(z.string(), z.unknown()),
  summary: demandSnapshotSummarySchema,
  comparison: z.record(z.string(), z.unknown()).nullable(),
  formula_version: z.string(),
  analyzer_version: z.string(),
  created_at: z.string(),
  signals: z.array(demandSignalSchema),
  detector_policy: demandDetectorPolicySchema,
});

export const demandRecomputeResponseSchema = responseObject({
  task_id: z.uuid().nullable(),
  status: z.string(),
});

/**
 * A manual recompute of one date window. The API refines it so `window_end`
 * is not before `window_start`.
 */
export const demandRecomputeRequestSchema = z.strictObject({
  window_start: z.iso.date(),
  window_end: z.iso.date(),
});
export type DemandRecomputeRequest = z.input<typeof demandRecomputeRequestSchema>;

/** An owner's branded/non-branded call for one search query. */
export const demandClassificationOverrideRequestSchema = z.strictObject({
  query: z.string().min(1).max(512),
  classification: z.enum(['branded', 'non_branded', 'ambiguous']),
});
export type DemandClassificationOverrideRequest = z.input<
  typeof demandClassificationOverrideRequestSchema
>;
