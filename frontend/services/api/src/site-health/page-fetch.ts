/**
 * Site Health page acquisition: robots and durable suppression at every hop,
 * the crawler's hard URL exclusions on every redirect, per-host pacing, and a
 * per-call trace so each real network request becomes one attempt row. Errors
 * use the Site Health fetch-error vocabulary the read API classifies.
 */
import { policy, resolveSettingSpec } from '../config.ts';
import type { Database } from '../db/database.ts';
import {
  FetchError,
  fetchWebsite,
  type FetchCall,
  type FetchedPage,
  type WebsiteFetcher,
} from '../projects/safe-fetch.ts';
import {
  acquisitionSettings,
  authorizeAcquisition,
  PageAcquirer,
} from '../web-evidence/acquisition.ts';
import { hardExcluded } from './url-admission.ts';

const a = policy.site_health.page_analysis.acquisition;
const codes = a.error_codes;
const BOT_MARKERS = a.bot_block_body_markers.map((marker) => marker.toLowerCase());
const RETRYABLE = new Set([codes.timeout, codes.connection_failed]);
const FETCH_ERROR_CODES: Record<string, string> = {
  invalid_url: codes.url_admission_rejected,
  content_type: codes.unsupported_content_type,
  content_encoding: codes.malformed_response,
  robots_disallowed: codes.robots_denied,
  out_of_scope: codes.url_admission_rejected,
};

export function siteFetchSettings(env: Record<string, string | undefined> = process.env) {
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
};

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
  async #robotsDenial(url: URL): Promise<SiteFetchFailure | null> {
    const robots = await this.acquirer.robots(url.origin);
    if (robots.permits(url.href)) return null;
    let code: string = codes.robots_denied;
    let detail = 'robots.txt disallows the crawler user-agent for this URL';
    if (robots.unavailable || robots.delay > this.settings.maxCrawlDelay) {
      code = codes.robots_unavailable;
      detail = 'robots.txt could not be retrieved or asks for an unsupported delay; fetches paused';
    } else if (robots.restricted) {
      code = codes.access_blocked;
      detail =
        'robots.txt is access-blocked (401/403); the crawler does not bypass access controls';
    }
    return { ok: false, code, detail, retryable: false, calls: [], latencyMs: null };
  }

  /**
   * `admit` screens the page and every redirect hop (default: the hard
   * exclusions); discovery narrows it to the crawl's scope. `contentTypes`
   * defaults to HTML.
   */
  async fetch(
    requested: string,
    options: {
      admit?: (hop: URL) => boolean;
      contentTypes?: readonly string[];
      signal?: AbortSignal;
    } = {},
  ): Promise<SiteFetchResult | SiteFetchFailure> {
    options.signal?.throwIfAborted();
    const admit = options.admit ?? ((hop: URL) => !hardExcluded(hop));
    const url = new URL(requested);
    const denied = await this.#robotsDenial(url);
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
      });
      // A 429 slows every task bound for the host, not just this one.
      if (page.status === 429)
        this.acquirer.coolDown(
          new URL(page.url).origin,
          Math.min(this.settings.rateLimitCooldown, this.settings.maxCrawlDelay),
        );
      return { ok: true, page, calls, latencyMs: Math.round(performance.now() - started) };
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
