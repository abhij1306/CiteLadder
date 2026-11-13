/**
 * Catalog sources (commerce improvement PR 6, CM3): the CSV template, a
 * Merchant Center feed file and a Shopify storefront's `products.json`, each
 * parsed into the same catalog items that the one admission path
 * (`import.ts`) writes. Pure: no database, no network.
 *
 * A row that cannot become a product is a `rejected` item with its reason; a
 * file that cannot be read at all is refused as a whole (422).
 */
import { CATALOG_TEMPLATE_REQUIRED } from '@citeladder/contracts/commerce-requests';
import type {
  CatalogCategoryProposal,
  CatalogImportStage,
} from '@citeladder/contracts/commerce-suite';
import { parse } from 'csv-parse/sync';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { z } from 'zod';

import { policy } from '../config.ts';
import { record } from '../db/json.ts';
import { ApiError } from '../errors.ts';
import { groupBy, type NonEmpty } from '../lists.ts';
import { canonicalUrl } from '../site-health/url-identity.ts';
import { fragmentText } from '../web-evidence/html.ts';
import { categoryKey, isCategoryName } from './projection-facts.ts';

export type CatalogFormat = CatalogImportStage['source_format'];
const limits = policy.commerce.catalog_sources;

const amount = z.number().nonnegative().max(999999999999.99);
/** One product's catalog fields, as every source supplies them. */
export const catalogValuesSchema = z
  .object({
    canonical_url: z
      .url()
      .refine((value) => canonicalUrl(value) !== null, 'Unsupported product URL'),
    name: z.string().max(512),
    description: z.string().max(policy.commerce.edit.description_max_chars),
    brand: z.string().max(255),
    price: amount,
    price_max: amount,
    currency: z.string().regex(/^[A-Z]{3}$/u, 'Currency must be a three-letter code'),
    sku: z.string().max(255),
    gtin: z.string().max(64),
    mpn: z.string().max(255),
    image_url: z.url({ protocol: /^https?$/u }).max(2048),
  })
  .partial();
export type CatalogValues = z.output<typeof catalogValuesSchema>;

/** One sellable variant of a product, as its source listed it. */
export type CatalogVariant = {
  title: string;
  sku: string;
  gtin: string;
  price: number | null;
  url: string;
};

/** A category path, top first; each segment is a category name. */
export type CategoryPath = readonly string[];

export type CatalogItem =
  | {
      kind: 'item';
      row_number: number;
      values: CatalogValues;
      variants: CatalogVariant[];
      paths: CategoryPath[];
    }
  | { kind: 'rejected'; row_number: number; detail: string };

class RowError extends Error {}

function refuse(message: string): never {
  throw new ApiError(422, message, { code: 'commerce_invalid' });
}

const text = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
};

/**
 * A price as feeds write it: `59.00`, `59.00 EUR` or `EUR 59.00`. Thousands
 * separators and currency symbols are ambiguous and refused, never guessed.
 */
export function parsePrice(value: string): { amount: number; currency: string } {
  const match = /^(?:([A-Z]{3})\s+)?(\d{1,12}(?:\.\d{1,2})?)(?:\s+([A-Z]{3}))?$/u.exec(
    value.trim().toUpperCase(),
  );
  if (!match)
    throw new RowError(
      `Price "${value.slice(0, 40)}" is not a number with an optional currency code`,
    );
  const [, before, number, after] = match;
  if (before && after && before !== after) throw new RowError('Price names two currencies');
  return { amount: Number(number), currency: before ?? after ?? '' };
}

/** `A > B` into its category names; empty segments and non-names are dropped. */
function categoryPath(value: string): CategoryPath {
  const segments = value
    .split('>')
    .map((segment) => segment.trim().replaceAll(/\s+/gu, ' '))
    .filter(isCategoryName);
  if (segments.some((segment) => segment.length > 255))
    throw new RowError('A category name is longer than 255 characters');
  if (segments.length > limits.category_depth_max)
    throw new RowError(`A category path is deeper than ${limits.category_depth_max} levels`);
  return segments;
}

