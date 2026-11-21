import { parse as parseHost } from 'tldts';

import { policy } from '../config.ts';
import { stripTrailing } from '../text-order.ts';
import { canonicalIdentity } from './url-identity.ts';

const crawl = policy.site_health.crawl;
const acquisition = policy.site_health.page_analysis.acquisition;
const reasons = crawl.exclusions;
const PATH_EXCLUSIONS = acquisition.hard_exclusion_path_patterns.map(
  (pattern) => new RegExp(pattern),
);
const HOST_EXCLUSIONS = new Set(acquisition.hard_exclusion_host_labels);
const QUERY_EXCLUSIONS = new Set(acquisition.hard_exclusion_query_keys);
const MAX_URL_CHARS = policy.site_health.page_analysis.facts.limits.url_chars;
const PRIORITIES: Record<string, number> = crawl.value_priorities;
const VALUE_KINDS = Object.keys(PRIORITIES)
  .filter((kind) => kind !== 'root')
  .sort((a, b) => PRIORITIES[b]! - PRIORITIES[a]!);
const SCHEME_PREFIX = /^[A-Za-z][A-Za-z0-9+.-]*:/u;

export type Scope = { domain?: string };
export type Admission = {
  accepted: boolean;
  url: string | null;
  hash: string;
  reason: string | null;
  valueKind: string;
  priority: number;
  disposition: 'analyze' | 'inventory_only';
  dispositionReason: string;
  itemKind: string;
};

export function inScope(url: string, domain: string) {
  const root = domain.trim().replace(/\.$/u, '').toLowerCase();
  if (!root) return false;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return host === root || host.endsWith(`.${root}`);
}

const pathTokens = (segment: string) => new Set(segment.split(/[-_.]+/u).filter(Boolean));

function namedKind(segment: string) {
  const tokens = pathTokens(segment);
  const named = VALUE_KINDS.find((kind) => tokens.has(kind));
  if (named) return named;
  const fallback = (crawl.value_fallback_tokens as [string, string[]][]).find(([, words]) =>
    words.some((word) => segment === word || tokens.has(word)),
  );
  return fallback?.[0] ?? null;
}

function valueKind(url: string) {
  const path = stripTrailing(new URL(url).pathname.toLowerCase(), '/') || '/';
  if (path === '/') return 'root';
  const segments = path.split('/').filter(Boolean);
  for (const segment of segments) {
    const kind = namedKind(segment);
    if (kind) return kind;
  }
  return 'other';
}

function resolve(raw: string, base: string | undefined) {
  if (!base) return raw;
  if (raw.includes('://') && !SCHEME_PREFIX.test(raw)) throw new Error('malformed reference');
  if (!SCHEME_PREFIX.test(raw) && !raw.startsWith('/')) {
    const first = raw.split('/', 1)[0]!.split('?', 1)[0]!.split('#', 1)[0]!;
    const parsed = parseHost(first);
    if (first.includes('.') && parsed.domain && (parsed.isIcann || parsed.isPrivate))
      throw new Error('scheme-less absolute reference');
  }
  return new URL(raw, base).href;
}

function queryRejection(url: URL) {
  const keys = [...url.searchParams.keys()].map((key) => key.toLowerCase());
  if (keys.some((key) => QUERY_EXCLUSIONS.has(key))) return reasons.hard_query;
  return null;
}
function canonicalRejection(canonical: URL, infrastructure: 'sitemap' | undefined) {
  if (HOST_EXCLUSIONS.has(canonical.hostname.toLowerCase().split('.')[0]!))
    return reasons.hard_host;
  const path = stripTrailing(canonical.pathname.toLowerCase(), '/') || '/';
  if (PATH_EXCLUSIONS.some((pattern) => pattern.test(path))) return reasons.hard_path;
  const sitemap =
    infrastructure === 'sitemap' &&
    crawl.sitemap_path_suffixes.some((suffix) => path.endsWith(suffix));
  if (
    !sitemap &&
    acquisition.hard_exclusion_extensions.some((extension) => path.endsWith(extension))
  )
    return reasons.hard_asset;
  if (canonical.href.length > MAX_URL_CHARS) return reasons.invalid;
  return null;
}

const rejected = (reason: string, url: string | null = null, kind = 'other'): Admission => ({
  accepted: false,
  url,
  hash: '',
  reason,
  valueKind: kind,
  priority: url ? (PRIORITIES[kind] ?? PRIORITIES.other!) : 0,
  disposition: 'analyze',
  dispositionReason: 'html_content',
  itemKind: 'html_page',
});

export function classifyUrlAdmission(
  url: string,
  scope: Scope & { base?: string; infrastructure?: 'sitemap' } = {},
): Admission {
  let canonical: { url: string; hash: string };
  try {
    const resolved = resolve(String(url ?? '').trim(), scope.base);
    const query = queryRejection(new URL(resolved));
    if (query) return rejected(query);
    canonical = canonicalIdentity(resolved);
    const rejection = canonicalRejection(new URL(canonical.url), scope.infrastructure);
    if (rejection) return rejected(rejection);
  } catch {
    return rejected(reasons.invalid);
  }
  const kind = valueKind(canonical.url);
  if (scope.domain && !inScope(canonical.url, scope.domain))
    return rejected(reasons.out_of_scope, canonical.url, kind);
  const path = new URL(canonical.url).pathname.toLowerCase();
  const document = crawl.inventory_document_extensions.some((extension) =>
    path.endsWith(extension),
  );
  return {
    accepted: true,
    url: canonical.url,
    hash: canonical.hash,
    reason: null,
    valueKind: kind,
    priority: PRIORITIES[kind] ?? PRIORITIES.other!,
    disposition: document ? 'inventory_only' : 'analyze',
    dispositionReason: document ? 'document' : 'html_content',
    itemKind: document ? 'document' : 'html_page',
  };
}

export const hardExcluded = (url: URL) => !classifyUrlAdmission(url.href).accepted;
