/** HTTP delivery, automated-consumer access and Web Fundamentals checks over persisted facts. */
import { policy } from '../../config.ts';
import { analysisPolicy } from './policy.ts';
import { count, list, record, records, text, textList, type Facts } from './read-facts.ts';
import type { CheckResult } from './indexing.ts';

const r = analysisPolicy.rules;
const SERVER_RENDERED_MIN_WORDS = analysisPolicy.facts.server_rendered_min_words;
const SOFT_ERROR_PHRASES = ['page not found', '404 not found', 'does not exist'];
export const passFail = (condition: boolean) => (condition ? 'satisfied' : 'missing');

/** Whether the page is a JavaScript shell, with the evidence that decided it. */
export function serverRenderSignals(facts: Facts): [boolean, Record<string, unknown>] {
  const body = record(facts.body);
  const words = count(body.word_count);
  const chars = text(body.text).length;
  const scripts = count(facts.inline_script_chars);
  return [
    words < SERVER_RENDERED_MIN_WORDS && scripts > chars,
    {
      word_count: words,
      minimum_words: SERVER_RENDERED_MIN_WORDS,
      body_text_chars: chars,
      inline_script_chars: scripts,
    },
  ];
}

const delivery = (facts: Facts) => record(facts.delivery);
const siteRobots = (facts: Facts) => record(record(facts.site).robots);

const crawlerAccess =
  (check: 'ai_crawler_access' | 'search_crawler_access') =>
  (facts: Facts): CheckResult => {
    const robots = siteRobots(facts);
    const bots = policy.crawlers.bots.filter((bot) => bot.checks.includes(check));
    const botFacts = new Map(records(robots.bots).map((bot) => [text(bot.bot_id), bot]));
    const stance = new Map([...botFacts].map(([id, bot]) => [id, bot.root_access]));
    // The root may be open while every sampled content URL is closed: that bot sees no pages.
    const sampled = (id: string) => text(botFacts.get(id)?.policy);
    const bounded = Object.fromEntries(
      bots.map((bot) => [bot.bot_id, stance.get(bot.bot_id) ?? 'unknown']),
    );
    const evidence = {
      robots_fetched: Boolean(robots.fetched),
      root_access: bounded,
      catalog_version: robots.catalog_version,
      robots_snapshot_id: robots.robots_snapshot_id,
    };
    if (!robots.fetched) return ['not_applicable', { ...evidence, reason: 'robots_not_fetched' }];
    const blocked = bots
      .filter(
        (bot) =>
          stance.get(bot.bot_id) === 'disallowed' || sampled(bot.bot_id) === 'all_disallowed',
      )
      .map((bot) => bot.label);
    // Closing some paths (an admin area) is ordinary; it is evidence, not a failure.
    const restricted = bots
      .filter((bot) => sampled(bot.bot_id) === 'restricted')
      .map((bot) => bot.label);
    const detail = { ...evidence, blocked, restricted, checked: bots.map((bot) => bot.label) };
    // A fetched but unreadable robots.txt proves nothing: no block observed is not a pass.
    if (!blocked.length && bots.some((bot) => stance.get(bot.bot_id) !== 'allowed'))
      return ['unknown', { ...detail, reason: 'robots_unreadable' }];
    return [passFail(!blocked.length), detail];
  };

function robotsTxtPresent(facts: Facts): CheckResult {
  const robots = siteRobots(facts);
  const evidence = {
    status: robots.status,
    status_code: robots.status_code,
    url: text(robots.url).slice(0, 2048),
  };
  if (robots.fetched) return ['satisfied', evidence];
  if (robots.status === policy.site_health.crawl.robots_statuses.not_found)
    return ['missing', evidence];
  // An unreadable file is not evidence of absence.
  return ['not_applicable', { ...evidence, reason: 'robots_not_fetched' }];
}

function snippetAccess(facts: Facts): CheckResult {
  const robots = record(facts.robots);
  const nosnippet = Boolean(robots.nosnippet);
  return [
    passFail(!(nosnippet || robots.max_snippet === 0)),
    {
      nosnippet,
      max_snippet: robots.max_snippet ?? null,
      directives: list(robots.directives).slice(0, 32),
    },
  ];
}

function softErrorPhrase(value: string, phrase: string) {
  const normalized = value.trim().toLowerCase().replaceAll(/\s+/gu, ' ');
  return (
    normalized === phrase ||
    [`error: ${phrase}`, `404: ${phrase}`, `${phrase} |`, `${phrase} -`, `${phrase} —`].some(
      (prefix) => normalized.startsWith(prefix),
    )
  );
}

function softError(facts: Facts): CheckResult {
  const status = delivery(facts).status_code ?? null;
  const values = [text(facts.title), ...textList(record(facts.headings).h1_texts)].filter(Boolean);
  const matched =
    SOFT_ERROR_PHRASES.find((phrase) => values.some((value) => softErrorPhrase(value, phrase))) ??
    '';
  return [
    passFail(!(status === 200 && matched)),
    { status_code: status, matched_error_phrase: matched },
  ];
}

