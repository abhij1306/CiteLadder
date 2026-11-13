/** Durable operator suppression, destination robots, and publisher pacing at every hop. */
import { setTimeout as delay } from 'node:timers/promises';
import robotsModule from 'robots-parser';
import type { CrawlRobotsHandling } from '@citeladder/contracts/site-health';

import { policy } from '../config.ts';
import { resolveSettingSpec, type SettingSource } from '../config/settings.ts';
import type { Database } from '../db/database.ts';
import { FetchError, fetchWebsite, type FetchOptions, type WebsiteFetcher } from '../safe-fetch.ts';
import { failureFacts, getLogger } from '../logging.ts';

const logger = getLogger('web_evidence.acquisition');

// The package is CommonJS; its declaration describes the exported function as ESM.
const robotsParser = robotsModule as unknown as (
  url: string,
  body: string,
) => {
  isAllowed: (url: string, userAgent: string) => boolean | undefined;
  getCrawlDelay: (userAgent: string) => number | undefined;
  getSitemaps: () => string[];
};

const RULE_FIELDS = new Set(['allow', 'disallow', 'crawl-delay']);

/** One robots.txt line's lower-cased field and value, comment removed; no colon, no field. */
function robotsLine(raw: string) {
  const line = raw.split('#', 1)[0] ?? '';
  const colon = line.indexOf(':');
  return {
    field: line.slice(0, Math.max(colon, 0)).trim().toLowerCase(),
    value: line.slice(colon + 1).trim(),
  };
}

/** A `User-agent` value as the parser keys it: lower-cased, without a version. */
const agentToken = (value: string) => value.toLowerCase().split('/', 1)[0]?.trim() ?? '';

/**
 * The user-agent groups robots.txt gives rules (allow, disallow or crawl
 * delay), lower-cased without a version, grouped as the parser groups them:
 * consecutive `User-agent` lines share the rules that follow.
 */
function ruleGroups(body: string) {
  const groups = new Set<string>();
  let agents: string[] = [];
  let collecting = false;
  for (const raw of body.split(/\r\n|\r|\n/u)) {
    const { field, value } = robotsLine(raw);
    if (field === 'user-agent') {
      agents = collecting ? agents : [];
      collecting = true;
      if (value) agents.push(agentToken(value));
    } else if (field) {
      collecting = false;
      if (RULE_FIELDS.has(field)) agents.forEach((agent) => groups.add(agent));
    }
  }
  return groups;
}

export function acquisitionSettings(env: SettingSource = process.env) {
  const spec = policy.site_health.settings;
  const number = (key: keyof typeof spec) => Number(resolveSettingSpec(spec[key], env));
  return {
    defaultDelay: number('default_crawl_delay_seconds'),
    maxDelay: number('max_crawl_delay_seconds'),
    robotsBytes: number('robots_max_decoded_bytes'),
    robotsTtl: number('robots_cache_ttl_seconds'),
    robotsAttempts: number('robots_transient_attempts'),
    robotsBackoff: number('robots_transient_backoff_seconds'),
    robotsAuthorities: number('robots_cache_max_authorities'),
    timeout: number('request_timeout_seconds'),
    redirects: number('max_redirects'),
  };
}
export async function authorizeAcquisition(db: Database, url: URL) {
  const labels = url.hostname.toLowerCase().replace(/\.$/u, '').split('.');
  const scopes = [
    '*',
    ...labels.slice(0, -1).map((_label, index) => labels.slice(index).join('.')),
  ];
  let blocked;
  try {
    blocked = await db
      .selectFrom('web_acquisition_controls')
      .select('domain')
      .where('domain', 'in', scopes)
      .where('blocked', '=', true)
      .limit(1)
      .executeTakeFirst();
  } catch (error) {
    // Fail closed: an unreadable operator stop list never admits a request.
    logger.warning('web_acquisition_control_unreadable', failureFacts(error));
    throw new FetchError('acquisition_unavailable');
  }
  if (blocked) throw new FetchError('acquisition_unavailable');
}
type HostState = { chain: Promise<void>; last: number; active: number; waiting: (() => void)[] };

/**
 * Per-host politeness: at most `concurrency` requests in flight to one host,
 * successive starts spaced by the delay, and an explicit cool-down after a
 * rate limit. Starts queue behind one another rather than all sleeping
 * against the same stale timestamp.
 */
