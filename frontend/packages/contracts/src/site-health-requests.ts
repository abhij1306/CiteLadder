/**
 * Request bodies of Site Health crawl control: a new crawl, a URL preview and
 * the monitored-URL set. These own the wire shape; the API `.extend`s them
 * with its configured bounds, and the browser types its arguments as
 * `z.input` of them.
 */
import { z } from 'zod';

const optionalList = () => z.array(z.string()).nullable().optional();

/** A new crawl of the project's website; absent controls take the configured defaults. */
export const siteCrawlCreateRequestSchema = z.strictObject({
  project_id: z.uuid(),
  include_globs: optionalList(),
  exclude_globs: optionalList(),
  /** Optional deterministic 64-bit seed as a decimal string. */
  seed: z.string().nullable().optional(),
  input_mode: z.enum(['auto', 'exact_urls', 'discovery_seeds']).nullable().optional(),
  requested_page_limit: z.int().min(1).nullable().optional(),
  discovery_count: z.int().min(1).nullable().optional(),
  seed_urls: optionalList(),
  page_kinds: optionalList(),
});
export type SiteCrawlCreateRequest = z.input<typeof siteCrawlCreateRequestSchema>;

/** Pasted or uploaded URLs to classify against the project's crawl scope; nothing is stored. */
export const urlPreviewRequestSchema = z.strictObject({
  project_id: z.uuid(),
  content: z.union([z.string(), z.array(z.string()), z.record(z.string(), z.unknown())]),
  input_format: z.enum(['text', 'csv', 'json']).default('text'),
  include_globs: optionalList(),
  exclude_globs: optionalList(),
});
export type UrlPreviewRequest = z.input<typeof urlPreviewRequestSchema>;

/** The project's whole monitored-URL set, against the selection version the editor read. */
export const monitoredUrlsReplaceRequestSchema = z.strictObject({
  site_url_ids: z.array(z.uuid()),
  expected_selection_version: z.int(),
});

/** A bulk monitored-URL selection from one crawl's inventory. */
export const monitoredUrlsBulkSelectRequestSchema = z.strictObject({
  crawl_id: z.uuid(),
  mode: z.enum(['first_n', 'all', 'none']),
  count: z.int().nullable().optional(),
  query: z.string().nullable().optional(),
  expected_selection_version: z.int(),
});
