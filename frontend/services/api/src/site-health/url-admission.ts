/**
 * The crawler's single URL admission decision: may it touch this URL, under
 * what canonical identity, and what should the corpus do with it. Hard
 * exclusions are not overridable by include globs; globs only narrow scope.
 */
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
// Highest value first, so a path naming two kinds takes the more valuable one.
const VALUE_KINDS = Object.keys(PRIORITIES)
  .filter((kind) => kind !== 'root')
  .sort((a, b) => PRIORITIES[b]! - PRIORITIES[a]!);
const SCHEME_PREFIX = /^[A-Za-z][A-Za-z0-9+.-]*:/u;

export type Scope = {
  domain?: string;
  include?: readonly string[] | null;
  exclude?: readonly string[] | null;
};
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

/** One bracket set from `[`'s position: its regex source and where it ends, or null when unclosed. */
function bracketSet(glob: string, open: number) {
  let end = open + 1;
  if (glob[end] === '!') end++;
  // A `]` right after `[` or `[!` is a member, not the close.
  if (glob[end] === ']') end++;
  const close = glob.indexOf(']', end);
  if (close < 0) return null;
  let set = glob
    .slice(open + 1, close)
    .replaceAll('\\', String.raw`\\`)
    .replaceAll(']', String.raw`\]`);
  if (set.startsWith('!')) set = `^${set.slice(1)}`;
  else if (set.startsWith('^')) set = String.raw`\^` + set.slice(1);
  return { source: `[${set}]`, close };
}

type GlobToken = { kind: 'star' } | { kind: 'char'; accepts: (char: string) => boolean };

const literalToken = (literal: string): GlobToken => ({
  kind: 'char',
  accepts: (char) => char === literal,
});

/**
 * Shell-style glob tokens: `*` spans `/`, `?` is one character, `[!…]`
 * negates. A glob with a set that cannot compile (a reversed range) matches
 * only itself, literally, rather than failing the task.
 */
function globTokens(glob: string): GlobToken[] {
  const tokens: GlobToken[] = [];
  let index = 0;
  while (index < glob.length) {
    const char = glob[index]!;
    const set = char === '[' ? bracketSet(glob, index) : null;
    if (char === '*') {
      if (tokens.at(-1)?.kind !== 'star') tokens.push({ kind: 'star' });
    } else if (char === '?') tokens.push({ kind: 'char', accepts: () => true });
    else if (set) {
      let member: RegExp;
      try {
        member = new RegExp(`^${set.source}$`, 'su');
      } catch {
        return Array.from(glob, literalToken);
      }
      tokens.push({ kind: 'char', accepts: (value) => member.test(value) });
    } else tokens.push(literalToken(char));
    index = (set?.close ?? index) + 1;
  }
  return tokens;
}

/**
 * A glob as a bit-parallel NFA (shift-and): bit `i` is "the first `i` tokens
 * matched". Each input character costs a fixed number of bitset operations,
 * so matching is linear in the URL however many stars the glob holds; a
 * backtracking RegExp translation is polynomial in the star count.
 */
function globMatcher(glob: string) {
  const tokens = globTokens(glob);
  let starEntry = 0n;
  let starLoop = 0n;
  tokens.forEach((token, index) => {
    if (token.kind !== 'star') return;
    starEntry |= 1n << BigInt(index);
    starLoop |= 1n << BigInt(index + 1);
  });
  const accepted = 1n << BigInt(tokens.length);
  const closure = (state: bigint) => state | ((state & starEntry) << 1n);
  const consumers = new Map<string, bigint>();
  const consumes = (char: string) => {
    let mask = consumers.get(char);
    if (mask === undefined) {
      mask = 0n;
      tokens.forEach((token, index) => {
        if (token.kind === 'char' && token.accepts(char)) mask! |= 1n << BigInt(index + 1);
      });
      consumers.set(char, mask);
    }
    return mask;
  };
  return (url: string) => {
    let state = closure(1n);
    for (const char of url) {
      state = closure(((state << 1n) & consumes(char)) | (state & starLoop));
      if (!state) return false;
    }
    return (state & accepted) !== 0n;
  };
}

const compiledGlobs = new WeakMap<readonly string[], ((url: string) => boolean)[]>();
/** Each scope's globs compile once, not once per admitted URL. */
function globs(values: readonly string[] | null | undefined) {
  if (!values) return [];
  let compiled = compiledGlobs.get(values);
  if (!compiled) {
    compiled = values
      .map((value) => String(value).trim())
      .filter(Boolean)
      .map(globMatcher);
    compiledGlobs.set(values, compiled);
  }
  return compiled;
}

/** Include/exclude narrowing of a canonical URL; any exclusion wins, no includes admits all. */
function narrowed(url: string, scope: Scope) {
  if (globs(scope.exclude).some((matches) => matches(url))) return false;
  const include = globs(scope.include);
  return !include.length || include.some((matches) => matches(url));
}

/** The root registrable domain plus every subdomain. */
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

/** The most valuable kind named by whole tokens of one path segment (or a whole fallback segment). */
function namedKind(segment: string) {
  const tokens = pathTokens(segment);
  const named = VALUE_KINDS.find((kind) => tokens.has(kind));
  if (named) return named;
  const fallback = (crawl.value_fallback_tokens as [string, string[]][]).find(([, words]) =>
    words.some((word) => segment === word || tokens.has(word)),
  );
  return fallback?.[0] ?? null;
}

/**
 * Admission ordering only. Whole tokens, not substrings, and the section the
 * URL sits in first: `/blog/product-review` is an article, not a product.
 */
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

/**
 * Resolve an href against its page, refusing the two shapes that only look
 * relative: a join artifact (`allhttps://…`) and a scheme-less absolute link
 * (`twitter.com/x`). Admitted, each cost a fetch, a 404 and a failed page.
 */
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

/**
 * Tracking and ignored keys are not refused: the canonical identity drops
 * them, so a tagged link admits its clean target, which the link checks
 * judge under the same tracking-stripped URL.
 */
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
  // Sitemaps are crawler infrastructure: their extension is the one asset the crawler fetches.
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
  if (scope.domain && !narrowed(canonical.url, scope))
    return rejected(reasons.narrowed, canonical.url, kind);
  // A document stays visible in coverage, but the HTML analyzer never receives it.
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

/** Whether a URL names a non-content endpoint the crawler never fetches, even by redirect. */
export const hardExcluded = (url: URL) => !classifyUrlAdmission(url.href).accepted;