export class HostPacer {
  readonly #hosts = new Map<string, HostState>();
  readonly concurrency: number;
  constructor(concurrency = 1) {
    this.concurrency = Math.max(1, concurrency);
  }
  #host(authority: string) {
    let state = this.#hosts.get(authority);
    if (!state) {
      state = { chain: Promise.resolve(), last: -Infinity, active: 0, waiting: [] };
      this.#hosts.set(authority, state);
    }
    return state;
  }
  /** Hold the host back for `seconds` from now, e.g. after a 429. */
  coolDown(authority: string, seconds: number) {
    const state = this.#host(authority);
    state.last = Math.max(state.last, performance.now() + seconds * 1000);
  }
  /**
   * Wait for a free slot. An abort while queued leaves the queue at once; a
   * waiter that is woken but has been aborted passes the wake-up on, so a
   * cancelled caller never strands the callers behind it.
   */
  async #acquire(state: HostState, signal?: AbortSignal) {
    signal?.throwIfAborted();
    while (state.active >= this.concurrency) {
      await new Promise<void>((resolve, reject) => {
        const wake = () => {
          signal?.removeEventListener('abort', abort);
          resolve();
        };
        const abort = () => {
          const index = state.waiting.indexOf(wake);
          if (index >= 0) state.waiting.splice(index, 1);
          reject(signal!.reason);
        };
        state.waiting.push(wake);
        signal?.addEventListener('abort', abort, { once: true });
      }); // NOSONAR: wait for a slot, then re-check; waiters resume one at a time.
      if (signal?.aborted) {
        state.waiting.shift()?.();
        signal.throwIfAborted();
      }
    }
    state.active++;
  }
  async slot<T>(authority: string, seconds: number, send: () => Promise<T>, signal?: AbortSignal) {
    // Before the host state exists, so a cancelled call never leaves an idle entry behind.
    signal?.throwIfAborted();
    const state = this.#host(authority);
    await this.#acquire(state, signal);
    try {
      const previous = state.chain;
      let started!: () => void;
      state.chain = previous.then(
        () =>
          new Promise<void>((resolve) => {
            started = resolve;
          }),
      );
      await previous;
      try {
        signal?.throwIfAborted();
        const wait = Math.max(0, seconds * 1000 - (performance.now() - state.last));
        if (wait) await delay(wait, undefined, { signal });
        state.last = Math.max(state.last, performance.now());
      } finally {
        started();
      }
      return await send();
    } finally {
      state.last = Math.max(state.last, performance.now());
      state.active--;
      state.waiting.shift()?.();
      if (!state.active && !state.waiting.length && state.last + seconds * 1000 < performance.now())
        this.#hosts.delete(authority);
    }
  }
}
export function robotsPolicy(
  origin: string,
  status: number,
  body: string,
  settings = acquisitionSettings({}),
) {
  const unavailable = status === 429 || status >= 500 || status === 0;
  const restricted = status === 401 || status === 403;
  const fetched = status >= 200 && status < 300;
  // A missing file (other 4xx) is readable as "no rules"; 1xx, 3xx and failures are not.
  const readable = fetched || (status >= 400 && status < 500 && !unavailable && !restricted);
  const robots = robotsParser(`${origin}/robots.txt`, fetched ? body : '');
  const groups = fetched ? ruleGroups(body) : new Set<string>();
  const declared = robots.getCrawlDelay(policy.web_fetch.user_agent);
  const seconds = declared === undefined ? settings.defaultDelay : Math.max(0, declared);
  // Readable, not access-blocked, and asking for a delay the crawler honours.
  const fetchable = readable && Number.isFinite(seconds) && seconds <= settings.maxDelay;
  const permits = (url: string) =>
    fetchable && robots.isAllowed(url, policy.web_fetch.user_agent) === true;
  return {
    status,
    /** The policy text when robots.txt answered 2xx, else null. */
    body: fetched ? body : null,
    unavailable,
    /**
     * Whether asking again may answer: a 429, 5xx or network failure. A refusal
     * (SSRF, suppression, size, redirects) repeats, so it is cached and final.
     */
    transient: unavailable,
    restricted,
    readable,
    delay: seconds,
    /** Whether the publisher's rules admit `agent`, for reporting another crawler's stance. */
    allows: (url: string, agent: string) =>
      !fetched || !body.trim() || robots.isAllowed(url, agent) !== false,
    matched: (tokens: string[]) => {
      if (tokens.some((token) => groups.has(token.toLowerCase()))) return 'specific_group' as const;
      return groups.has('*') ? ('wildcard_group' as const) : ('no_rules' as const);
    },
    sitemaps: robots.getSitemaps(),
    permits,
    /** The rules disallow the crawler from `url` (not whether robots.txt was readable). */
    excludes: (url: string) => robots.isAllowed(url, policy.web_fetch.user_agent) === false,
    /**
     * Whether a fetch of `url` may go ahead. `ignore` waives only the disallow
     * rules: an unreadable or access-blocked robots.txt, or an unsupported
     * crawl delay, still stops it.
     */
    admits: (url: string, handling: CrawlRobotsHandling) =>
      handling === 'ignore' ? fetchable : permits(url),
  };
}
export type RobotsPolicy = ReturnType<typeof robotsPolicy>;
/** How one fetch treats robots.txt at each destination it requests. */
export type RobotsChoice = (destination: URL) => CrawlRobotsHandling;
/** Every caller but the project's own site crawl respects robots.txt everywhere. */
export const respectRobots: RobotsChoice = () => 'respect';

