import { z } from 'zod';

import { pageKindSchema, siteCrawlSchema, siteUrlSourceSchema } from './crawl.ts';
import { responseObject, uuid } from './core.ts';
import { cursorPageSchema } from './pagination.ts';

// The exact frozen pack identity an understanding was produced under. Shown in
// the "why this role?" disclosure so a result is always attributable to one
// reviewed pack version rather than to "the classifier" in general.
// Nullable analysis-summary fields shared by inventory rows and analyzed-page
// summary rows (null until analysis completes for that URL). `page_kind`
// joins them: it is stamped by the analysis classifier, so an unanalyzed row
// has no classification yet (null — the UI renders `Not measured`, never a guessed type).
// `aeo_measurement_reason` is empty for classified pages and carries
// `page_purpose_unresolved` for a successful `other` abstention.
export const analysisSummaryFields = {
  issue_count: z.number().int().nullable(),
  web_fundamentals_score: z.number().nullable(),
  web_fundamentals_coverage: z.number().nullable(),
  web_fundamentals_state: z.enum(['measured', 'limited_evidence', 'not_measured', 'excluded']),
  aeo_readiness_score: z.number().nullable(),
  aeo_measurement_coverage: z.number().nullable(),
  aeo_measurement_state: z.enum(['measured', 'limited_evidence', 'not_measured', 'excluded']),
  aeo_measurement_reason: z.string(),
  main_content_indexable: z.boolean().nullable(),
  last_audited: z.string().nullable(),
  page_kind: pageKindSchema.nullable(),
  // Bounded industry-role fields on list rows. These are pack-defined IDs, not
  // a fixed enum, so they stay plain strings — the UI must never title-case an
  // unknown namespaced ID as though it were a reviewed label. Absent entirely
  // when the pack classifier never ran for the row.
};

// One lightweight inventory row. Ordering is URL-only. The analysis summary
// measurement fields and `last_audited` are null/unmeasured until analysis
// completes for that URL.
export const inventoryRowSchema = responseObject({
  site_url_id: uuid(),
  normalized_url: z.string(),
  display_url: z.string(),
  title: z.string().nullable(),
  content_type: z.string().nullable(),
  source: siteUrlSourceSchema.nullable(),
  depth: z.number().int().nullable(),
  monitored: z.boolean(),
  first_seen_at: z.string().nullable(),
  last_seen_at: z.string().nullable(),
  ...analysisSummaryFields,
});

export const inventoryPageSchema = cursorPageSchema(inventoryRowSchema);
export const siteCrawlListPageSchema = cursorPageSchema(siteCrawlSchema);

// Workspace-wide monitored quota usage (counts every active monitored row).
export const monitoredQuotaSchema = responseObject({
  used: z.number().int(),
  limit: z.number().int(),
});

// One persistent monitored-set row.
const monitoredUrlSchema = responseObject({
  site_url_id: uuid(),
  normalized_url: z.string(),
  display_url: z.string(),
  title: z.string().nullable(),
  active: z.boolean(),
  selection_source: z.enum(['user', 'free_sample', 'bootstrap']),
  selected_at: z.string().nullable(),
  deselected_at: z.string().nullable(),
});

// `GET /projects/{id}/monitored-urls` — persistent set + revision + quota.
export const monitoredUrlsResponseSchema = responseObject({
  project_id: uuid(),
  selection_version: z.number().int(),
  monitored_urls: z.array(monitoredUrlSchema),
  quota: monitoredQuotaSchema,
});