/** Distinct non-empty paths, in first-seen order. */
function pathsOf(values: readonly string[]): CategoryPath[] {
  const paths = new Map<string, CategoryPath>();
  for (const path of values.map(categoryPath))
    if (path.length) paths.set(path.map(categoryKey).join(' > '), path);
  return [...paths.values()];
}

function validValues(values: Record<string, unknown>): CatalogValues {
  const present = Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== '' && value !== undefined),
  );
  const parsed = catalogValuesSchema.safeParse(present);
  if (!parsed.success)
    throw new RowError(
      parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
    );
  const url = parsed.data.canonical_url;
  return url ? { ...parsed.data, canonical_url: canonicalUrl(url) ?? url } : parsed.data;
}

function rowItem(
  rowNumber: number,
  build: () => Omit<Extract<CatalogItem, { kind: 'item' }>, 'kind' | 'row_number'>,
): CatalogItem {
  try {
    return { kind: 'item', row_number: rowNumber, ...build() };
  } catch (error) {
    if (!(error instanceof RowError)) throw error;
    return { kind: 'rejected', row_number: rowNumber, detail: error.message.slice(0, 500) };
  }
}

/** A delimited file's records by lower-cased header (`g:` prefixes dropped). */
function delimitedRecords(content: string): { header: string[]; rows: Record<string, string>[] } {
  const delimiter = (content.split('\n', 1)[0] ?? '').includes('\t') ? '\t' : ',';
  let rows: string[][];
  try {
    rows = parse(content, {
      bom: true,
      delimiter,
      skip_empty_lines: true,
      relax_column_count: true,
      max_record_size: policy.commerce.import_max_bytes,
    }) as string[][];
  } catch {
    refuse(delimiter === '\t' ? 'Invalid tab-separated file' : 'Invalid comma-separated file');
  }
  const header = (rows.shift() ?? []).map((name) => name.trim().toLowerCase().replace(/^g:/u, ''));
  if (new Set(header).size !== header.length) refuse('The header repeats a column');
  return {
    header,
    rows: rows.map((row) =>
      Object.fromEntries(header.map((name, index) => [name, (row[index] ?? '').trim()])),
    ),
  };
}

function boundedRows<T>(rows: T[]): T[] {
  if (!rows.length) refuse('The file has no products');
  if (rows.length > policy.commerce.import_max_rows)
    refuse(`The file has more than ${policy.commerce.import_max_rows} products`);
  return rows;
}

/** The CSV template: `title` and `brand` required, the other columns optional. */
function parseTemplate(content: string): CatalogItem[] {
  const { header, rows } = delimitedRecords(content);
  const missing = CATALOG_TEMPLATE_REQUIRED.filter((name) => !header.includes(name));
  if (missing.length) refuse(`The CSV template needs these columns: ${missing.join(', ')}`);
  return boundedRows(rows).map((row, index) =>
    rowItem(index + 2, () => {
      for (const name of CATALOG_TEMPLATE_REQUIRED)
        if (!row[name]) throw new RowError(`${name} is required`);
      const price = row.price ? parsePrice(row.price) : null;
      if (price?.currency && row.currency && price.currency !== row.currency.toUpperCase())
        throw new RowError('price and currency name different currencies');
      return {
        values: validValues({
          name: row.title,
          brand: row.brand,
          description: row.description,
          price: price?.amount,
          currency: (row.currency || price?.currency || '').toUpperCase(),
          canonical_url: row.link,
          image_url: row.image_link,
          sku: row.sku,
          gtin: row.gtin,
        }),
        variants: [],
        paths: pathsOf((row.category ?? '').split('|')),
      };
    }),
  );
}

/** One Merchant Center item, by Google's field names. */
type FeedItem = { row_number: number; fields: Record<string, string>; product_types: string[] };