export class PageAcquirer {
  readonly #cache = new Map<string, { expires: number; value: Promise<RobotsPolicy> }>();
  readonly #pacer: HostPacer;
  readonly authorize: (url: URL) => Promise<void>;
  readonly fetcher: WebsiteFetcher;
  readonly settings: ReturnType<typeof acquisitionSettings>;
  readonly floor: number;
  constructor(
    authorize: (url: URL) => Promise<void>,
    fetcher: WebsiteFetcher = fetchWebsite,
    settings = acquisitionSettings(),
    floor = policy.source_pages.per_host_delay_seconds,
    concurrency = 1,
  ) {
    this.#pacer = new HostPacer(concurrency);
    this.authorize = authorize;
    this.fetcher = fetcher;
    this.settings = settings;
    this.floor = floor;
  }
  async robots(origin: string): Promise<RobotsPolicy> {
    const cached = this.#cache.get(origin);
    if (cached && cached.expires > Date.now()) return cached.value;
    const value = this.#robots(origin);
    this.#cache.set(origin, { expires: Date.now() + this.settings.robotsTtl * 1000, value });
    if (this.settings.robotsAuthorities && this.#cache.size > this.settings.robotsAuthorities) {
      for (const key of this.#cache.keys()) {
        if (key !== origin) {
          this.#cache.delete(key);
          break;
        }
      }
    }
    const result = await value;
    // A transient failure is never cached: the next request asks the host again.
    if (result.transient && this.#cache.get(origin)?.value === value) this.#cache.delete(origin);
    return result;
  }
  /**
   * robots.txt, with a transient failure (429, 5xx, network) retried after an
   * exponential backoff up to `robotsAttempts` requests in all.
   */
  async #robots(origin: string, tried = 1): Promise<RobotsPolicy> {
    const robots = await this.#robotsAttempt(origin);
    if (!robots.transient || tried >= this.settings.robotsAttempts) return robots;
    await delay(this.settings.robotsBackoff * 1000 * 2 ** (tried - 1));
    return this.#robots(origin, tried + 1);
  }
  async #robotsAttempt(origin: string): Promise<RobotsPolicy> {
    const startedAt = performance.now();
    try {
      const result = await this.fetcher(`${origin}/robots.txt`, {
        maxBytes: this.settings.robotsBytes,
        timeoutSeconds: this.settings.timeout,
        redirects: this.settings.redirects,
        contentTypes: ['text/plain', 'text/html', 'application/octet-stream', ''],
        authorize: this.authorize,
        gate: (url, send, signal) => this.#pacer.slot(url.origin, this.floor, send, signal),
      });
      return robotsPolicy(origin, result.status, result.body.toString('utf8'), this.settings);
    } catch (error) {
      // Status 0 reads as unreachable robots.
      logger.info('robots_fetch_failed', {
        ...failureFacts(error),
        elapsed_ms: Math.round(performance.now() - startedAt),
      });
      // A refusal (SSRF, suppression, size, redirects) repeats on retry; a network failure may not.
      const transient = !(error instanceof FetchError) || error.code === 'dns_resolution_failed';
      return { ...robotsPolicy(origin, 0, '', this.settings), transient };
    }
  }
  /** Pause new requests to an origin, e.g. after it answered 429. */
  coolDown(origin: string, seconds: number) {
    this.#pacer.coolDown(origin, seconds);
  }
  /**
   * `admit` screens each page hop (never robots.txt) before the shared
   * authorization. `robots` decides per hop and respects robots.txt unless the
   * caller is the project's own site crawl, that crawl chose to ignore
   * robots.txt, and the hop is on the crawl's own site.
   */
  fetch(
    url: string,
    options: Omit<FetchOptions, 'gate' | 'authorize'> & {
      admit?: (url: URL) => void;
      robots?: RobotsChoice;
    },
  ) {
    const { admit, robots: handling = respectRobots, ...rest } = options;
    return this.fetcher(url, {
      ...rest,
      authorize: admit
        ? async (destination) => {
            admit(destination);
            await this.authorize(destination);
          }
        : this.authorize,
      gate: async (destination, send, signal) => {
        admit?.(destination);
        const robots = await this.robots(destination.origin);
        if (!robots.admits(destination.href, handling(destination)))
          throw new FetchError(robots.unavailable ? 'robots_unavailable' : 'robots_disallowed');
        return this.#pacer.slot(
          destination.origin,
          Math.max(this.floor, robots.delay),
          send,
          signal,
        );
      },
    });
  }
}
