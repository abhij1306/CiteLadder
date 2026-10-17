/** `noindex` judged against strong evidence of indexing intent; uncertainty stays unknown. */
import { policy } from '../../config.ts';
import { stripTrailing } from '../../text-order.ts';
import { canonicalUrl } from '../url-identity.ts';
import { record, text, type Facts } from './read-facts.ts';

const TRACKING = new Set(policy.site_health.tracking_params);
const SERVER_RENDERED_MIN_WORDS = policy.site_health.page_analysis.facts.server_rendered_min_words;
export type CheckResult = [outcome: string, evidence: Record<string, unknown>];

/** A declared canonical resolved against the page URL; an unresolvable one stays as declared. */
export function resolveCanonical(canonical: string, finalUrl: string) {
  const raw = canonical.trim();
  if (!raw) return '';
  try {
    return new URL(raw, finalUrl).href;
  } catch {
    return raw;
  }
}

function webUrl(value: string) {
  try {
    const url = new URL(value.trim());
    return ['http:', 'https:'].includes(url.protocol) && url.hostname ? url : null;
  } catch {
    return null;
  }
}

/** Scheme, host and non-default port, or '' when the URL is not an absolute web URL. */
function canonicalOrigin(value: string) {
  return webUrl(value)?.origin ?? '';
}

/** The comparison form: lower-cased origin, trailing slashes trimmed, tracking parameters dropped. */
export function comparableUrl(value: string) {
  const raw = value.trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw.toLowerCase();
  }
  if (!url.hostname) return raw.toLowerCase();
  const path = stripTrailing(url.pathname, '/') || '/';
  const query = new URLSearchParams(
    [...url.searchParams].filter(([key]) => !TRACKING.has(key.toLowerCase())),
  ).toString();
  const search = query ? `?${query}` : '';
  return `${url.protocol}//${url.host.toLowerCase()}${path}${search}`;
}

function canonicalIntent(facts: Facts, evidence: Record<string, unknown>) {
  const declared = text(facts.canonical_url).trim();
  if (!declared) return null;
  const finalUrl = text(record(facts.delivery).final_url);
  const canonical = resolveCanonical(declared, finalUrl);
  evidence.canonical_url = canonical.slice(0, 2048);
  if (!canonicalOrigin(canonical)) {
    // An unparseable canonical is no evidence of intent in either direction.
    evidence.canonical_unparseable = true;
    return null;
  }
  const same = comparableUrl(canonical) === comparableUrl(finalUrl);
  evidence.canonical_matches_final_url = same;
  if (same) return ['intended_index', 'self_canonical'] as const;
  evidence.canonical_intent_ambiguous = true;
  return null;
}

function resolveIntent(facts: Facts, evidence: Record<string, unknown>) {
  const explicit = text(facts.indexing_policy).trim().toLowerCase();
  if (explicit === 'index') return ['intended_index', 'explicit_user_policy'] as const;
  if (explicit === 'exclude') return ['intended_exclude', 'explicit_user_policy'] as const;
  const canonical = canonicalIntent(facts, evidence);
  if (canonical) return canonical;
  if (facts.sitemap_member === true) return ['intended_index', 'sitemap_membership'] as const;
  return ['unknown', 'insufficient_evidence'] as const;
}

/**
 * A sitemap lists the URLs a site wants indexed; listing a page that names
 * another canonical is a mixed signal. A listed URL that redirects is
 * `technical.sitemap_redirect`'s finding, so this judges the page it reached.
 */
export function checkSitemapCanonical(facts: Facts): CheckResult {
  if (facts.sitemap_member !== true) return ['not_applicable', { reason: 'not_in_sitemap' }];
  const declared = text(facts.canonical_url).trim();
  if (!declared) return ['not_applicable', { reason: 'no_canonical' }];
  const finalUrl = text(record(facts.delivery).final_url);
  const listedUrl = text(facts.sitemap_url).trim() || finalUrl;
  const canonical = resolveCanonical(declared, finalUrl);
  const evidence = {
    canonical_url: canonical.slice(0, 2048),
    listed_url: listedUrl.slice(0, 2048),
    final_url: finalUrl.slice(0, 2048),
  };
  if (!canonicalOrigin(canonical))
    return ['unknown', { ...evidence, reason: 'insufficient_evidence' }];
  return comparableUrl(canonical) === comparableUrl(finalUrl)
    ? ['satisfied', evidence]
    : ['missing', { ...evidence, reason: 'sitemap_lists_non_canonical' }];
}

