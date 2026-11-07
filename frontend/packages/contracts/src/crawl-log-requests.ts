/**
 * Request bodies of crawl-log collection: a new source and a file upload's
 * create, batch and complete steps. These own the wire shape; the API
 * `.extend`s them with its configured line, batch and backdate bounds and
 * applies the setup rules, and the browser types its arguments as `z.input`
 * of them.
 */
import { z } from 'zod';

import { crawlSourceSchema } from './ai-traffic.ts';

const crawlSamplingRequestSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('none') }),
  z.strictObject({ kind: z.literal('sampled'), rate: z.number().gt(0).max(1) }),
  z.strictObject({ kind: z.literal('filtered'), description: z.string().trim().min(1).max(512) }),
]);
/** `projects/<project id>/subscriptions/<subscription id>`, as Pub/Sub names them. */
const SUBSCRIPTION =
  /^projects\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/subscriptions\/[A-Za-z][\w.~%+-]{2,254}$/u;

/**
 * A new crawl log source. Firehose declares only its buffer interval and
 * filter, Google Cloud only its subscription and sample rate; the API
 * rejects any other combination.
 */
export const crawlSourceCreateRequestSchema = z.strictObject({
  setup: crawlSourceSchema.shape.setup,
  origin: z.url().max(512),
  format: z.enum(['ndjson', 'json_array', 'combined']).default('ndjson'),
  collection_point: z.enum(['cdn_edge', 'origin', 'application', 'uploaded_file']).optional(),
  sampling: crawlSamplingRequestSchema.optional(),
  /** Firehose buffer interval declared at setup; it widens the coverage gap bound. */
  buffer_interval_seconds: z.int().min(60).max(900).optional(),
  /** The stream runs CiteLadder's filter Lambda, so quiet periods send nothing. */
  declared_filtered: z.boolean().optional(),
  /** The Pub/Sub subscription a Google Cloud pull source drains. */
  subscription: z.string().max(255).regex(SUBSCRIPTION).optional(),
  /** The load balancer logging sample rate the customer configured. */
  declared_sample_rate: z.number().min(0.001).max(1).multipleOf(0.001).optional(),
});
export type CrawlSourceCreateRequest = z.input<typeof crawlSourceCreateRequestSchema>;

/** A new upload of one local log file to an upload source. */
export const crawlUploadCreateRequestSchema = z.strictObject({
  filename: z.string().trim().min(1).max(255),
  size_bytes: z.int().nonnegative(),
});
export type CrawlUploadCreateRequest = z.input<typeof crawlUploadCreateRequestSchema>;

/** One ordered batch of an upload's pre-filtered log lines; `seq` makes a retry idempotent. */
export const crawlUploadBatchRequestSchema = z.strictObject({
  seq: z.int().nonnegative(),
  lines: z.array(z.string()),
});
export type CrawlUploadBatchRequest = z.input<typeof crawlUploadBatchRequestSchema>;

/** What the browser scanned of the whole file; full-day scans are client-reported coverage. */
export const crawlUploadCompleteRequestSchema = z.strictObject({
  scanned_lines: z.int().nonnegative(),
  first_line_at: z.iso.datetime({ offset: true }).nullable(),
  last_line_at: z.iso.datetime({ offset: true }).nullable(),
  scanned_dates: z.array(z.iso.date()),
});
export type CrawlUploadCompleteRequest = z.input<typeof crawlUploadCompleteRequestSchema>;
