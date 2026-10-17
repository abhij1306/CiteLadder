/** Robots meta and X-Robots-Tag directives, keeping snippet controls distinct. */
import { attribute, elements, type HtmlNode } from '../../web-evidence/html.ts';
import { compareText } from '../../text-order.ts';
import { analysisPolicy } from './policy.ts';

const HEADER_AGENTS = new Set(analysisPolicy.facts.search_robots_header_agents);
const COLON_DIRECTIVES = new Set([
  'max-snippet',
  'max-image-preview',
  'max-video-preview',
  'unavailable_after',
]);
export type RobotsDirectives = {
  noindex: boolean;
  nofollow: boolean;
  nosnippet?: boolean;
  max_snippet?: number | null;
  directives?: string[];
};

const tokens = (value: string) =>
  value
    .split(',')
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);

/** Header directives; an agent prefix scopes the following ones to that agent. */
function headerTokens(value: string) {
  const directives = new Set<string>();
  let applies = true;
  for (const token of tokens(value)) {
    const colon = token.indexOf(':');
    const prefix = colon === -1 ? token : token.slice(0, colon);
    if (colon !== -1 && !COLON_DIRECTIVES.has(prefix)) {
      applies = HEADER_AGENTS.has(prefix);
      const payload = token.slice(colon + 1).trim();
      if (applies && payload) directives.add(payload);
      continue;
    }
    if (applies) directives.add(token);
  }
  return directives;
}

/** The tightest snippet length; `-1` (no limit) stays distinct from unset. */
function snippetLimit(values: number[]) {
  const bounded = values.filter((value) => value >= 0);
  if (bounded.length) return Math.min(...bounded);
  return values.includes(-1) ? -1 : null;
}
function maxSnippet(found: Set<string>) {
  const values: number[] = [];
  for (const token of found) {
    if (!token.startsWith('max-snippet:')) continue;
    const raw = token.slice('max-snippet:'.length).trim();
    if (/^[+-]?\d+$/u.test(raw)) values.push(Number(raw));
  }
  return snippetLimit(values);
}
function projection(found: Set<string>) {
  return {
    noindex: found.has('noindex') || found.has('none'),
    nofollow: found.has('nofollow') || found.has('none'),
    nosnippet: found.has('nosnippet'),
    max_snippet: maxSnippet(found),
    directives: [...found].sort(compareText).slice(0, 32),
  };
}

export function robotsMeta(root: HtmlNode) {
  const found = new Set<string>();
  for (const meta of elements(root, 'meta'))
    if (['robots', 'googlebot'].includes(attribute(meta, 'name').toLowerCase()))
      for (const token of tokens(attribute(meta, 'content'))) found.add(token);
  return projection(found);
}

export function mergeRobotsHeader(meta: RobotsDirectives, header: string) {
  const fromHeader = headerTokens(header);
  const merged = projection(new Set([...(meta.directives ?? []), ...fromHeader]));
  const headerOnly = projection(fromHeader);
  const snippets = [meta.max_snippet, headerOnly.max_snippet].filter(
    (value): value is number => typeof value === 'number',
  );
  return {
    ...merged,
    noindex: meta.noindex || headerOnly.noindex,
    nofollow: meta.nofollow || headerOnly.nofollow,
    nosnippet: Boolean(meta.nosnippet) || headerOnly.nosnippet,
    max_snippet: snippetLimit(snippets),
  };
}
