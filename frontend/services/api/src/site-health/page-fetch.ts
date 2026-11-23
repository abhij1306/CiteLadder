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
const RETRYABLE = new Set([codes.timeout, codes.connection_failed, codes.robots_unavailable]);
const ROBOTS_GATE_CODES = new Set(['robots_disallowed', 'robots_unavailable']);
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

export function isBotBlock(page: FetchedPage) {
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

const TLS_CODES: Record<string, string> = a.tls_certificate_error_codes;

export function tlsCertificateCode(error: unknown): string | null {
  for (let current = error, depth = 0; current instanceof Error && depth < 4; depth++) {
    const code = 'code' in current ? current.code : undefined;
    if (typeof code === 'string' && TLS_CODES[code]) return TLS_CODES[code];
    current = current.cause;
  }
  return null;
}

function errorCode(error: unknown) {
  const tls = tlsCertificateCode(error);
  if (tls) return tls;
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
  robotsExcluded: boolean;
};

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

  async #robotsDenial(
    url: URL,
    handling: CrawlRobotsHandling,
    pending = this.acquirer.robots(url.origin),
  ): Promise<SiteFetchFailure | null> {
    const robots = await pending;
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
    const retryable = robots.transient;
    return { ok: false, code, detail, retryable, calls: [], latencyMs: null };
  }

  async #hopDenial(error: unknown, hop: URL | undefined, handling: RobotsChoice) {
    if (!hop || !(error instanceof FetchError) || !ROBOTS_GATE_CODES.has(error.code)) return null;
    const cached = this.acquirer.cachedRobots(hop.origin);
    return cached ? this.#robotsDenial(hop, handling(hop), cached) : null;
  }

  async #excluded(handling: RobotsChoice, urls: string[]) {
    for (const href of new Set(urls)) {
      const url = new URL(href);
      if (handling(url) !== 'ignore') continue;
      const robots = await this.acquirer.robots(url.origin);
      if (robots.excludes(href)) return true;
    }
    return false;
  }

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
    const hops: URL[] = [];
    try {
      const page = await this.acquirer.fetch(url.href, {
        signal: options.signal,
        maxBytes: this.settings.maxWireBytes,
        maxDecodedBytes: this.settings.maxDecodedBytes,
        timeoutSeconds: this.settings.acquisition.timeout,
        redirects: this.settings.acquisition.redirects,
        contentTypes: [...(options.contentTypes ?? a.html_content_types), ''],
        headerNames: a.persisted_response_headers,
        admit: (hop) => {
          hops.push(hop);
          if (!admit(hop)) throw new FetchError(codes.url_admission_rejected);
        },
        onCall: (call) => calls.push(call),
        robots: handling,
      });
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
      const latencyMs = Math.round(performance.now() - started);
      const denied = await this.#hopDenial(error, hops.at(-1), handling);
      if (denied) return { ...denied, calls, latencyMs };
      const code = errorCode(error);
      return {
        ok: false,
        code,
        detail: error instanceof Error ? error.message.slice(0, 2000) : code,
        retryable: RETRYABLE.has(code),
        calls,
        latencyMs,
      };
    }
  }
}
