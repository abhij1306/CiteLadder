import { z } from 'zod';

import { checksRunSchema, pageKindSchema, siteCrawlSchema, siteUrlSourceSchema } from './crawl.ts';
import { responseObject, uuid } from './core.ts';
import { cursorPageSchema } from './pagination.ts';

export const analysisSummaryFields = {
  issue_count: z.number().int().nullable(),
  web_fundamentals_score: z.number().nullable(),
  web_fundamentals_coverage: z.number().nullable(),
  web_fundamentals_state: z.enum(['measured', 'limited_evidence', 'not_measured', 'excluded']),
  aeo_readiness_score: z.number().nullable(),
  aeo_measurement_coverage: z.number().nullable(),
  aeo_measurement_state: z.enum(['measured', 'limited_evidence', 'not_measured', 'excluded']),
  aeo_measurement_reason: z.string(),
  web_fundamentals_checks: checksRunSchema.nullable(),
  aeo_readiness_checks: checksRunSchema.nullable(),
  main_content_indexable: z.boolean().nullable(),
  robots_excluded: z.boolean(),
  last_audited: z.string().nullable(),
  page_kind: pageKindSchema.nullable(),
};

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

export const monitoredQuotaSchema = responseObject({
  used: z.number().int(),
  limit: z.number().int(),
});

const monitoredUrlSchema = responseObject({
  site_url_id: uuid(),
  normalized_url: z.string(),
  display_url: z.string(),
  title: z.string().nullable(),
  active: z.boolean(),
  selection_source: z.enum(['free_sample', 'bootstrap']),
  selected_at: z.string().nullable(),
  deselected_at: z.string().nullable(),
});

export const monitoredUrlsResponseSchema = responseObject({
  project_id: uuid(),
  monitored_urls: z.array(monitoredUrlSchema),
  quota: monitoredQuotaSchema,
});

export type InventoryPage = z.infer<typeof inventoryPageSchema>;
export type SiteCrawlListPage = z.infer<typeof siteCrawlListPageSchema>;
export type MonitoredUrlsResponse = z.infer<typeof monitoredUrlsResponseSchema>;
