import { z } from 'zod';

import { crawlSourceSchema } from './ai-traffic.ts';

const crawlSamplingRequestSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('none') }),
  z.strictObject({ kind: z.literal('sampled'), rate: z.number().gt(0).max(1) }),
  z.strictObject({ kind: z.literal('filtered'), description: z.string().trim().min(1).max(512) }),
]);
const SUBSCRIPTION =
  /^projects\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/subscriptions\/[A-Za-z][\w.~%+-]{2,254}$/u;

export const crawlSourceCreateRequestSchema = z.strictObject({
  setup: crawlSourceSchema.shape.setup,
  origin: z.url().max(512),
  format: z.enum(['ndjson', 'json_array', 'combined']).default('ndjson'),
  collection_point: z.enum(['cdn_edge', 'origin', 'application', 'uploaded_file']).optional(),
  sampling: crawlSamplingRequestSchema.optional(),
  buffer_interval_seconds: z.int().min(60).max(900).optional(),
  declared_filtered: z.boolean().optional(),
  subscription: z.string().max(255).regex(SUBSCRIPTION).optional(),
  declared_sample_rate: z.number().min(0.001).max(1).multipleOf(0.001).optional(),
});
export type CrawlSourceCreateRequest = z.input<typeof crawlSourceCreateRequestSchema>;

export const crawlUploadCreateRequestSchema = z.strictObject({
  filename: z.string().trim().min(1).max(255),
  size_bytes: z.int().nonnegative(),
});
export type CrawlUploadCreateRequest = z.input<typeof crawlUploadCreateRequestSchema>;

export const crawlUploadBatchRequestSchema = z.strictObject({
  seq: z.int().nonnegative(),
  lines: z.array(z.string()),
});
export type CrawlUploadBatchRequest = z.input<typeof crawlUploadBatchRequestSchema>;

export const crawlUploadCompleteRequestSchema = z.strictObject({
  scanned_lines: z.int().nonnegative(),
  first_line_at: z.iso.datetime({ offset: true }).nullable(),
  last_line_at: z.iso.datetime({ offset: true }).nullable(),
  scanned_dates: z.array(z.iso.date()),
});
export type CrawlUploadCompleteRequest = z.input<typeof crawlUploadCompleteRequestSchema>;
