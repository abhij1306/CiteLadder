import { z } from 'zod';
import { aiSourceSchema } from '@citeladder/contracts/ai-traffic';
export { matchesCrawlerUserAgent } from '@citeladder/contracts/ai-traffic';
import {
  crawlerPurposeSchema,
  crawlerResourceClassSchema,
  crawlerCheckSchema,
} from '@citeladder/contracts/site-health';
import catalog from './crawlers.json' with { type: 'json' };
import { ConfigError } from './config-error.ts';

const nonempty = z.string().trim().min(1);
const schema = z.strictObject({
  catalog_version: nonempty,
  resource_rules: z.array(
    z.strictObject({
      resource_class: crawlerResourceClassSchema,
      paths: z.array(nonempty),
      extensions: z.array(nonempty),
    }),
  ),
  bots: z
    .array(
      z.strictObject({
        bot_id: nonempty,
        label: nonempty,
        operator: nonempty,
        purpose: crawlerPurposeSchema,
        ai_source: aiSourceSchema.nullable(),
        robots_tokens: z.array(nonempty).min(1),
        ua_patterns: z.array(nonempty),
        checks: z.array(crawlerCheckSchema),
        verification: z.discriminatedUnion('method', [
          z.strictObject({ method: z.literal('none') }),
          z.strictObject({
            method: z.literal('ip_ranges'),
            source_url: z.url().startsWith('https://'),
          }),
        ]),
      }),
    )
    .min(1),
});
export function loadCrawlerCatalog(value: unknown) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ConfigError(`Invalid crawler catalog: ${parsed.error.message}`);
  const result = parsed.data;
  const ids = new Set<string>();
  for (const bot of result.bots) {
    if (ids.has(bot.bot_id)) throw new ConfigError(`Duplicate crawler bot_id: ${bot.bot_id}`);
    ids.add(bot.bot_id);
  }
  return result;
}
export const crawlers = loadCrawlerCatalog(catalog);
export type CrawlerBot = (typeof crawlers.bots)[number];
