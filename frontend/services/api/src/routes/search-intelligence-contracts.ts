/** Search Intelligence request bodies, bounded by the configured policy. */
import {
  SEARCH_DATASET_KINDS,
  searchDatasetSchema,
} from '@citeladder/contracts/search-intelligence';
import {
  searchDatasetSelectionRequestSchema,
  searchPreferencesRequestSchema,
  searchReviewRequestSchema,
} from '@citeladder/contracts/search-intelligence-requests';
import { z } from 'zod';

import { policy } from '../config.ts';

const si = policy.search_intelligence;
const researchScope = searchDatasetSchema.shape.research_scope;

/** Saved acquisition defaults; omitted fields take the policy defaults. */
export const preferencesBody = searchPreferencesRequestSchema.extend({
  research_scope: researchScope.default(researchScope.parse(si.default_research_scope)),
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

const datasetSelection = searchDatasetSelectionRequestSchema
  .extend({
    depth: z.int().min(1).max(si.max_depth).default(1),
  })
  .superRefine((item, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
    const kind = SEARCH_DATASET_KINDS[item.kind];
    if (kind.comparison && !item.competitor_id) fail('Comparison requires one competitor');
    if (item.competitor_id && !kind.competitor)
      fail('Dataset does not support a competitor target');
    if (!kind.keyword && (item.order !== 'volume' || item.min_volume !== null))
      fail('Acquisition controls require a keyword dataset');
    if (kind.seed && ['traffic', 'position'].includes(item.order))
      fail('Suggestions have no observed position or traffic');
    if (kind.seed ? !item.seed.trim() : Boolean(item.seed))
      fail('Seed is required only for keyword suggestions');
    if (item.kind === 'backlinks' && item.depth > si.backlink_max_offset + si.page_size)
      fail('Backlinks depth exceeds supported offsets');
  });
export const reviewBody = searchReviewRequestSchema.extend({
  datasets: z.array(datasetSelection).min(1).max(25),
});
export type ReviewInput = z.output<typeof reviewBody>;
