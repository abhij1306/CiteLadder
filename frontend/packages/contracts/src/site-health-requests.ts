import { z } from 'zod';
import { crawlRobotsHandlingSchema, crawlScheduleCadenceSchema } from './site-health/crawl.ts';

export const siteCrawlCreateRequestSchema = z.strictObject({
  project_id: z.uuid(),
  robots: crawlRobotsHandlingSchema.nullable().optional(),
});
export type SiteCrawlCreateRequest = z.input<typeof siteCrawlCreateRequestSchema>;

export const crawlScheduleUpdateRequestSchema = z.strictObject({
  enabled: z.boolean(),
  cadence: crawlScheduleCadenceSchema,
});
export type CrawlScheduleUpdateRequest = z.input<typeof crawlScheduleUpdateRequestSchema>;
