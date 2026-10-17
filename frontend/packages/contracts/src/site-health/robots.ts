import { z } from 'zod';
import { responseObject } from './core.ts';

export const crawlerPurposeSchema = z.enum([
  'ai_training',
  'ai_search',
  'ai_user_fetch',
  'search_engine',
  'other',
]);
export const crawlerResourceClassSchema = z.enum([
  'page',
  'document',
  'asset',
  'robots',
  'sitemap',
  'llms_txt',
  'feed',
  'other',
]);
export const crawlerCheckSchema = z.enum(['ai_crawler_access', 'search_crawler_access']);
const crawlerPolicySchema = z.enum(['all_allowed', 'restricted', 'all_disallowed', 'unknown']);
export const crawlerBotFactSchema = responseObject({
  bot_id: z.string(),
  label: z.string(),
  operator: z.string(),
  purpose: crawlerPurposeSchema,
  matched: z.enum(['specific_group', 'wildcard_group', 'no_rules']),
  root_access: z.enum(['allowed', 'disallowed', 'unknown']),
  policy: crawlerPolicySchema,
  evaluated_url_count: z.number().int().nonnegative(),
  disallowed_url_count: z.number().int().nonnegative(),
});
export const robotsFactsSchema = responseObject({
  observed_at: z.string(),
  catalog_version: z.string(),
  robots_snapshot_id: z.uuid().nullable(),
  bots: z.array(crawlerBotFactSchema),
  fetched: z.boolean(),
  status: z.enum(['fetched', 'not_found', 'fetch_failed', 'access_blocked']),
  status_code: z.number().int().nullable(),
  url: z.string(),
  sitemaps: z.array(z.string()),
});
export const robotsHistoryPageSchema = responseObject({
  items: z.array(
    responseObject({
      crawl_id: z.uuid(),
      robots: robotsFactsSchema,
    }),
  ),
  snapshots: z.array(
    responseObject({
      id: z.uuid(),
      origin: z.string(),
      content_hash: z.string(),
      body: z.string(),
      truncated: z.boolean(),
      status_code: z.number().int().nullable(),
    }),
  ),
  next_cursor: z.string().nullable(),
});
