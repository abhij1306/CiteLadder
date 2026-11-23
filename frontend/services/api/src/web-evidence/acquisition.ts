import { setTimeout as delay } from 'node:timers/promises';
import robotsModule from 'robots-parser';
import type { CrawlRobotsHandling } from '@citeladder/contracts/site-health';

import { policy } from '../config.ts';
import { resolveSettingSpec, type SettingSource } from '../config/settings.ts';
import type { Database } from '../db/database.ts';
import { FetchError, fetchWebsite, type FetchOptions, type WebsiteFetcher } from '../safe-fetch.ts';
import { failureFacts, getLogger } from '../logging.ts';
import { widen } from '../widen.ts';

const logger = getLogger('web_evidence.acquisition');

const robotsParser = robotsModule as unknown as (
  url: string,
  body: string,
) => {
  isAllowed: (url: string, userAgent: string) => boolean | undefined;
  getCrawlDelay: (userAgent: string) => number | undefined;
  getSitemaps: () => string[];
};

const RULE_FIELDS = new Set(['allow', 'disallow', 'crawl-delay']);

function robotsLine(raw: string) {
  const line = raw.split('#', 1)[0] ?? '';
  const colon = line.indexOf(':');
  return {
    field: line.slice(0, Math.max(colon, 0)).trim().toLowerCase(),
    value: line.slice(colon + 1).trim(),
  };
}

const agentToken = (value: string) => value.toLowerCase().split('/', 1)[0]?.trim() ?? '';

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
    logger.warning('web_acquisition_control_unreadable', failureFacts(error));
    throw new FetchError('acquisition_unavailable');
  }
  if (blocked) throw new FetchError('acquisition_unavailable');
}
type HostState = { chain: Promise<void>; last: number; active: number; waiting: (() => void)[] };

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
  coolDown(authority: string, seconds: number) {
    const state = this.#host(authority);
    state.last = Math.max(state.last, performance.now() + seconds * 1000);
  }
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
  const readable = fetched || (status >= 400 && status < 500 && !unavailable && !restricted);
  const robots = robotsParser(`${origin}/robots.txt`, fetched ? body : '');
  const groups = fetched ? ruleGroups(body) : new Set<string>();
  const declared = robots.getCrawlDelay(policy.web_fetch.user_agent);
  const seconds = declared === undefined ? settings.defaultDelay : Math.max(0, declared);
  const fetchable = readable && Number.isFinite(seconds) && seconds <= settings.maxDelay;
  const permits = (url: string) =>
    fetchable && robots.isAllowed(url, policy.web_fetch.user_agent) === true;
  return {
    status,
    body: fetched ? body : null,
    unavailable,
    transient: unavailable,
    failure: widen<string | null>(null),
    restricted,
    readable,
    delay: seconds,
    allows: (url: string, agent: string) =>
      !fetched || !body.trim() || robots.isAllowed(url, agent) !== false,
    matched: (tokens: string[]) => {
      if (tokens.some((token) => groups.has(token.toLowerCase()))) return 'specific_group' as const;
      return groups.has('*') ? ('wildcard_group' as const) : ('no_rules' as const);
    },
    sitemaps: robots.getSitemaps(),
    permits,
    excludes: (url: string) => robots.isAllowed(url, policy.web_fetch.user_agent) === false,
    admits: (url: string, handling: CrawlRobotsHandling) =>
      handling === 'ignore' ? fetchable : permits(url),
  };
}
export type RobotsPolicy = ReturnType<typeof robotsPolicy>;
export type RobotsChoice = (destination: URL) => CrawlRobotsHandling;
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
  cachedRobots(origin: string): Promise<RobotsPolicy> | null {
    const cached = this.#cache.get(origin);
    return cached && cached.expires > Date.now() ? cached.value : null;
  }
  async robots(origin: string): Promise<RobotsPolicy> {
    const cached = this.cachedRobots(origin);
    if (cached) return cached;
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
    if (result.transient && this.#cache.get(origin)?.value === value) this.#cache.delete(origin);
    return result;
  }
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
      const facts = failureFacts(error);
      logger.info('robots_fetch_failed', {
        ...facts,
        elapsed_ms: Math.round(performance.now() - startedAt),
      });
      const transient = !(error instanceof FetchError) || error.code === 'dns_resolution_failed';
      const failure = facts.error_code ?? facts.error_class;
      return { ...robotsPolicy(origin, 0, '', this.settings), transient, failure };
    }
  }
  coolDown(origin: string, seconds: number) {
    this.#pacer.coolDown(origin, seconds);
  }
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
