/** Search Intelligence request bodies and the server-only handoff response. */
import { searchDatasetSchema } from '@citeladder/contracts/search-intelligence';
import { z } from 'zod';

import { policy } from '../config.ts';

const si = policy.search_intelligence;
const researchScope = searchDatasetSchema.shape.research_scope;

/** Saved acquisition defaults; omitted fields take the policy defaults. */
export const preferencesBody = z.object({
  research_scope: researchScope.default(researchScope.parse(si.default_research_scope)),
  owned_target_id: z.string().nullable().default(null),
  competitor_ids: z.array(z.uuid()).default([]),
  location_code: z.int().positive().nullable().default(null),
  language_code: z.string().max(16).default(''),
  reuse_recent: z.boolean().default(true),
  depths: z
    .record(z.string(), z.int().min(1).max(si.max_depth))
    .refine(
      (depths) => Object.keys(depths).every((kind) => Object.hasOwn(si.default_depths, kind)),
      {
        message: 'Depths are accepted only for list datasets',
      },
    )
    .default(() => ({ ...si.default_depths })),
});
export type Preferences = z.output<typeof preferencesBody>;

const datasetSelection = z
  .object({
    kind: z.enum([
      'footprint',
      'ranking_keywords',
      'missing_keywords',
      'shared_keywords',
      'keyword_suggestions',
      'backlink_summary',
      'referring_domains',
      'destination_pages',
      'organic_pages',
      'backlinks',
      'backlink_history',
    ]),
    competitor_id: z.uuid().nullable().default(null),
    depth: z.int().min(1).max(si.max_depth).default(1),
    seed: z.string().max(700).default(''),
    grouping: z.enum(['as_is', 'one_per_domain']).default('as_is'),
    order: z.enum(['volume', 'traffic', 'position', 'difficulty', 'cpc']).default('volume'),
    min_volume: z.int().nonnegative().nullable().default(null),
  })
  .superRefine((item, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
    const comparison = ['missing_keywords', 'shared_keywords'].includes(item.kind);
    const keyword = [
      'ranking_keywords',
      'missing_keywords',
      'shared_keywords',
      'keyword_suggestions',
    ].includes(item.kind);
    const competitor =
      comparison ||
      [
        'footprint',
        'backlink_summary',
        'referring_domains',
        'destination_pages',
        'organic_pages',
        'backlinks',
        'backlink_history',
      ].includes(item.kind);
    if (comparison && !item.competitor_id) fail('Comparison requires one competitor');
    if (item.competitor_id && !competitor) fail('Dataset does not support a competitor target');
    if (!keyword && (item.order !== 'volume' || item.min_volume !== null))
      fail('Acquisition controls require a keyword dataset');
    if (item.kind === 'keyword_suggestions' && ['traffic', 'position'].includes(item.order))
      fail('Suggestions have no observed position or traffic');
    if (item.kind === 'keyword_suggestions' ? !item.seed.trim() : Boolean(item.seed))
      fail('Seed is required only for keyword suggestions');
    if (item.kind === 'backlinks' && item.depth > si.backlink_max_offset + si.page_size)
      fail('Backlinks depth exceeds supported offsets');
  });
export const reviewBody = z.object({
  research_scope: researchScope.nullable().default(null),
  action: z
    .enum(['analysis', 'refresh', 'seed', 'backlink_details', 'increase_depth', 'recovery'])
    .default('analysis'),
  owned_target_id: z.string().nullable().default(null),
  connection_id: z.uuid().nullable().default(null),
  location_code: z.int().positive().nullable().default(null),
  language_code: z.string().max(16).default(''),
  reuse_recent: z.boolean().default(true),
  save_as_defaults: z.boolean().default(false),
  datasets: z.array(datasetSelection).min(1).max(25),
  previous_run_id: z.uuid().nullable().default(null),
});
export type ReviewInput = z.output<typeof reviewBody>;

export const citationMatchBody = z.object({
  backlink_dataset_id: z.uuid(),
  audit_ids: z.array(z.uuid()).min(1).max(50),
});