/** The sitemap should list the URL a crawler lands on, not one that redirects to it. */
export function checkSitemapRedirect(facts: Facts): CheckResult {
  if (facts.sitemap_member !== true) return ['not_applicable', { reason: 'not_in_sitemap' }];
  const finalUrl = text(record(facts.delivery).final_url);
  const listedUrl = text(facts.sitemap_url).trim();
  const evidence = { listed_url: listedUrl.slice(0, 2048), final_url: finalUrl.slice(0, 2048) };
  // Both sides in crawl identity form, so query order or tracking keys are not a redirect.
  const listed = canonicalUrl(listedUrl);
  const reached = canonicalUrl(finalUrl);
  if (!listed || !reached) return ['unknown', { ...evidence, reason: 'insufficient_evidence' }];
  return listed === reached
    ? ['satisfied', evidence]
    : ['missing', { ...evidence, reason: 'sitemap_lists_redirect' }];
}

const DAY_MS = 86_400_000;
const LASTMOD_TOLERANCE_MS =
  policy.site_health.page_analysis.rules.sitemap_lastmod_tolerance_days * DAY_MS;

/**
 * A sitemap `<lastmod>` is a recrawl hint search engines trust only while it is
 * accurate: it must parse, must not be in the future, and must not predate the
 * page's own declared publication or modification date.
 */
export function checkSitemapLastmod(facts: Facts): CheckResult {
  if (facts.sitemap_member !== true) return ['not_applicable', { reason: 'not_in_sitemap' }];
  const lastmod = text(facts.sitemap_lastmod).trim();
  if (!lastmod) return ['not_applicable', { reason: 'no_sitemap_lastmod' }];
  const dates = record(facts.dates);
  const pageDates = [text(dates.published), text(dates.modified)].filter((value) => value.trim());
  const evidence: Record<string, unknown> = {
    sitemap_lastmod: lastmod,
    page_dates: pageDates,
    tolerance_days: policy.site_health.page_analysis.rules.sitemap_lastmod_tolerance_days,
  };
  const declared = Date.parse(lastmod);
  if (Number.isNaN(declared))
    return ['missing', { ...evidence, reason: 'sitemap_lastmod_unparseable' }];
  const audit = typeof facts.audit_time === 'string' ? Date.parse(facts.audit_time) : Number.NaN;
  if (Number.isNaN(audit)) return ['unknown', { ...evidence, reason: 'audit_time_unavailable' }];
  if (declared > audit + LASTMOD_TOLERANCE_MS)
    return ['missing', { ...evidence, reason: 'sitemap_lastmod_in_future' }];
  const parsed = pageDates.map((value) => Date.parse(value)).filter((time) => !Number.isNaN(time));
  // Without a readable page date there is nothing to hold the lastmod against.
  if (!parsed.length) return ['unknown', { ...evidence, reason: 'page_date_unavailable' }];
  const newest = Math.max(...parsed);
  // A page date in the future is the content-date checks' finding, not a stale lastmod.
  if (newest > audit + LASTMOD_TOLERANCE_MS)
    return ['unknown', { ...evidence, reason: 'content_date_in_future' }];
  return newest > declared + LASTMOD_TOLERANCE_MS
    ? ['missing', { ...evidence, reason: 'sitemap_lastmod_stale' }]
    : ['satisfied', evidence];
}

/**
 * Crawlers that do not run script never follow a script redirect, and a meta
 * refresh hides the destination behind a page that is not the content. Script
 * navigation is only a redirect when the page shows almost nothing else.
 */
export function checkClientSideRedirect(facts: Facts): CheckResult {
  if (!facts.has_html) return ['not_applicable', { reason: 'no_html' }];
  const redirect = record(facts.client_redirect);
  const target = text(redirect.meta_refresh_url);
  if (target)
    return [
      'missing',
      {
        reason: 'meta_refresh_redirect',
        target_url: target,
        delay_seconds: redirect.meta_refresh_seconds,
      },
    ];
  const words = Number(record(facts.body).word_count) || 0;
  if (redirect.script_navigates === true && words < SERVER_RENDERED_MIN_WORDS)
    return ['missing', { reason: 'script_redirect', word_count: words }];
  return ['satisfied', { word_count: words }];
}

export function checkIndexable(facts: Facts): CheckResult {
  const robots = record(facts.robots);
  const noindex = Boolean(robots.noindex);
  const evidence: Record<string, unknown> = { noindex, nofollow: Boolean(robots.nofollow) };
  if (!noindex) return ['satisfied', evidence];
  const [intent, source] = resolveIntent(facts, evidence);
  evidence.indexing_intent = intent;
  evidence.intent_source = source;
  if (intent === 'intended_exclude') {
    evidence.reason = 'intentional_non_indexing';
    return ['not_applicable', evidence];
  }
  return ['missing', evidence];
}
