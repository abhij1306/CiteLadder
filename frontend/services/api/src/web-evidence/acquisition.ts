/** Durable operator suppression, destination robots, and publisher pacing at every hop. */
import { setTimeout as delay } from 'node:timers/promises';
import robotsModule from 'robots-parser';

import { policy, resolveSettingSpec } from '../config.ts';
import type { Database } from '../db/database.ts';
import {
  FetchError,
  fetchWebsite,
  type FetchOptions,
  type WebsiteFetcher,
} from '../projects/safe-fetch.ts';

// The package is CommonJS; its declaration describes the exported function as ESM.
const robotsParser = robotsModule as unknown as (
  url: string,
  body: string,
) => {
  isAllowed: (url: string, userAgent: string) => boolean | undefined;
  getCrawlDelay: (userAgent: string) => number | undefined;
  getSitemaps: () => string[];
  _rules: Record<string, unknown>;
};

export function acquisitionSettings(env: Record<string, string | undefined> = process.env) {
  const spec = policy.site_health.settings;
  const number = (key: keyof typeof spec) => Number(resolveSettingSpec(spec[key], env));
  return {
    defaultDelay: number('default_crawl_delay_seconds'),
    maxDelay: number('max_crawl_delay_seconds'),
    robotsBytes: number('robots_max_decoded_bytes'),
    robotsTtl: number('robots_cache_ttl_seconds'),
    robotsRetry: number('robots_unreachable_recheck_seconds'),
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
  try {
    const blocked = await db
      .selectFrom('web_acquisition_controls')
      .select('domain')
      .where('domain', 'in', scopes)
      .where('blocked', '=', true)
      .limit(1)
      .executeTakeFirst();
    if (blocked) throw new FetchError('acquisition_unavailable');
  } catch {
    throw new FetchError('acquisition_unavailable');
  }
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
  const declared = robots.getCrawlDelay(policy.web_fetch.user_agent);
  const seconds = declared === undefined ? settings.defaultDelay : Math.max(0, declared);
  return {
    status,
    /** The policy text when robots.txt answered 2xx, else null. */
    body: fetched ? body : null,
    unavailable,
    restricted,
    readable,
    delay: seconds,
    /** Whether the publisher's rules admit `agent`, for reporting another crawler's stance. */
    allows: (url: string, agent: string) =>
      !fetched || !body.trim() || robots.isAllowed(url, agent) !== false,
    matched: (tokens: string[]) => {
      if (tokens.some((token) => Object.hasOwn(robots._rules, token.toLowerCase())))
        return 'specific_group' as const;
      return Object.hasOwn(robots._rules, '*')
        ? ('wildcard_group' as const)
        : ('no_rules' as const);
    },
    sitemaps: robots.getSitemaps(),
    permits: (url: string) =>
      !unavailable &&
      !restricted &&
      Number.isFinite(seconds) &&
      seconds <= settings.maxDelay &&
      robots.isAllowed(url, policy.web_fetch.user_agent) === true,
  };
}
export type RobotsPolicy = ReturnType<typeof robotsPolicy>;

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
    if (result.unavailable)
      this.#cache.set(origin, { value, expires: Date.now() + this.settings.robotsRetry * 1000 });
    return result;
  }
  async #robots(origin: string) {
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
    } catch {
      return robotsPolicy(origin, 0, '', this.settings);
    }
  }
  /** Pause new requests to an origin, e.g. after it answered 429. */
  coolDown(origin: string, seconds: number) {
    this.#pacer.coolDown(origin, seconds);
  }
  /** `admit` screens each page hop (never robots.txt) before the shared authorization. */
  fetch(
    url: string,
    options: Omit<FetchOptions, 'gate' | 'authorize'> & {
      admit?: (url: URL) => void;
    },
  ) {
    const { admit, ...rest } = options;
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
        if (!robots.permits(destination.href))
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
