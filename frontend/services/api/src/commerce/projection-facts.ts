import { getDomain } from 'tldts';
import { policy } from '../config.ts';
import { jsonObject, record, strings } from '../db/json.ts';
import { onlyOf } from '../lists.ts';
import { catalogFactsSchema, type CatalogFacts } from '../site-health/analysis/catalog-facts.ts';
import { canonicalUrl } from '../site-health/url-identity.ts';

export const readFacts = (value: unknown): CatalogFacts =>
  catalogFactsSchema.parse(jsonObject(value, 'site_fetch_artifacts.normalized_facts'));
const indexNames = new Set<string>(policy.commerce.breadcrumb_index_names);
export const categoryKey = (name: string) => name.trim().toLowerCase().replaceAll(/\s+/gu, ' ');
export const UNCATEGORIZED_KEY = 'uncategorized';
const named = (name: string) => /[\p{L}\p{N}]/u.test(name);
export const isCategoryName = (name: string) =>
  named(name) && categoryKey(name) !== UNCATEGORIZED_KEY && !indexNames.has(categoryKey(name));

const site = (url: string) => getDomain(url, { allowPrivateDomains: true });

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

const GROUPING_MARKS = String.fromCodePoint(0xa0, 0x2009, 0x202f, 0x27, 0x2019);
export const AMOUNT_CHARACTERS = String.raw`\d,.` + GROUPING_MARKS;
const GROUPING_MARK = new RegExp(`[${GROUPING_MARKS}]`, 'u');
const isAmountPunctuation = (char: string) =>
  char === ',' || char === '.' || GROUPING_MARKS.includes(char);

function withoutTrailingPunctuation(raw: string): string {
  let end = raw.length;
  while (end > 0 && isAmountPunctuation(raw.charAt(end - 1))) end -= 1;
  return raw.slice(0, end);
}

export function localizedPrice(raw: string): number | null {
  const amount = withoutTrailingPunctuation(raw);
  if (GROUPING_MARK.test(amount)) return markGroupedPrice(amount);
  const lastDot = amount.lastIndexOf('.');
  const lastComma = amount.lastIndexOf(',');
  const separator = lastDot > lastComma ? '.' : ',';
  const parts = amount.split(separator);
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
  return /^\d+$/u.test(amount) ? finitePrice(amount) : null;
}
function markGroupedPrice(amount: string): number | null {
  const [, integer, fraction] = /^([^,.]+)(?:[,.](\d{1,2}))?$/u.exec(amount) ?? [];
  if (integer === undefined) return null;
  const groups = integer.split(GROUPING_MARK);
  if (!validGroups(groups)) return null;
  const digits = groups.join('');
  return finitePrice(fraction === undefined ? digits : `${digits}.${fraction}`);
}
function validGroups(groups: string[]): boolean {
  const [head, ...rest] = groups;
  if (head === undefined || !rest.length) return false;
  if (/^\d{1,3}$/u.test(head) && rest.every((group) => /^\d{3}$/u.test(group))) return true;
  return (
    /^\d{1,2}$/u.test(head) &&
    rest.every((group, index) => /^\d{2}$/u.test(group) || index === rest.length - 1) &&
    /^\d{3}$/u.test(rest.at(-1) ?? '')
  );
}
const markerSource = policy.commerce.price_markers
  .map(([marker]) => marker!.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`))
  .join('|');
const visiblePattern = new RegExp(markerSource, 'giu');

const amountCharacter = new RegExp(`[${AMOUNT_CHARACTERS}]`, 'u');

function adjacentAmount(text: string, start: number, direction: 1 | -1): string {
  let index = start;
  while (index >= 0 && index < text.length && /\s/u.test(text[index]!)) index += direction;
  const boundary = index;
  while (index >= 0 && index < text.length && amountCharacter.test(text[index]!))
    index += direction;
  return direction === 1 ? text.slice(boundary, index) : text.slice(index + 1, boundary + 1);
}

function visiblePrice(facts: CatalogFacts) {
  const { visible_price: text, visible_price_context: context = '' } = facts.commerce;
  const surrounding = `${text} ${context}`.toLowerCase();
  if (policy.commerce.ambiguous_price_tokens.some((token) => surrounding.includes(token)))
    return { price: null, currency: '' };
  const amounts = [...text.matchAll(visiblePattern)].flatMap((match) => {
    const marker = match[0].toUpperCase();
    return [
      adjacentAmount(text, match.index + match[0].length, 1),
      adjacentAmount(text, match.index - 1, -1),
    ]
      .filter((amount) => /\d/u.test(amount))
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

export function breadcrumbParent(facts: CatalogFacts, name: string): string {
  const crumbs = facts.commerce.breadcrumbs.filter(
    (crumb) => isCategoryName(crumb) && !indexNames.has(categoryKey(crumb)),
  );
  const position = crumbs.findLastIndex((crumb) => categoryKey(crumb) === categoryKey(name));
  return position > 0 ? crumbs[position - 1]!.trim().replaceAll(/\s+/gu, ' ').slice(0, 255) : '';
}

export function productCategories(facts: CatalogFacts, url: string, aliases: string[]) {
  const path = breadcrumbPath(facts, url, aliases);
  return {
    names: [...new Set([...facts.structured_data.product.category, ...path])].filter(
      (name) => isCategoryName(name) && !indexNames.has(categoryKey(name)),
    ),
    path,
  };
}

function breadcrumbPath(facts: CatalogFacts, url: string, aliases: string[]): string[] {
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
  return crumbs
    .slice(1, linked.has(crumbs.length - 1) ? undefined : -1)
    .filter((name) => isCategoryName(name) && !indexNames.has(categoryKey(name)));
}

export function shelfLinks(facts: CatalogFacts, base: string): string[] {
  const cards = facts.commerce.product_cards.filter((link) => link.url.trim());
  const links = cards.length ? cards : facts.links.anchors.filter((link) => link.region === 'main');
  return [...new Set(links.flatMap((link) => canonicalUrl(link.url, base) ?? []))];
}

const CATALOG_MODELS = new Set<string>(policy.discovery.constants.commerce_business_models);
const KNOWN_MODELS = new Set<string>(policy.discovery.constants.business_models);

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

export function sellsCatalog(businessContext: unknown): boolean {
  return catalogApplicability(businessContext) === 'applicable';
}
