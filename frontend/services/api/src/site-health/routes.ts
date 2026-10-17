/** URL evidence uses the same config-owned catalog for owned and external pages. */
import { policy } from '../config.ts';
import { stripLeading, stripTrailing } from '../text-order.ts';

const MAX_PATH_CHARS = policy.site_health.page_analysis.facts.limits.path_chars;
const slugPatterns = policy.site_health.slug_patterns.map(
  ([kind, pattern]) => [kind!, new RegExp(pattern!)] as const,
);
const HOMEPAGE_PATHS = new Set(policy.site_health.homepage_paths);
const LOCALE_ROOT = new RegExp(policy.site_health.homepage_locale_root_pattern, 'u');

/** A site root: the bare root, a known index file or language root, or any region-qualified locale root (`/en-in`, `/es-419`). */
export const isHomepagePath = (path: string) => HOMEPAGE_PATHS.has(path) || LOCALE_ROOT.test(path);

const routePatterns = policy.site_health.route_patterns.map(
  ([kind, pattern]) => [kind!, new RegExp(pattern!, 'd')] as const,
);

const DOCUMENT_EXTENSION = new RegExp(
  String.raw`\.(?:${policy.site_health.route_document_extensions.join('|')})$`,
  'u',
);

/**
 * The lower-cased path without trailing slashes or a server-page extension
 * (`/pricing.html` is `/pricing`); the root is `''`. Shared by Site Health
 * classification and source-page assessment.
 */
export const normalizedPath = (url: URL) =>
  stripTrailing(url.pathname.slice(0, MAX_PATH_CHARS).toLowerCase(), '/').replace(
    DOCUMENT_EXTENSION,
    '',
  );

/** An absolute http(s) URL with a host, or null: only those have a path to reason about. */
export function documentUrl(value: string): URL | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  return policy.web_fetch.schemes.includes(url.protocol.slice(0, -1)) && url.hostname ? url : null;
}

/**
 * The route a path names: a shape inside the slug (`/blog/a-vs-b`) wins over
 * the semantic segment nearest the root; config order breaks ties.
 */
export function routeSignal(path: string): { kind: string; pattern: string } | null {
  const slug = stripLeading(stripTrailing(path.replaceAll(/[/_+.]+/gu, '-'), '-'), '-').replaceAll(
    /-{2,}/gu,
    '-',
  );
  if (slug)
    for (const [kind, pattern] of slugPatterns)
      if (pattern.test(slug)) return { kind, pattern: pattern.source };
  let best: { kind: string; pattern: string; position: number } | null = null;
  for (const [kind, pattern] of routePatterns) {
    const position = pattern.exec(path)?.indices?.[1]?.[0];
    if (position !== undefined && (!best || position < best.position))
      best = { kind, pattern: pattern.source, position };
  }
  return best && { kind: best.kind, pattern: best.pattern };
}

export function routePageKind(value: string): string | null {
  const url = documentUrl(value);
  if (!url) return null;
  const path = normalizedPath(url);
  if (isHomepagePath(path)) return 'homepage';
  return routeSignal(path)?.kind ?? null;
}
