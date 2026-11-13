/**
 * Site Health page acquisition: robots and durable suppression at every hop,
 * the crawler's hard URL exclusions on every redirect, per-host pacing, and a
 * per-call trace so each real network request becomes one attempt row. Errors
 * use the Site Health fetch-error vocabulary the read API classifies.
 */
import type { CrawlRobotsHandling } from '@citeladder/contracts/site-health';
import { policy } from '../config.ts';
import { record } from '../db/json.ts';
import { resolveSettingSpec, type SettingSource } from '../config/settings.ts';
import type { Database } from '../db/database.ts';
import {
  FetchError,
  fetchWebsite,
  type FetchCall,
  type FetchedPage,
  type WebsiteFetcher,
} from '../safe-fetch.ts';
import {
  acquisitionSettings,
  authorizeAcquisition,
  PageAcquirer,
  respectRobots,
  type RobotsChoice,
} from '../web-evidence/acquisition.ts';
import { hardExcluded, inScope } from './url-admission.ts';

const a = policy.site_health.page_analysis.acquisition;
const codes = a.error_codes;
const BOT_MARKERS = a.bot_block_body_markers.map((marker) => marker.toLowerCase());
// A redirect hop refused for an unreachable robots.txt (429, 5xx, network) may pass later.
const RETRYABLE = new Set([codes.timeout, codes.connection_failed, codes.robots_unavailable]);
const FETCH_ERROR_CODES: Record<string, string> = {
  invalid_url: codes.url_admission_rejected,
  content_type: codes.unsupported_content_type,
  content_encoding: codes.malformed_response,
  robots_disallowed: codes.robots_denied,
  out_of_scope: codes.url_admission_rejected,
};

export function siteFetchSettings(env: SettingSource = process.env) {
  const spec = policy.site_health.settings;
  const value = (name: keyof typeof spec) => resolveSettingSpec(spec[name], env);
  return {
    acquisition: acquisitionSettings(env),
    perHostDelay: Number(value('per_host_delay_seconds')),
    perHostConcurrency: Number(value('per_host_concurrency')),
    rateLimitCooldown: Number(value('rate_limit_cooldown_seconds')),
    maxCrawlDelay: Number(value('max_crawl_delay_seconds')),
    maxWireBytes: Number(value('max_response_wire_bytes')),
    maxDecodedBytes: Number(value('max_response_decoded_bytes')),
    policyVersion: String(value('acquisition_policy_version')),
  };
}

/** A challenge interstitial rather than the page: terminal, since retrying cannot pass it. */
export function isBotBlock(page: FetchedPage) {
  // A 429 asks the crawler to slow down; CDN rate-limit pages carry challenge scripts too.
  if (page.status === 429) return false;
  const prefix = page.body
    .subarray(0, a.bot_block_marker_scan_bytes)
    .toString('latin1')
    .toLowerCase();
  if (!BOT_MARKERS.some((marker) => prefix.includes(marker))) return false;
  const meaningful =
    page.status >= 200 &&
    page.status < 300 &&
    prefix.includes('<h1') &&
    (prefix.includes('<main') || prefix.includes('<article'));
  return !meaningful;
}

function errorCode(error: unknown) {
  if (error instanceof FetchError) return FETCH_ERROR_CODES[error.code] ?? error.code;
  if (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name))
    return codes.timeout;
  return codes.connection_failed;
}

export type SiteFetchFailure = {
  ok: false;
  code: string;
  detail: string;
  retryable: boolean;
  calls: FetchCall[];
  latencyMs: number | null;
};
export type SiteFetchResult = {
  ok: true;
  page: FetchedPage;
  calls: FetchCall[];
  latencyMs: number;
  /** Fetched despite a robots.txt exclusion, because the crawl ignores robots.txt. */
  robotsExcluded: boolean;
};

/**
 * The crawl's frozen robots choice, per destination. `ignore` covers only the
 * project's own site (its registrable domain and subdomains): a redirect off
 * the site still respects that host's robots.txt. A crawl without the choice
 * respects robots.txt everywhere.
 */
export function crawlRobotsHandling(configuration: unknown): RobotsChoice {
  const frozen = record(configuration);
  const domain =
    typeof frozen.root_registrable_domain === 'string' ? frozen.root_registrable_domain : '';
  if (frozen.robots !== 'ignore' || !domain) return respectRobots;
  return (destination) => (inScope(destination.href, domain) ? 'ignore' : 'respect');
}

