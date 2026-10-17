/** The catalog's robots projection for Site Health, evaluated by the acquisition parser. */
import type { z } from 'zod';
import type { crawlerBotFactSchema } from '@citeladder/contracts/site-health';
import { policy } from '../config.ts';
import type { CrawlerBot } from '../config/crawlers.ts';
import type { RobotsPolicy } from '../web-evidence/acquisition.ts';

type BotFact = z.infer<typeof crawlerBotFactSchema>;
type SamplePolicy = Pick<BotFact, 'policy' | 'evaluated_url_count' | 'disallowed_url_count'>;

const unknownSample: SamplePolicy = {
  policy: 'unknown',
  evaluated_url_count: 0,
  disallowed_url_count: 0,
};

const allowed = (robots: RobotsPolicy, tokens: readonly string[], url: string) =>
  tokens.every((token) => robots.allows(url, token));

/** Root permission and group match, published from the full response before the walk. */
export function crawlerRootFacts(
  robots: RobotsPolicy,
  origin: string,
  bots: readonly CrawlerBot[] = policy.crawlers.bots,
): BotFact[] {
  return bots.map((bot) => {
    let rootAccess: BotFact['root_access'] = 'unknown';
    if (robots.readable)
      rootAccess = allowed(robots, bot.robots_tokens, `${origin}/`) ? 'allowed' : 'disallowed';
    return {
      bot_id: bot.bot_id,
      label: bot.label,
      operator: bot.operator,
      purpose: bot.purpose,
      matched: robots.matched(bot.robots_tokens),
      root_access: rootAccess,
      ...unknownSample,
    };
  });
}

/** Permission over a bounded set of known URLs; a truncated body cannot be judged. */
export function crawlerSamplePolicy(
  robots: RobotsPolicy,
  tokens: readonly string[],
  urls: readonly string[],
  truncated = false,
): SamplePolicy {
  if (!robots.readable || truncated || urls.length === 0) return unknownSample;
  const disallowed = urls.filter((url) => !allowed(robots, tokens, url)).length;
  let summary: BotFact['policy'] = 'all_allowed';
  if (disallowed > 0) summary = disallowed === urls.length ? 'all_disallowed' : 'restricted';
  return { policy: summary, evaluated_url_count: urls.length, disallowed_url_count: disallowed };
}
