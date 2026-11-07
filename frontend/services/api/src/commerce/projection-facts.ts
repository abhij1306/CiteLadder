import { getDomain } from 'tldts';
import { z } from 'zod';
import { policy } from '../config.ts';
import { jsonObject, record, strings } from '../db/json.ts';
import { onlyOf } from '../lists.ts';
import { canonicalUrl } from '../site-health/url-identity.ts';

const texts = z.array(z.string()).default([]);
const link = z.looseObject({
  url: z.string().default(''),
  title: z.string().default(''),
  region: z.string().default(''),
});
const product = z.looseObject({
  name: texts,
  description: texts,
  brand: texts,
  price: z.array(z.union([z.string(), z.number()])).default([]),
  price_currency: texts,
  sku: texts,
  gtin: texts,
  mpn: texts,
  category: texts,
  availability: texts,
  variants: z.array(z.unknown()).default([]),
});
const commerce = z.looseObject({
  breadcrumbs: texts,
  breadcrumb_links: z.array(link).default([]),
  product_cards: z.array(link).default([]),
  visible_price: z.string().default(''),
  visible_price_context: z.string().default(''),
  category_role: z.string().default('unknown'),
});
const factsSchema = z.looseObject({
  title: z.string().default(''),
  meta_description: z.string().default(''),
  canonical_url: z.string().default(''),
  structured_data: z.looseObject({ product: product.prefault({}) }).prefault({}),
  commerce: commerce.prefault({}),
  headings: z.looseObject({ h1_texts: texts }).prefault({}),
  links: z.looseObject({ anchors: z.array(link).default([]) }).prefault({}),
});
export type CatalogFacts = z.output<typeof factsSchema>;
export const readFacts = (value: unknown): CatalogFacts =>
  factsSchema.parse(jsonObject(value, 'site_fetch_artifacts.normalized_facts'));
const indexNames = new Set<string>(policy.commerce.breadcrumb_index_names);
/** Category identity: `commerce_categories.normalized_name`. */
export const categoryKey = (name: string) => name.trim().toLowerCase().replaceAll(/\s+/gu, ' ');
/** The platform default (WooCommerce's "Uncategorized") names no category; a product without one has none. */
export const UNCATEGORIZED_KEY = 'uncategorized';
const named = (name: string) => /[\p{L}\p{N}]/u.test(name);
/** A name that identifies a real category. */
export const isCategoryName = (name: string) =>
  named(name) && categoryKey(name) !== UNCATEGORIZED_KEY && !indexNames.has(categoryKey(name));

// Private suffixes count: on a shared host (a.myshopify.com) another tenant is another site.
const site = (url: string) => getDomain(url, { allowPrivateDomains: true });

/**
 * The page's catalog URL in Site Health's identity (`site_urls.normalized_url`), so
 * shelves and products link by the same key; null when no public URL identifies it.
 */
export function pageIdentity(facts: CatalogFacts, base: string): string | null {
  const declared = facts.canonical_url ? canonicalUrl(facts.canonical_url, base) : null;
  const domain = site(base);
  return declared && domain && site(declared) === domain ? declared : canonicalUrl(base);
}

export function productAlias(value: string): string {
  const url = new URL(value);
  const [, path] = /^\/collections\/[^/]+(\/products\/[^/]+)\/?$/u.exec(url.pathname) ?? [];
  if (path === undefined) return '';
  url.pathname = path;
  url.search = '';
  return url.href;
}

