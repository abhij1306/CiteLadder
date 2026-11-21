import { policy } from '../config.ts';
import { failureFacts, getLogger } from '../logging.ts';
import { FetchError } from '../safe-fetch.ts';
import {
  SitemapCollector,
  SitemapParseError,
  SitemapTooLargeError,
  sitemapRef,
  type SitemapDocument,
  type SitemapLimits,
} from '../web-evidence/sitemaps.ts';
import { InterpretationTimeoutError, parseSitemapAsync } from './analysis/off-thread.ts';
import { candidate, crawlScope, type Candidate } from './frontier.ts';
import type { Crawl, SiteTaskContext } from './site-task.ts';
import { trackedOrder } from './tracked-set.ts';
import { classifyUrlAdmission } from './url-admission.ts';

const crawlPolicy = policy.site_health.crawl;
const { evidence_urls: evidenceUrls, signal_detail_chars: evidenceChars } =
  policy.site_health.page_analysis.facts.limits;
const logger = getLogger('site_health.setup');

export type WalkSettings = {
  concurrency: number;
  maxDocuments: number;
  maxSiteUrls: number;
  sitemap: SitemapLimits;
};

export function logFetchFailure(
  ctx: Pick<SiteTaskContext, 'signal'>,
  phase: string,
  error: unknown,
  startedAt: number,
) {
  if (ctx.signal.aborted) return;
  logger.warning('site_health_document_fetch_failed', {
    phase,
    ...failureFacts(error),
    elapsed_ms: Math.round(performance.now() - startedAt),
  });
}

const unavailableStatus = (status: number) => status === 408 || status === 429 || status >= 500;

type Unanswered = {
  kind: 'absent' | 'unread';
  status: number | null;
  invalid?: string;
};
type SitemapRead =
  | { kind: 'page'; page: Awaited<ReturnType<SiteTaskContext['fetcher']['acquirer']['fetch']>> }
  | Unanswered;

async function sitemapDocument(
  ctx: SiteTaskContext,
  url: string,
  settings: WalkSettings,
): Promise<SitemapRead> {
  const fetch = ctx.fetcher.settings.acquisition;
  const startedAt = performance.now();
  try {
    const page = await ctx.fetcher.acquirer.fetch(url, {
      signal: ctx.signal,
      maxBytes: settings.sitemap.maxDecodedBytes,
      maxDecodedBytes: settings.sitemap.maxDecodedBytes,
      timeoutSeconds: fetch.timeout,
      redirects: fetch.redirects,
      contentTypes: crawlPolicy.sitemap_content_types,
      admit: (hop) => {
        if (!classifyUrlAdmission(hop.href, { infrastructure: 'sitemap' }).accepted)
          throw new Error('sitemap URL rejected by admission policy');
      },
    });
    if (page.status >= 200 && page.status < 300) return { kind: 'page', page };
    return { kind: unavailableStatus(page.status) ? 'unread' : 'absent', status: page.status };
  } catch (error) {
    logFetchFailure(ctx, 'sitemap', error, startedAt);
    const refused = error instanceof FetchError ? error.status : null;
    const absent = refused !== null && !unavailableStatus(refused);
    return { kind: absent ? 'absent' : 'unread', status: refused };
  }
}

type SitemapAnswer = { kind: 'parsed'; document: SitemapDocument } | Unanswered;

async function readSitemap(
  ctx: SiteTaskContext,
  url: string,
  settings: WalkSettings,
): Promise<SitemapAnswer> {
  const read = await sitemapDocument(ctx, url, settings);
  if (read.kind !== 'page') return read;
  const { body, contentType, status } = read.page;
  try {
    return {
      kind: 'parsed',
      document: await parseSitemapAsync(body, contentType, settings.sitemap),
    };
  } catch (error) {
    if (error instanceof SitemapTooLargeError) return { kind: 'unread', status };
    if (error instanceof SitemapParseError)
      return { kind: 'absent', status, invalid: error.message.slice(0, evidenceChars) };
    if (error instanceof InterpretationTimeoutError) return { kind: 'unread', status };
    throw error;
  }
}

export async function walkSitemaps(
  ctx: SiteTaskContext,
  crawl: Crawl,
  seeds: string[],
  settings: WalkSettings,
) {
  const scope = crawlScope(crawl);
  const walk: Walk = {
    crawlId: crawl.id,
    collector: new SitemapCollector({
      limits: settings.sitemap,
      maxSiteUrls: settings.maxSiteUrls,
      follows: (ref) => classifyUrlAdmission(ref, { ...scope, infrastructure: 'sitemap' }).accepted,
    }),
    files: 0,
    queued: new Set(
      seeds.flatMap((seed) =>
        seed.length <= crawlPolicy.max_url_chars ? (sitemapRef(seed) ?? []) : [],
      ),
    ),
    queue: [],
    unread: 0,
    invalid: [],
    refetched: false,
    namedBy: new Map(),
  };
  walk.queue = [...walk.queued].map((url): Entry => ({ url, depth: 0, source: { kind: 'seed' } }));
  let attempted = 0;
  while (
    walk.queue.length &&
    attempted < settings.maxDocuments &&
    walk.collector.urls.length < settings.maxSiteUrls
  ) {
    const wave = walk.queue.splice(
      0,
      Math.min(settings.concurrency, settings.maxDocuments - attempted),
    );
    attempted += wave.length;
    const answers =
      await /* NOSONAR -- Waves are bounded and sequential: a wave's references feed the next one. */ Promise.all(
        wave.map(async (entry) => ({ entry, read: await readSitemap(ctx, entry.url, settings) })),
      );
    ctx.signal.throwIfAborted();
    for (const { entry, read } of answers) collect(walk, entry, read);
  }
  const limitReached = walk.queue.length > 0 || walk.collector.truncated;
  const complete = !limitReached && !walk.unread && walk.files > 0;
  return {
    fileCount: walk.files,
    complete,
    limitReached,
    unread: walk.unread,
    invalidCount: walk.invalid.length,
    invalid: walk.invalid.slice(0, evidenceUrls),
    ...admittedUrls(walk.collector, crawl),
  };
}
export type SitemapWalk = Awaited<ReturnType<typeof walkSitemaps>>;

