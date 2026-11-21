import { z } from 'zod';
import { crawlRobotsHandlingSchema, crawlScheduleCadenceSchema } from './site-health/crawl.ts';

export const siteCrawlCreateRequestSchema = z.strictObject({
  project_id: z.uuid(),
  /**
   * `ignore` fetches the project's own pages despite robots.txt exclusions;
   * sending it confirms the person is authorized to crawl this site. Absent
   * keeps the project's newest site crawl's choice (`respect` before any).
   */
  robots: crawlRobotsHandlingSchema.nullable().optional(),
});
export type SiteCrawlCreateRequest = z.input<typeof siteCrawlCreateRequestSchema>;

export const crawlScheduleUpdateRequestSchema = z.strictObject({
  enabled: z.boolean(),
  cadence: crawlScheduleCadenceSchema,
});
export type CrawlScheduleUpdateRequest = z.input<typeof crawlScheduleUpdateRequestSchema>;