const xml = new XMLParser({
  ignoreAttributes: true,
  ignoreDeclaration: true,
  ignorePiTags: true,
  removeNSPrefix: true,
  parseTagValue: false,
  htmlEntities: true,
  isArray: (name) => name === 'item' || name === 'entry' || name === 'product_type',
});

/**
 * An XML field's text. A repeated tag (an Atom entry's `<link href>` beside
 * its `g:link`, both `link` without their prefix) gives its first text.
 */
const xmlText = (value: unknown): string =>
  Array.isArray(value) ? (value.map(text).find(Boolean) ?? '') : text(value);

function xmlFeed(content: string): FeedItem[] {
  if (XMLValidator.validate(content) !== true) refuse('Invalid XML feed');
  const document = record(xml.parse(content));
  const items = record(record(document.rss).channel).item ?? record(document.feed).entry;
  if (!Array.isArray(items)) refuse('The XML feed has no items');
  return items.map((item, index) => {
    const fields = record(item);
    const types = fields.product_type;
    return {
      row_number: index + 1,
      fields: Object.fromEntries(
        Object.entries(fields).map(([key, value]) => [key, xmlText(value)]),
      ),
      product_types: Array.isArray(types) ? types.map(text) : [],
    };
  });
}

/** Content API JSON (`offerId`, `price: {value, currency}`) or Google's snake_case names. */
function jsonFeed(content: string): FeedItem[] {
  let document: unknown;
  try {
    document = JSON.parse(content);
  } catch {
    refuse('Invalid JSON feed');
  }
  const list = Array.isArray(document)
    ? document
    : (record(document).products ?? record(document).resources ?? record(document).items);
  if (!Array.isArray(list)) refuse('The JSON feed has no products');
  const snake = (key: string) => key.replaceAll(/[A-Z]/gu, (letter) => `_${letter.toLowerCase()}`);
  return list.map((entry, index) => {
    const fields: Record<string, string> = {};
    let productTypes: string[] = [];
    for (const [key, value] of Object.entries(record(entry))) {
      const name = snake(key) === 'offer_id' ? 'id' : snake(key);
      if (name === 'product_types' || name === 'product_type')
        productTypes = (Array.isArray(value) ? value : [value]).map(text).filter(Boolean);
      else if (name === 'price' && typeof value === 'object' && value !== null)
        fields.price = `${text(record(value).value)} ${text(record(value).currency)}`.trim();
      else fields[name] = text(value);
    }
    return { row_number: index + 1, fields, product_types: productTypes };
  });
}

function delimitedFeed(content: string): FeedItem[] {
  return delimitedRecords(content).rows.map((fields, index) => ({
    row_number: index + 2,
    fields,
    product_types: fields.product_type ? [fields.product_type] : [],
  }));
}

/** One feed item as a variant of its item group. */
function feedVariant(item: FeedItem) {
  const { fields } = item;
  if (!fields.title) throw new RowError('title is required');
  if (!fields.id && !fields.link) throw new RowError('id or link is required');
  const price = fields.price ? parsePrice(fields.price) : null;
  return {
    item,
    price,
    variant: {
      title: fields.title,
      sku: fields.id ?? '',
      gtin: fields.gtin ?? '',
      price: price?.amount ?? null,
      url: fields.link ?? '',
    } satisfies CatalogVariant,
  };
}

