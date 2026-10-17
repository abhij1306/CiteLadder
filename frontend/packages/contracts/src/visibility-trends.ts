import { z } from 'zod';
import { modelProvenanceSchema } from './audits.ts';
import { measurementCountsSchema, rankingRowSchema } from './visibility.ts';

const responseObject = <Shape extends z.ZodRawShape>(shape: Shape) => z.object(shape);
const uuid = () => z.uuid();

// ---------------------------------------------------------------------------
// Cross-run Visibility trend history (projection over persisted snapshots)
// ---------------------------------------------------------------------------

// Mention-level share of voice for one trend point, derived from the persisted
// `share_of_voice.mention_counts`; null when nobody was named.
const visibilityTrendSovSchema = responseObject({
  mention: z.number().nullable(),
});

// One brand-vs-competitor ranking-history row within a trend point (backend
// `VisibilityTrendRankingRow`). Field-for-field identical to `rankingRowSchema`
// — aliased so the two contracts can't drift apart silently.
const visibilityTrendRankingRowSchema = rankingRowSchema;

// One point in the cross-run Visibility trend (backend `VisibilityTrendPoint`).
// A raw per-run point carries a set `audit_id`; a week/month bucket folds many
// snapshots (`audit_id` is null) and carries the full provenance list. Version
// metadata lists every distinct analyzer/scoring version the point folds, with
// `spans_version_boundary` set when a bucket mixes versions. `avg_position`
// folds by completions.
export const visibilityTrendPointSchema = responseObject({
  audit_id: uuid().nullable(),
  completed_at: z.string(),
  logical_engine: z.string().nullable(),
  visibility_score: z.number().nullable(),
  visibility_rate: z.number().nullable().optional(),
  prompt_performance_score: z.number().nullable().optional(),
  counts: measurementCountsSchema.optional(),
  comparison_key: z.string().nullable().optional(),
  run_count: z.number().int().optional(),
  source_audit_ids: z.array(uuid()).optional(),
  brand_mention_rate: z.number().nullable(),
  owned_citation_rate: z.number().nullable(),
  sov: visibilityTrendSovSchema,
  rankings: z.array(visibilityTrendRankingRowSchema),
  avg_position: z.number().nullable(),
  // Measurement identity partition: a point folds only inside
  // one (transport_model, retrieval_enabled) identity, so
  // the client must never recombine points across these. `transport_model` is
  // null when the point spans several models — see `model_provenance`.
  transport_model: z.string().nullable().default(null),
  retrieval_enabled: z.boolean().nullable().default(null),
  model_provenance: z.array(modelProvenanceSchema).default([]),
  // Provenance: every source snapshot this point folds.
  source_snapshot_ids: z.array(uuid()),
  // Distinct versions across the folded snapshots.
  analyzer_versions: z.array(z.string()),
  scoring_rule_versions: z.array(z.string()),
  spans_version_boundary: z.boolean(),
});

// The trends endpoint returns a chronological list of points (never wrapped).
export const visibilityTrendListSchema = z.array(visibilityTrendPointSchema);