type IndexRead = {
  url: string;
  depth: number;
  pending: number;
  answered: boolean;
  unread: string[];
};
const indexRead = (url: string, depth: number): IndexRead => ({
  url,
  depth,
  pending: 0,
  answered: false,
  unread: [],
});
type Source =
  | { kind: 'seed' }
  | { kind: 'child'; index: IndexRead }
  | { kind: 'refetch'; index: IndexRead };
type Entry = { url: string; depth: number; source: Source };

type Walk = {
  crawlId: string;
  collector: SitemapCollector;
  files: number;
  queued: Set<string>;
  queue: Entry[];
  unread: number;
  invalid: { url: string; reason: string }[];
  refetched: boolean;
  namedBy: Map<string, number>;
};

const refetchPolicy = crawlPolicy.sitemap_index_refetch;

const cacheBusted = (url: string) =>
  `${url}${url.includes('?') ? '&' : '?'}${refetchPolicy.cache_bust_param}=${Date.now()}`;

function collect(walk: Walk, entry: Entry, read: SitemapAnswer) {
  const { url, depth, source } = entry;
  if (source.kind === 'refetch') return collectRefetch(walk, entry, source.index, read);
  if (read.kind !== 'parsed') {
    if (read.invalid) walk.invalid.push({ url, reason: read.invalid });
    if (read.kind === 'absent' && depth === 0) return;
    walk.unread++;
    logger.warning('site_health_sitemap_unread', {
      crawl_id: walk.crawlId,
      depth,
      answer: read.kind,
      status_code: read.status,
    });
    if (source.kind === 'child') childAnswered(walk, source.index, url, read.kind);
    return;
  }
  if (source.kind === 'child') childAnswered(walk, source.index, url, 'parsed');
  walk.files++;
  queueChildren(walk, indexRead(url, depth), read.document);
}

const namedRefs = (document: SitemapDocument) =>
  new Set(document.refs.flatMap((ref) => sitemapRef(ref) ?? []));

function queueChildren(walk: Walk, index: IndexRead, document: SitemapDocument) {
  for (const ref of namedRefs(document)) walk.namedBy.set(ref, (walk.namedBy.get(ref) ?? 0) + 1);
  const refs = walk.collector.add(index.url, document, index.depth);
  for (const ref of refs.filter((item) => !walk.queued.has(item))) {
    walk.queued.add(ref);
    index.pending++;
    walk.queue.push({ url: ref, depth: index.depth + 1, source: { kind: 'child', index } });
  }
}

/**
 * A CDN can keep serving an index naming children the site has since
 * replaced. When none of an index's children was read, fetch that index once
 * more past the cache.
 */
function childAnswered(walk: Walk, index: IndexRead, url: string, answer: SitemapAnswer['kind']) {
  index.pending--;
  if (refetchPolicy.child_answers.includes(answer)) index.unread.push(url);
  else index.answered = true;
  if (index.pending > 0 || index.answered || walk.refetched) return;
  const refetch = cacheBusted(index.url);
  if (!classifyUrlAdmission(refetch, { infrastructure: 'sitemap' }).accepted) return;
  walk.refetched = true;
  walk.queue.push({ url: refetch, depth: index.depth, source: { kind: 'refetch', index } });
}

function collectRefetch(walk: Walk, entry: Entry, stale: IndexRead, read: SitemapAnswer) {
  logger.info('site_health_sitemap_index_refetched', {
    crawl_id: walk.crawlId,
    depth: entry.depth,
    answer: read.kind,
    status_code: read.kind === 'parsed' ? null : read.status,
  });
  if (read.kind !== 'parsed') return;
  const named = namedRefs(read.document);
  for (const url of stale.unread.filter((child) => !named.has(child))) {
    const others = (walk.namedBy.get(url) ?? 1) - 1;
    walk.namedBy.set(url, others);
    if (!others) walk.unread--;
  }
  queueChildren(walk, indexRead(entry.url, entry.depth), read.document);
}

export type SitemapUrl = { item: Candidate; lastmod: string | null };

function admittedUrls(collector: SitemapCollector, crawl: Crawl) {
  const scope = crawlScope(crawl);
  const found = new Map<string, SitemapUrl>();
  for (const raw of collector.urls) {
    const admission = classifyUrlAdmission(raw, scope);
    if (!admission.accepted || !admission.url || found.has(admission.hash)) continue;
    found.set(admission.hash, {
      item: candidate(admission, {
        url: admission.url,
        hash: admission.hash,
        depth: 1,
        sourceKind: 'sitemap',
        parentPosition: 0,
        linkOrdinal: found.size,
      }),
      lastmod: collector.lastmod.get(raw) ?? null,
    });
  }
  const listed = [...found.values()].toSorted((a, b) => trackedOrder(a.item, b.item));
  return { discovered: found.size, listed };
}