/** One product from a Merchant Center item group (or a lone item). */
function feedProduct(group: NonEmpty<FeedItem>, grouped: boolean): CatalogItem {
  const [first, ...rest] = group;
  return rowItem(first.row_number, () => {
    const lead = feedVariant(first);
    const variants = [lead, ...rest.map(feedVariant)];
    const currencies = new Set(
      variants.flatMap((v) => (v.price?.currency ? [v.price.currency] : [])),
    );
    if (currencies.size > 1) throw new RowError('Variants are priced in different currencies');
    const prices = variants.flatMap((v) => (v.price ? [v.price.amount] : []));
    const low = prices.length ? Math.min(...prices) : undefined;
    const high = prices.length ? Math.max(...prices) : undefined;
    const fields = lead.item.fields;
    return {
      values: validValues({
        name: fields.title,
        brand: fields.brand,
        description: fields.description,
        price: low,
        price_max: high !== undefined && high !== low ? high : undefined,
        currency: [...currencies][0] ?? '',
        canonical_url: fields.link,
        image_url: fields.image_link,
        sku: grouped ? fields.item_group_id : fields.id,
        gtin: grouped ? '' : fields.gtin,
        mpn: grouped ? '' : fields.mpn,
      }),
      variants: grouped ? variants.slice(0, limits.variant_limit).map((v) => v.variant) : [],
      paths: pathsOf(group.flatMap((item) => item.product_types)),
    };
  });
}

/** A Merchant Center feed: CSV, TSV, XML (RSS or Atom) or JSON; `item_group_id` groups variants. */
function parseMerchantFeed(content: string): CatalogItem[] {
  const start = content.replace(/^\uFEFF/u, '').trimStart();
  let items: FeedItem[];
  if (start.startsWith('<')) items = xmlFeed(start);
  else if (start.startsWith('{') || start.startsWith('[')) items = jsonFeed(start);
  else items = delimitedFeed(content);
  const groups = groupBy(boundedRows(items), (item) =>
    item.fields.item_group_id ? `group:${item.fields.item_group_id}` : `row:${item.row_number}`,
  );
  return [...groups].map(([key, group]) => feedProduct(group, key.startsWith('group:')));
}

const shopifyProduct = z.object({
  title: z.string(),
  handle: z.string(),
  body_html: z.string().nullish(),
  vendor: z.string().nullish(),
  product_type: z.string().nullish(),
  tags: z.union([z.array(z.string()), z.string()]).nullish(),
  images: z.array(z.object({ src: z.string() })).nullish(),
  variants: z
    .array(
      z.object({
        title: z.string().nullish(),
        sku: z.string().nullish(),
        barcode: z.string().nullish(),
        price: z.union([z.string(), z.number()]).nullish(),
      }),
    )
    .nullish(),
});
const shopifyPage = z.object({ products: z.array(z.unknown()) });

/** The stored payload of a storefront fetch: the store host and each page body as fetched. */
const shopifyPayloadSchema = z.object({ store: z.string(), pages: z.array(z.string()) });

function shopifyItem(store: string, rowNumber: number, raw: unknown): CatalogItem {
  return rowItem(rowNumber, () => {
    const parsed = shopifyProduct.safeParse(raw);
    if (!parsed.success) throw new RowError('Not a Shopify product');
    const product = parsed.data;
    const variants = (product.variants ?? []).map((variant) => {
      const price = text(variant.price);
      return {
        title: variant.title ?? '',
        sku: variant.sku ?? '',
        gtin: variant.barcode ?? '',
        price: price ? parsePrice(price).amount : null,
        url: '',
      } satisfies CatalogVariant;
    });
    const prices = variants.flatMap((variant) => (variant.price === null ? [] : [variant.price]));
    const low = prices.length ? Math.min(...prices) : undefined;
    const high = prices.length ? Math.max(...prices) : undefined;
    const only = variants.length === 1 ? variants[0] : undefined;
    const tags = typeof product.tags === 'string' ? product.tags.split(',') : (product.tags ?? []);
    return {
      values: validValues({
        name: product.title,
        brand: product.vendor ?? '',
        description: fragmentText(product.body_html ?? ''),
        price: low,
        price_max: high !== undefined && high !== low ? high : undefined,
        canonical_url: `https://${store}/products/${encodeURIComponent(product.handle)}`,
        image_url: product.images?.[0]?.src,
        sku: only?.sku,
        gtin: only?.gtin,
      }),
      variants: variants.length > 1 ? variants.slice(0, limits.variant_limit) : [],
      paths: [
        ...pathsOf([product.product_type ?? '']),
        ...pathsOf(tags.map((tag) => tag.replaceAll('>', ' ')).slice(0, limits.tag_category_limit)),
      ],
    };
  });
}

