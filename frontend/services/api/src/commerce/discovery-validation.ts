/** Target-aware candidate filtering over shared Site Health facts and classification. */
import type { CommerceTarget } from '@citeladder/contracts/commerce-suite';
import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { record } from '../db/json.ts';
import type { FetchedPage } from '../projects/safe-fetch.ts';
import { canonicalUrl } from '../site-health/url-identity.ts';
import { extractPageFacts } from '../site-health/analysis/facts.ts';
import { classify } from '../site-health/analysis/page-kinds.ts';
import type { SearchResult } from './discovery-provider.ts';

const p = policy.commerce.discovery;
const editorial = p.editorial_patterns.map((pattern) => new RegExp(pattern, 'iu'));
export const contextText = (value: unknown) => (typeof value === 'string' ? value : '');
function competitorHost(value: string) {
  try {
    return new URL(value.includes('://') ? value : `https://${value}`).hostname
      .toLowerCase()
      .replace(/^www\./u, '')
      .replace(/\.$/u, '');
  } catch {
    return '';
  }
}
/** The business's own hosts: its website and every owned domain. */
export async function ownedHosts(db: Database, scope: { workspaceId: string; projectId: string }) {
  const project = await db
    .selectFrom('projects')
    .select('website_url')
    .where('workspace_id', '=', scope.workspaceId)
    .where('id', '=', scope.projectId)
    .executeTakeFirstOrThrow();
  const domains = await db
    .selectFrom('owned_domains as d')
    .innerJoin('projects as p', 'p.id', 'd.project_id')
    .select('d.domain')
    .where('p.workspace_id', '=', scope.workspaceId)
    .where('d.project_id', '=', scope.projectId)
    .execute();
  return [project.website_url, ...domains.map((row) => row.domain)]
    .map(competitorHost)
    .filter(Boolean);
}
const belongs = (host: string, domains: readonly string[]) =>
  domains.some((domain) => domain && (host === domain || host.endsWith(`.${domain}`)));
export function exclusion(url: string, title: string, owned: readonly string[]) {
  const host = competitorHost(url),
    text = `${url} ${title}`.toLowerCase();
  if (belongs(host, owned)) return 'excluded_owned_domain';
  if (belongs(host, p.excluded_hosts)) return 'excluded_marketplace';
  if (
    p.excluded_paths.some((token) => text.includes(token)) ||
    editorial.some((pattern) => pattern.test(text))
  )
    return 'excluded_editorial';
  if (p.second_hand_tokens.some((token) => text.includes(token))) return 'excluded_incompatible';
  return '';
}
export function searchableName(name: string) {
  const clean = name.trim().replace(/\s+/gu, ' ');
  return clean.length >= 2 && !/[|–—»]/u.test(clean) && clean.split(' ').length <= p.name_max_words;
}
export function discoveryQuery(target: CommerceTarget, context: Record<string, unknown>) {
  const name = contextText(context.name);
  if (target.kind === 'category') return `buy ${name} online store`;
  const attributes = record(context.attributes);
  const type = ['product_type', 'type', 'category']
    .map((key) => attributes[key])
    .find((value) => typeof value === 'string' && value.trim());
  const details = Object.entries(attributes)
    .filter(
      ([key, value]) =>
        !['product_type', 'type', 'category', 'availability'].includes(key) &&
        (typeof value === 'string' || typeof value === 'number'),
    )
    .map(([, value]) => String(value).trim())
    .filter(Boolean)
    .slice(0, p.query_attribute_limit);
  const price = context.price;
  const band =
    typeof price === 'number' && Number.isFinite(price) && price >= 0
      ? p.price_bands.find(([ceiling]) => ceiling === null || price < Number(ceiling))?.[1]
      : '';
  const qualifiers = [
    type,
    ...details,
    band
      ? `price ${contextText(context.currency).toUpperCase()} ${band}`.replace(/\s+/gu, ' ')
      : '',
  ]
    .filter(Boolean)
    .join(' ');
  return ['buy', name, qualifiers, 'online store'].filter(Boolean).join(' ');
}
export function prepareResults(results: SearchResult[], owned: readonly string[]) {
  const seen = new Set<string>();
  return results.slice(0, p.provider_result_limit).map((item) => {
    const url = canonicalUrl(item.url);
    let outcome = '';
    if (!item.url.trim() || !item.title.trim()) outcome = 'excluded_missing_identity';
    else if (!url) outcome = 'excluded_invalid_url';
    else outcome = exclusion(url, item.title, owned);
    if (!outcome && url) {
      outcome = seen.has(url) ? 'excluded_duplicate' : '';
      seen.add(url);
    }
    return { ...item, canonical: url, validation_outcome: outcome };
  });
}
export function verifyPage(
  page: FetchedPage,
  kind: CommerceTarget['kind'],
  owned: readonly string[],
) {
  if (
    page.status < 200 ||
    page.status >= 400 ||
    !page.contentType.startsWith('text/html') ||
    exclusion(page.url, '', owned)
  )
    return false;
  const facts = extractPageFacts(page.body, {
    finalUrl: page.url,
    contentType: page.contentType,
    charset: page.charset,
    statusCode: page.status,
  });
  const assessment = classify(page.url, facts);
  if (!p.page_kinds[kind].includes(assessment.page_kind)) return false;
  if (kind === 'category') return true;
  const product = record(record(facts.structured_data).product);
  return (
    ['name', 'sku', 'gtin', 'mpn'].some(
      (key) => Array.isArray(product[key]) && product[key].length > 0,
    ) || Boolean(facts.title && record(facts.commerce).visible_price)
  );
}
