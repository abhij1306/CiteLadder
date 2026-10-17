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
  summary: z.record(z.string(), z.unknown()),
  comparison: z.record(z.string(), z.unknown()).nullable(),
  formula_version: z.string(),
  analyzer_version: z.string(),
  created_at: z.string(),
  signals: z.array(demandSignalSchema),
});

export const demandRecomputeResponseSchema = responseObject({
  task_id: z.uuid().nullable(),
  status: z.string(),
});
