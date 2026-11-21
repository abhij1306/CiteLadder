import { describe, expect, it } from 'vite-plus/test';
import {
  docsContentSecurityPolicy,
  marketingContentSecurityPolicy,
} from './content-security-policy';
import { cspScriptHash } from './csp-hash';
import { SPECULATION_RULES, SPECULATION_RULES_JSON } from './speculation-rules';

type Predicate =
  | { and: readonly Predicate[] }
  | { not: Predicate }
  | { href_matches: string }
  | { selector_matches: string };

const PAGE = 'https://citeladder.com/platform';

function matches(predicate: Predicate, link: HTMLAnchorElement): boolean {
  if ('and' in predicate) return predicate.and.every((part) => matches(part, link));
  if ('not' in predicate) return !matches(predicate.not, link);
  if ('href_matches' in predicate)
    return new URLPattern(predicate.href_matches, PAGE).test(link.href);
  return link.matches(predicate.selector_matches);
}

function prefetched(href: string, attributes: Record<string, string> = {}) {
  const link = document.createElement('a');
  link.href = new URL(href, PAGE).href;
  for (const [name, value] of Object.entries(attributes)) link.setAttribute(name, value);
  return SPECULATION_RULES.prefetch.some((rule) => matches(rule.where, link));
}

describe('speculation rules', () => {
  it('prefetch same-origin pages but never the API, machine routes or other origins', () => {
    expect(prefetched('/platform/site-health')).toBe(true);
    expect(prefetched('/blog/ai-search?ref=nav')).toBe(true);
    expect(prefetched('/api/v1/contact')).toBe(false);
    expect(prefetched('/api')).toBe(false);
    expect(prefetched('/v1/runs')).toBe(false);
    expect(prefetched('https://app.citeladder.com/login')).toBe(false);
    expect(prefetched('/terms', { rel: 'nofollow' })).toBe(false);
    expect(prefetched('/report.pdf', { download: '' })).toBe(false);
  });

  it('are allowed by the website and docs CSP through the hash of their exact text', async () => {
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(SPECULATION_RULES_JSON),
    );
    const hash = `sha256-${Buffer.from(digest).toString('base64')}`;
    const policies = [
      marketingContentSecurityPolicy({
        analyticsEnabled: false,
        scriptHashes: [cspScriptHash(SPECULATION_RULES_JSON)],
      }),
      docsContentSecurityPolicy([cspScriptHash(SPECULATION_RULES_JSON)]),
    ];
    for (const policy of policies) {
      expect(typeof policy === 'object' && policy.scriptDirective?.hashes).toEqual([hash]);
      // Prerendered pages carry these as a <meta>, where frame-ancestors is ignored and logged.
      const frameDirectives =
        typeof policy === 'object'
          ? policy.directives
              ?.filter((directive) => directive.startsWith('frame-'))
              .map((directive) => directive.split(' ')[0])
          : [];
      expect(frameDirectives).toEqual(['frame-src']);
    }
  });
});
