import { expect, it } from 'vitest';
import catalog from '../src/config/crawlers.json' with { type: 'json' };
import { loadCrawlerCatalog, matchesCrawlerUserAgent } from '../src/config/crawlers.ts';
import { crawlerRootFacts, crawlerSamplePolicy } from '../src/site-health/crawler-policy.ts';
import { robotsPolicy } from '../src/web-evidence/acquisition.ts';
import { DELIVERY_CHECKS } from '../src/site-health/analysis/delivery-checks.ts';

const origin = 'https://example.test';
const bot = loadCrawlerCatalog(catalog).bots.find((value) => value.label === 'GPTBot')!;
function facts(status: number, body: string, urls: string[]) {
  const robots = robotsPolicy(origin, status, body);
  const [root] = crawlerRootFacts(robots, origin, [bot]);
  return { ...root, ...crawlerSamplePolicy(robots, bot.robots_tokens, urls) };
}
it.each([
  [
    'allow exception',
    'User-agent: GPTBot\nDisallow: /\nAllow: /products/',
    'specific_group',
    'disallowed',
    'restricted',
    1,
  ],
  [
    'repeated groups',
    'User-agent: GPTBot\nDisallow: /$\nUser-agent: GPTBot\nDisallow: /products/',
    'specific_group',
    'disallowed',
    'all_disallowed',
    2,
  ],
  [
    'wildcard fallback',
    'User-agent: *\nDisallow: /products/',
    'wildcard_group',
    'allowed',
    'restricted',
    1,
  ],
  [
    'root only',
    'User-agent: GPTBot\nDisallow: /$',
    'specific_group',
    'disallowed',
    'restricted',
    1,
  ],
  [
    'fully overridden',
    'User-agent: GPTBot\nDisallow: /\nAllow: /',
    'specific_group',
    'allowed',
    'all_allowed',
    0,
  ],
  ['not specified', '', 'no_rules', 'allowed', 'all_allowed', 0],
])(
  'evaluates %s with the acquisition parser',
  (_name, body, matched, rootAccess, summary, denied) => {
    expect(facts(200, body, [`${origin}/`, `${origin}/products/widget`])).toMatchObject({
      matched,
      root_access: rootAccess,
      policy: summary,
      evaluated_url_count: 2,
      disallowed_url_count: denied,
    });
  },
);
it.each([0, 301, 401, 403, 429, 503])('keeps unreadable robots %s unknown', (status) => {
  expect(facts(status, '', [`${origin}/`])).toMatchObject({
    root_access: 'unknown',
    policy: 'unknown',
    evaluated_url_count: 0,
    disallowed_url_count: 0,
  });
});
it('rejects a catalog with a duplicate bot_id', () => {
  const value = structuredClone(catalog);
  value.bots.push({ ...value.bots[0]! });
  expect(() => loadCrawlerCatalog(value)).toThrow(/Duplicate crawler bot_id/);
});
it('never identifies requests through robots-only tokens', () => {
  const bots = loadCrawlerCatalog(catalog).bots;
  for (const token of ['Google-Extended', 'Applebot-Extended']) {
    expect(bots.filter((value) => matchesCrawlerUserAgent(value, `${token}/1.0`))).toEqual([]);
  }
  expect(matchesCrawlerUserAgent(bot, 'Mozilla/5.0 (compatible; GPTBOT/1.4)')).toBe(true);
});
it('retains the root-access decision for training and search checks', () => {
  const bots = crawlerRootFacts(
    robotsPolicy(origin, 200, 'User-agent: GPTBot\nDisallow: /\nAllow: /products/'),
    origin,
  );
  const robots = {
    fetched: true,
    bots,
    catalog_version: '1',
    robots_snapshot_id: 'capture-source',
  };
  const facts = { site: { robots } };
  expect(DELIVERY_CHECKS['technical.ai_crawler_access']!(facts)).toMatchObject([
    'missing',
    {
      blocked: ['GPTBot'],
      root_access: { [bot.bot_id]: 'disallowed' },
      robots_snapshot_id: robots.robots_snapshot_id,
      catalog_version: robots.catalog_version,
    },
  ]);
  expect(DELIVERY_CHECKS['search.crawler_access']!(facts)[0]).toBe('satisfied');
});
it('fails answer-crawler access when every sampled page is closed, not when only some are', () => {
  const searchFacts = (body: string, urls: string[]) => {
    const parsed = robotsPolicy(origin, 200, body);
    const bots = crawlerRootFacts(parsed, origin).map((fact) => ({
      ...fact,
      ...crawlerSamplePolicy(
        parsed,
        loadCrawlerCatalog(catalog).bots.find((entry) => entry.bot_id === fact.bot_id)!
          .robots_tokens,
        urls,
      ),
    }));
    return DELIVERY_CHECKS['search.crawler_access']!({ site: { robots: { fetched: true, bots } } });
  };
  const closed = 'User-agent: OAI-SearchBot\nDisallow: /blog/';
  const pages = [`${origin}/blog/a`, `${origin}/blog/b`];
  // The root is open, but the bot can reach none of the content pages.
  expect(searchFacts(closed, pages)).toMatchObject(['missing', { blocked: ['OAI-SearchBot'] }]);
  expect(searchFacts(closed, [...pages, `${origin}/pricing`])).toMatchObject([
    'satisfied',
    { blocked: [], restricted: ['OAI-SearchBot'] },
  ]);
});
it('judges Apple’s search crawler in both checks and its training token in the AI check', () => {
  const access = (body: string) => {
    const robots = {
      fetched: true,
      bots: crawlerRootFacts(robotsPolicy(origin, 200, body), origin),
    };
    return [
      DELIVERY_CHECKS['search.crawler_access']!({ site: { robots } }),
      DELIVERY_CHECKS['technical.ai_crawler_access']!({ site: { robots } }),
    ].map(([outcome, evidence]) => [outcome, evidence.blocked]);
  };
  expect(access('User-agent: Applebot\nDisallow: /')).toEqual([
    ['missing', ['Applebot']],
    ['missing', ['Applebot']],
  ]);
  // Opting out of Apple's model training does not hide the site from Apple search.
  expect(access('User-agent: Applebot-Extended\nDisallow: /')).toEqual([
    ['satisfied', []],
    ['missing', ['Applebot-Extended']],
  ]);
});
it('keeps crawler access unknown when robots.txt was fetched but could not be read', () => {
  const bots = crawlerRootFacts(robotsPolicy(origin, 503, ''), origin);
  expect(
    DELIVERY_CHECKS['search.crawler_access']!({ site: { robots: { fetched: true, bots } } }),
  ).toMatchObject(['unknown', { reason: 'robots_unreadable' }]);
});