/** A fetched storefront's products, numbered in page order. */
function parseShopifyPayload(content: string): CatalogItem[] {
  const payload = shopifyPayloadSchema.parse(JSON.parse(content));
  const products = payload.pages.flatMap((page) => shopifyPage.parse(JSON.parse(page)).products);
  return boundedRows(products).map((raw, index) => shopifyItem(payload.store, index + 1, raw));
}

/** Parse a staged import's stored content by its format. */
export function catalogItems(format: CatalogFormat, content: string): CatalogItem[] {
  if (!content.trim()) refuse('The file is empty');
  switch (format) {
    case 'csv':
      return parseTemplate(content);
    case 'merchant_center':
      return parseMerchantFeed(content);
    case 'shopify':
      return parseShopifyPayload(content);
    default: {
      const unknownFormat: never = format;
      return refuse(`Unknown catalog source ${String(unknownFormat)}`);
    }
  }
}

type TreeNode = { key: string; name: string; parent_key: string | null };

/**
 * The category tree the items propose, keyed like `commerce_categories`
 * (one category per name). A name keeps the first parent a path gives it; a
 * parent that would make a cycle is not taken.
 */
export function proposedTree(items: readonly CatalogItem[]): Map<string, TreeNode> {
  const nodes = new Map<string, TreeNode>();
  const ancestors = (key: string | null) => {
    const seen = new Set<string>();
    for (
      let cursor = key;
      cursor && !seen.has(cursor);
      cursor = nodes.get(cursor)?.parent_key ?? null
    )
      seen.add(cursor);
    return seen;
  };
  for (const item of items) {
    if (item.kind !== 'item') continue;
    for (const path of item.paths) {
      let parent: string | null = null;
      for (const name of path) {
        const key = categoryKey(name);
        const node = nodes.get(key) ?? { key, name, parent_key: null };
        nodes.set(key, node);
        if (!node.parent_key && parent && parent !== key && !ancestors(parent).has(key))
          node.parent_key = parent;
        parent = key;
      }
    }
  }
  return nodes;
}

/** The category names an item joins: each path up to its first excluded category. */
export function keptCategories(paths: readonly CategoryPath[], excluded: ReadonlySet<string>) {
  const names = new Map<string, string>();
  for (const path of paths)
    for (const name of path) {
      const key = categoryKey(name);
      if (excluded.has(key)) break;
      if (!names.has(key)) names.set(key, name);
    }
  return [...names.values()];
}

/** The proposed tree as the review step shows it: depth-first, by name. */
export function treeProposal(
  items: readonly CatalogItem[],
  existing: ReadonlySet<string>,
): CatalogCategoryProposal[] {
  const nodes = proposedTree(items);
  const counts = new Map<string, number>();
  for (const item of items)
    if (item.kind === 'item')
      for (const name of keptCategories(item.paths, new Set()))
        counts.set(categoryKey(name), (counts.get(categoryKey(name)) ?? 0) + 1);
  const children = new Map<string | null, TreeNode[]>();
  for (const node of nodes.values())
    children.set(node.parent_key, [...(children.get(node.parent_key) ?? []), node]);
  const out: CatalogCategoryProposal[] = [];
  const visit = (parent: string | null, depth: number) => {
    const level = (children.get(parent) ?? []).sort((a, b) => a.name.localeCompare(b.name));
    for (const node of level) {
      out.push({
        ...node,
        depth,
        product_count: counts.get(node.key) ?? 0,
        existing: existing.has(node.key),
      });
      visit(node.key, depth + 1);
    }
  };
  visit(null, 0);
  return out;
}
