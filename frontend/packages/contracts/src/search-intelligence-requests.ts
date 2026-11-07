/**
 * Request bodies of Search Intelligence: saved acquisition defaults, a cost
 * review of selected datasets, and citation matching. These own the wire
 * shape; the API `.extend`s each with its configured depth bounds, defaults
 * and dataset rules, and the browser types its arguments as `z.input` of them.
 */
import { z } from 'zod';

import { researchScopeSchema, searchDatasetKindSchema } from './search-intelligence.ts';

const locationCode = () => z.int().positive().nullable().default(null);
const languageCode = () => z.string().max(16).default('');

/** Saved acquisition defaults; omitted fields take the server's configured defaults. */
export const searchPreferencesRequestSchema = z.object({
  research_scope: researchScopeSchema.optional(),
  owned_target_id: z.string().nullable().default(null),
  competitor_ids: z.array(z.uuid()).default([]),
  location_code: locationCode(),
  language_code: languageCode(),
  reuse_recent: z.boolean().default(true),
  // Pages per list dataset, by dataset kind.
  depths: z.record(z.string(), z.int().min(1)).optional(),
});
export type SearchPreferencesRequest = z.input<typeof searchPreferencesRequestSchema>;

/**
 * One dataset a review asks for. The API checks which controls each kind
 * accepts against `SEARCH_DATASET_KINDS`.
 */
export const searchDatasetSelectionRequestSchema = z.object({
  kind: searchDatasetKindSchema,
  competitor_id: z.uuid().nullable().default(null),
  depth: z.int().min(1).default(1),
  seed: z.string().max(700).default(''),
  grouping: z.enum(['as_is', 'one_per_domain']).default('as_is'),
  order: z.enum(['volume', 'traffic', 'position', 'difficulty', 'cpc']).default('volume'),
  min_volume: z.int().nonnegative().nullable().default(null),
});
export type SearchDatasetSelectionRequest = z.input<typeof searchDatasetSelectionRequestSchema>;

const searchReviewActionSchema = z.enum([
  'analysis',
  'refresh',
  'seed',
  'backlink_details',
  'increase_depth',
  'recovery',
]);
export type SearchReviewAction = z.infer<typeof searchReviewActionSchema>;

/** A cost review of the selected datasets; nothing is fetched until the run is confirmed. */
export const searchReviewRequestSchema = z.object({
  research_scope: researchScopeSchema.nullable().default(null),
  action: searchReviewActionSchema.default('analysis'),
  owned_target_id: z.string().nullable().default(null),
  connection_id: z.uuid().nullable().default(null),
  location_code: locationCode(),
  language_code: languageCode(),
  reuse_recent: z.boolean().default(true),
  save_as_defaults: z.boolean().default(false),
  datasets: z.array(searchDatasetSelectionRequestSchema).min(1).max(25),
  previous_run_id: z.uuid().nullable().default(null),
});
export type SearchReviewRequest = z.input<typeof searchReviewRequestSchema>;

/** Match a saved backlink dataset's referring pages against the citations of selected runs. */
export const searchCitationMatchRequestSchema = z.object({
  backlink_dataset_id: z.uuid(),
  audit_ids: z.array(z.uuid()).min(1).max(50),
});
export type SearchCitationMatchRequest = z.input<typeof searchCitationMatchRequestSchema>;