function finitePrice(value: unknown): number | null {
  if ((typeof value !== 'string' && typeof value !== 'number') || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 999999999999.99 ? number : null;
}

/** Currency-qualified visible amounts; grouping must be unambiguous. */
export function localizedPrice(raw: string): number | null {
  const lastDot = raw.lastIndexOf('.');
  const lastComma = raw.lastIndexOf(',');
  const separator = lastDot > lastComma ? '.' : ',';
  const parts = raw.split(separator);
  const [integer, fraction] = parts;
  if (
    parts.length === 2 &&
    integer !== undefined &&
    fraction !== undefined &&
    /^\d{1,2}$/u.test(fraction)
  ) {
    const groups = integer.split(separator === '.' ? ',' : '.');
    if (groups.length > 1 && !validGroups(groups)) return null;
    return finitePrice(`${groups.join('')}.${fraction}`);
  }
  if (parts.length > 1) return validGroups(parts) ? finitePrice(parts.join('')) : null;
  return /^\d+$/u.test(raw) ? finitePrice(raw) : null;
}
function validGroups(groups: string[]): boolean {
  const [head, ...rest] = groups;
  return (
    head !== undefined && /^\d{1,3}$/u.test(head) && rest.every((group) => /^\d{3}$/u.test(group))
  );
}
const markerSource = policy.commerce.price_markers
  .map(([marker]) => marker!.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`))
  .join('|');
const visiblePattern = new RegExp(markerSource, 'giu');

function adjacentAmount(text: string, start: number, direction: 1 | -1): string {
  let index = start;
  while (index >= 0 && index < text.length && /\s/u.test(text[index]!)) index += direction;
  const boundary = index;
  while (index >= 0 && index < text.length && /[\d,.]/u.test(text[index]!)) index += direction;
  return direction === 1 ? text.slice(boundary, index) : text.slice(index + 1, boundary + 1);
}

function visiblePrice(facts: CatalogFacts) {
  const { visible_price: text, visible_price_context: context } = facts.commerce;
  const surrounding = `${text} ${context}`.toLowerCase();
  if (policy.commerce.ambiguous_price_tokens.some((token) => surrounding.includes(token)))
    return { price: null, currency: '' };
  const amounts = [...text.matchAll(visiblePattern)].flatMap((match) => {
    const marker = match[0].toUpperCase();
    return [
      adjacentAmount(text, match.index + match[0].length, 1),
      adjacentAmount(text, match.index - 1, -1),
    ]
      .filter(Boolean)
      .map((amount) => ({ marker, amount }));
  });
  const only = onlyOf(amounts);
  if (!only) return { price: null, currency: '' };
  const { marker, amount } = only;
  return {
    price: localizedPrice(amount),
    currency:
      policy.commerce.price_markers.find(([value]) => value!.toUpperCase() === marker)?.[1] ?? '',
  };
}

/** The product fields a page projects, each with its own provenance. */
export const PRODUCT_FIELDS = [
  'canonical_url',
  'name',
  'description',
  'brand',
  'price',
  'currency',
  'sku',
  'gtin',
  'mpn',
  'variants',
  'attributes',
] as const;
type ProductField = (typeof PRODUCT_FIELDS)[number];

export function productFacts(facts: CatalogFacts, url: string) {
  const p = facts.structured_data.product;
  const structuredPrice = finitePrice(p.price[0]);
  const visible = visiblePrice(facts);
  const price = structuredPrice ?? visible.price;
  const currency = p.price_currency[0] || visible.currency;
  const evidencePaths: Record<string, string> = {};
  if (price !== null)
    evidencePaths.price =
      structuredPrice === null ? 'commerce.visible_price' : 'structured_data.product.price';
  if (currency)
    evidencePaths.currency = p.price_currency[0]
      ? 'structured_data.product.price_currency'
      : 'commerce.visible_price';
  const values = {
    canonical_url: url,
    name: p.name[0] || facts.headings.h1_texts[0] || facts.title,
    description: p.description[0] || facts.meta_description,
    brand: p.brand[0] || '',
    price,
    currency,
    sku: p.sku[0] || '',
    gtin: p.gtin[0] || '',
    mpn: p.mpn[0] || '',
    variants: p.variants,
    attributes: p.availability.length ? { availability: p.availability } : {},
  } satisfies Record<ProductField, unknown>;
  return {
    values,
    evidencePaths,
    identified: Boolean(values.sku || values.gtin || values.mpn || (values.name && price !== null)),
  };
}

export function categoryTitle(facts: CatalogFacts, fallback: string): string {
  const crumb = facts.commerce.breadcrumbs.findLast(isCategoryName);
  const heading = facts.headings.h1_texts.find(isCategoryName);
  const title = (facts.title || fallback).split(/\||–|—|·|»| - /u)[0]!.trim();
  return (crumb || heading || (isCategoryName(title) ? title : '')).trim().slice(0, 255);
}

export function productCategories(facts: CatalogFacts, url: string, aliases: string[]): string[] {
  const crumbs = facts.commerce.breadcrumbs
    .map((value) => value.trim().replaceAll(/\s+/gu, ' '))
    .filter(named);
  const ownUrls = new Set([url, ...aliases].flatMap((value) => canonicalUrl(value) ?? []));
  const base = aliases.find(Boolean) || url;
  let cursor = 0;
  const linked = new Set<number>();
  for (const link of facts.commerce.breadcrumb_links) {
    const position = crumbs.findIndex(
      (crumb, index) => index >= cursor && categoryKey(crumb) === categoryKey(link.title),
    );
    if (position < 0) continue;
    cursor = position + 1;
    const target = canonicalUrl(link.url, base);
    if (target && !ownUrls.has(target) && !ownUrls.has(productAlias(target))) linked.add(position);
  }
  const ancestors = crumbs.slice(1, linked.has(crumbs.length - 1) ? undefined : -1);
  return [...new Set([...facts.structured_data.product.category, ...ancestors])].filter(
    (name) => isCategoryName(name) && !indexNames.has(categoryKey(name)),
  );
}

export function shelfLinks(facts: CatalogFacts, base: string): string[] {
  const cards = facts.commerce.product_cards.filter((link) => link.url.trim());
  const links = cards.length ? cards : facts.links.anchors.filter((link) => link.region === 'main');
  return [...new Set(links.flatMap((link) => canonicalUrl(link.url, base) ?? []))];
}

const CATALOG_MODELS = new Set<string>(policy.discovery.constants.commerce_business_models);
const KNOWN_MODELS = new Set<string>(policy.discovery.constants.business_models);

/**
 * Whether crawled pages project into the catalog for this brand: `applicable`
 * when its confirmed business model, primary or secondary, sells a catalog;
 * `not_applicable` when a recognized primary model does not; `unknown` when no
 * recognized model is confirmed, which is never reported as not applicable.
 */
export function catalogApplicability(
  businessContext: unknown,
): 'applicable' | 'not_applicable' | 'unknown' {
  const context = record(businessContext);
  const models = [context.business_model, ...strings(context.secondary_business_models)];
  if (models.some((model) => typeof model === 'string' && CATALOG_MODELS.has(model)))
    return 'applicable';
  const primary = context.business_model;
  return typeof primary === 'string' && KNOWN_MODELS.has(primary) ? 'not_applicable' : 'unknown';
}

/** Whether a brand's confirmed business model, primary or secondary, sells a catalog. Unknown fails closed. */
export function sellsCatalog(businessContext: unknown): boolean {
  return catalogApplicability(businessContext) === 'applicable';
}