export class SitePageFetcher {
  readonly acquirer: PageAcquirer;
  readonly settings: ReturnType<typeof siteFetchSettings>;
  constructor(
    db: Database,
    fetcher: WebsiteFetcher = fetchWebsite,
    settings = siteFetchSettings(),
  ) {
    this.settings = settings;
    this.acquirer = new PageAcquirer(
      (url) => authorizeAcquisition(db, url),
      fetcher,
      settings.acquisition,
      settings.perHostDelay,
      settings.perHostConcurrency,
    );
  }

  /** The robots decision for the requested URL, before any page request. */
  async #robotsDenial(url: URL, handling: CrawlRobotsHandling): Promise<SiteFetchFailure | null> {
    const robots = await this.acquirer.robots(url.origin);
    if (robots.admits(url.href, handling)) return null;
    let code: string = codes.robots_denied;
    let detail = 'robots.txt disallows the crawler user-agent for this URL';
    const unreadable = !robots.readable && !robots.restricted;
    if (unreadable || robots.delay > this.settings.maxCrawlDelay) {
      code = codes.robots_unavailable;
      detail = 'robots.txt could not be retrieved or asks for an unsupported delay; fetches paused';
    } else if (robots.restricted) {
      code = codes.access_blocked;
      detail =
        'robots.txt is access-blocked (401/403); the crawler does not bypass access controls';
    }
    // An unreachable robots.txt (429, 5xx, network) may answer later; the task retries.
    // A refused one (too large, redirect limit, SSRF, suppression) will not.
    const retryable = robots.transient;
    return { ok: false, code, detail, retryable, calls: [], latencyMs: null };
  }

  /** Whether robots.txt excludes any URL this fetch requested under an `ignore` choice. */
  async #excluded(handling: RobotsChoice, urls: string[]) {
    for (const href of new Set(urls)) {
      const url = new URL(href);
      if (handling(url) !== 'ignore') continue;
      const robots = await this.acquirer.robots(url.origin);
      if (robots.excludes(href)) return true;
    }
    return false;
  }

  /**
   * `admit` screens the page and every redirect hop (default: the hard
   * exclusions); discovery narrows it to the crawl's scope. `contentTypes`
   * defaults to HTML. `robots` is the crawl's own choice per destination and
   * defaults to respecting robots.txt; only the project's site crawl passes
   * `crawlRobotsHandling`.
   */
  async fetch(
    requested: string,
    options: {
      admit?: (hop: URL) => boolean;
      contentTypes?: readonly string[];
      signal?: AbortSignal;
      robots?: RobotsChoice;
    } = {},
  ): Promise<SiteFetchResult | SiteFetchFailure> {
    options.signal?.throwIfAborted();
    const admit = options.admit ?? ((hop: URL) => !hardExcluded(hop));
    const handling = options.robots ?? respectRobots;
    const url = new URL(requested);
    const denied = await this.#robotsDenial(url, handling(url));
    if (denied) return denied;
    const calls: FetchCall[] = [];
    const started = performance.now();
    try {
      const page = await this.acquirer.fetch(url.href, {
        signal: options.signal,
        maxBytes: this.settings.maxWireBytes,
        maxDecodedBytes: this.settings.maxDecodedBytes,
        timeoutSeconds: this.settings.acquisition.timeout,
        redirects: this.settings.acquisition.redirects,
        contentTypes: [...(options.contentTypes ?? a.html_content_types), ''],
        headerNames: a.persisted_response_headers,
        // Admission screens the page and every redirect hop, never robots.txt.
        admit: (hop) => {
          if (!admit(hop)) throw new FetchError(codes.url_admission_rejected);
        },
        onCall: (call) => calls.push(call),
        robots: handling,
      });
      // A 429 slows every task bound for the host, not just this one.
      if (page.status === 429)
        this.acquirer.coolDown(
          new URL(page.url).origin,
          Math.min(this.settings.rateLimitCooldown, this.settings.maxCrawlDelay),
        );
      const latencyMs = Math.round(performance.now() - started);
      const robotsExcluded = await this.#excluded(handling, [
        url.href,
        ...calls.map((call) => call.url),
        page.url,
      ]);
      return { ok: true, page, calls, latencyMs, robotsExcluded };
    } catch (error) {
      const code = errorCode(error);
      return {
        ok: false,
        code,
        detail: error instanceof Error ? error.message.slice(0, 2000) : code,
        retryable: RETRYABLE.has(code),
        calls,
        latencyMs: Math.round(performance.now() - started),
      };
    }
  }
}