const deliveryChecks: Record<string, (facts: Facts) => CheckResult> = {
  'technical.https': (facts) => {
    const d = delivery(facts);
    return [
      passFail(Boolean(d.is_https)),
      { scheme: d.scheme ?? '', final_url: d.final_url ?? '', is_https: Boolean(d.is_https) },
    ];
  },
  'technical.hsts_present': (facts) => {
    const present = Boolean(record(delivery(facts).security_headers)['strict-transport-security']);
    return [passFail(present), { present, scheme: delivery(facts).scheme ?? '' }];
  },
  'technical.ttfb_band': (facts) => {
    const ttfb = delivery(facts).ttfb_ms;
    if (ttfb === null || ttfb === undefined)
      return ['not_applicable', { reason: 'no_ttfb_measurement' }];
    const ms = count(ttfb);
    return [passFail(ms <= r.ttfb_warn_ms), { ttfb_ms: ms, threshold_ms: r.ttfb_warn_ms }];
  },
  'technical.uncompressed_html': (facts) => {
    const d = delivery(facts);
    return [
      passFail(Boolean(d.is_compressed)),
      { content_encoding: d.content_encoding ?? '', is_compressed: Boolean(d.is_compressed) },
    ];
  },
  'technical.ai_crawler_access': crawlerAccess('ai_crawler_access'),
  'technical.robots_txt_present': robotsTxtPresent,
  'search.crawler_access': crawlerAccess('search_crawler_access'),
  'search.snippet_access': snippetAccess,
  'aeo.llms_txt_present': (facts) => {
    const llms = record(record(facts.site).llms_txt);
    const present = Boolean(llms.present);
    const evidence = {
      fetched: Boolean(llms.fetched),
      present,
      url: text(llms.url).slice(0, 2048),
    };
    // A crawl that never requested llms.txt (a sample) has not observed its absence.
    if (!evidence.fetched)
      return ['not_applicable', { ...evidence, reason: 'insufficient_evidence' }];
    return [passFail(present), evidence];
  },
  'technical.soft_error': softError,
  'aeo.server_rendered_content': (facts) => {
    const [shell, evidence] = serverRenderSignals(facts);
    return [passFail(!shell), evidence];
  },
};

function headingOrder(facts: Facts): CheckResult {
  const accessibility = record(facts.accessibility);
  const levels = list(accessibility.heading_levels).map(count);
  const skipped = count(accessibility.heading_level_skips);
  return [
    passFail(skipped === 0),
    {
      heading_levels: levels.slice(0, 64),
      level_skips: skipped,
      skips: levels
        .slice(1)
        .flatMap((level, index) =>
          level > levels[index]! + 1
            ? [{ from: levels[index], to: level, scope: 'full_document' }]
            : [],
        )
        .slice(0, 64),
    },
  ];
}

function mixedContent(facts: Facts): CheckResult {
  const links = record(facts.links);
  const https = Boolean(delivery(facts).is_https);
  const insecure = ['images', 'scripts', 'stylesheets']
    .flatMap((group) => records(links[group]))
    .map((asset) => text(asset.url))
    .filter((url) => https && url.toLowerCase().startsWith('http://'))
    .map((url) => url.slice(0, 512));
  return [
    passFail(!insecure.length),
    { absolute_http_asset_count: insecure.length, assets: insecure.slice(0, 20) },
  ];
}

const webFundamentalsChecks: Record<string, (facts: Facts) => CheckResult> = {
  'web.accessibility_image_alt': (facts) => {
    const images = record(facts.images);
    const missing = count(images.missing_alt);
    return [
      passFail(missing === 0),
      {
        image_count: count(images.count),
        missing_alt: missing,
        decorative_alt: count(images.decorative_alt),
      },
    ];
  },
  'web.accessibility_form_names': (facts) => {
    const accessibility = record(facts.accessibility);
    const missing = count(accessibility.controls_missing_accessible_name);
    return [
      passFail(missing === 0),
      {
        control_count: count(accessibility.control_count),
        missing_accessible_name: missing,
        missing_control_descriptors: list(
          accessibility.controls_missing_accessible_name_descriptors,
        ).slice(0, 20),
      },
    ];
  },
  'web.accessibility_heading_order': headingOrder,
  'web.accessibility_document_language': (facts) => {
    const language = text(record(facts.accessibility).document_language);
    return [passFail(Boolean(language)), { document_language: language }];
  },
  'web.mobile_viewport': (facts) => {
    const viewport = record(record(facts.mobile).viewport);
    const declared = Boolean(viewport.declared);
    return [passFail(declared), { declared, content: text(viewport.content).slice(0, 512) }];
  },
  'web.security_mixed_content': mixedContent,
};

export const DELIVERY_CHECKS = { ...deliveryChecks, ...webFundamentalsChecks };
