/**
 * Bounded sitemap parsing. Sitemaps are attacker-influenced XML: entity
 * declarations are refused outright, gzip expansion is capped before parsing,
 * extracted URLs are capped, and index recursion is depth-bounded and
 * loop-safe. This module only parses; the caller fetches each document.
 */
import { gunzipSync } from 'node:zlib';

import { XMLParser, XMLValidator } from 'fast-xml-parser';

export class SitemapParseError extends Error {}
export type SitemapLimits = { maxDecodedBytes: number; maxUrls: number; maxIndexDepth: number };

const parser = new XMLParser({
  ignoreAttributes: true,
  ignoreDeclaration: true,
  ignorePiTags: true,
  removeNSPrefix: true,
  parseTagValue: false,
  htmlEntities: false,
  isArray: (name) => name === 'url' || name === 'sitemap',
});

/** Decompress a gzipped body under the decoded-byte cap; plain bodies pass through bounded. */
function sitemapBytes(body: Buffer, contentType: string, maxBytes: number) {
  const gzip = (body[0] === 0x1f && body[1] === 0x8b) || contentType.toLowerCase().includes('gzip');
  if (!gzip) {
    if (body.length > maxBytes) throw new SitemapParseError('sitemap exceeds the decoded byte cap');
    return body;
  }
  try {
    return gunzipSync(body, { maxOutputLength: maxBytes });
  } catch {
    throw new SitemapParseError('malformed gzip sitemap or compression bomb');
  }
}

const loc = (entry: unknown) =>
  entry && typeof entry === 'object' && 'loc' in entry && typeof entry.loc === 'string'
    ? entry.loc.trim()
    : '';
/** A W3C datetime is at most 29 characters; anything longer is kept bounded, not trusted. */
const MAX_LASTMOD_CHARS = 64;
const lastmodOf = (entry: unknown) =>
  entry && typeof entry === 'object' && 'lastmod' in entry && typeof entry.lastmod === 'string'
    ? entry.lastmod.trim().slice(0, MAX_LASTMOD_CHARS)
    : '';

/** Declared `<lastmod>` values by page URL; the first declaration of a URL wins. */
function lastmods(entries: unknown, maxUrls: number) {
  const declared = new Map<string, string>();
  for (const entry of (Array.isArray(entries) ? entries : []).slice(0, maxUrls)) {
    const url = loc(entry);
    const value = lastmodOf(entry);
    if (url && value && !declared.has(url)) declared.set(url, value);
  }
  return declared;
}

/**
 * One document: page URLs (and their declared `<lastmod>`) from a `<urlset>`,
 * child references from a `<sitemapindex>`.
 */
export function parseSitemap(body: Buffer, contentType: string, limits: SitemapLimits) {
  const text = sitemapBytes(body, contentType, limits.maxDecodedBytes).toString('utf8');
  if (/<!ENTITY/iu.test(text)) throw new SitemapParseError('sitemap declares entities');
  if (XMLValidator.validate(text) !== true) throw new SitemapParseError('malformed sitemap XML');
  const document: Record<string, unknown> = parser.parse(text);
  const [rootName, root] = Object.entries(document).find(([key]) => !key.startsWith('?')) ?? [];
  const isIndex = rootName?.toLowerCase() === 'sitemapindex';
  const children = root && typeof root === 'object' ? (root as Record<string, unknown>) : {};
  const take = (entries: unknown) =>
    (Array.isArray(entries) ? entries : []).map(loc).filter(Boolean).slice(0, limits.maxUrls);
  // A `<sitemap>` entry is a reference whichever root it appears under.
  const refs = take(children.sitemap);
  const urls = isIndex ? [] : take(children.url);
  return {
    urls,
    lastmod: isIndex ? new Map<string, string>() : lastmods(children.url, limits.maxUrls),
    refs: isIndex ? [...refs, ...take(children.url)].slice(0, limits.maxUrls) : refs,
  };
}

/** A sitemap reference as one fetchable identity (WHATWG-normalized, no fragment), or null. */
export function sitemapRef(value: string) {
  try {
    const url = new URL(value.trim());
    url.hash = '';
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/** A bounded walk over one site's sitemap tree; it never fetches anything itself. */
export class SitemapCollector {
  readonly urls: string[] = [];
  /** Declared `<lastmod>` by collected URL, as the sitemap spells both. */
  readonly lastmod = new Map<string, string>();
  readonly #visited = new Set<string>();
  readonly limits: SitemapLimits;
  constructor(limits: SitemapLimits) {
    this.limits = limits;
  }
  /** Ingest one fetched document; return the unvisited child references still within depth. */
  add(source: string, body: Buffer, contentType: string, depth: number) {
    this.#visited.add(sitemapRef(source) ?? source);
    const document = parseSitemap(body, contentType, this.limits);
    const room = Math.max(0, this.limits.maxUrls - this.urls.length);
    const kept = document.urls.slice(0, room);
    this.urls.push(...kept);
    for (const url of kept) {
      const declared = document.lastmod.get(url);
      if (declared && !this.lastmod.has(url)) this.lastmod.set(url, declared);
    }
    if (depth >= this.limits.maxIndexDepth) return [];
    const refs = document.refs.flatMap((ref) => sitemapRef(ref) ?? []);
    return [...new Set(refs)].filter((ref) => !this.#visited.has(ref));
  }
}
