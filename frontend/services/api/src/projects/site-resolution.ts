import { policy } from '../config.ts';
import { extractPage, type PageEvidence } from './html-evidence.ts';
import { FetchError, fetchWebsite, websiteIdentity, type WebsiteFetcher } from './safe-fetch.ts';

export type ResolvedSite = {
  url: string;
  domain: string;
  page: PageEvidence | null;
  warning: string;
};
function resolvedPage(result: Awaited<ReturnType<WebsiteFetcher>>, domain: string): ResolvedSite {
  const final = websiteIdentity(result.url);
  if (final.domain !== domain) throw new FetchError('out_of_scope');
  const page =
    result.status >= 200 && result.status < 300 && final.url.startsWith('https:')
      ? extractPage(result.body, final.url)
      : null;
  const readable = page && (page.text || page.description) ? page : null;
  return { ...final, page: readable, warning: readable ? '' : 'research_degraded' };
}
function retainedError(error: unknown) {
  if (
    error instanceof FetchError &&
    ['out_of_scope', 'ssrf_blocked', 'invalid_url'].includes(error.code)
  )
    throw error;
  return error;
}
function oversized(error: unknown) {
  return error instanceof FetchError && error.code === 'response_too_large';
}
export async function resolveSite(
  value: string,
  fetcher: WebsiteFetcher = fetchWebsite,
): Promise<ResolvedSite> {
  const identity = websiteIdentity(value);
  const urls = [identity.url];
  if (identity.url.startsWith('https:')) urls.push(identity.url.replace(/^https:/u, 'http:'));
  const cfg = policy.brand_evidence;
  const signal = AbortSignal.timeout(cfg.total_timeout_seconds * 1000);
  const errors: unknown[] = [];
  for (const url of urls) {
    try {
      const result = await fetcher(url, {
        maxBytes: cfg.max_html_bytes,
        redirects: cfg.max_redirects,
        timeoutSeconds: cfg.request_timeout_seconds,
        contentTypes: cfg.content_types,
        domain: identity.domain,
        signal,
      });
      if (result.status === 404) continue;
      return resolvedPage(result, identity.domain);
    } catch (error) {
      errors.push(retainedError(error));
    }
  }
  const transient = errors.filter((error) => !oversized(error));
  if (transient.length) throw transient.at(-1);
  if (errors.length) return { ...identity, page: null, warning: 'research_degraded' };
  throw new FetchError('site_not_found');
}
