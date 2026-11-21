import {
  attribute,
  childElements,
  elements,
  hasAttribute,
  textContent,
  type HtmlElement,
  type HtmlNode,
} from '../../web-evidence/html.ts';
import { compareText, scalarText, stripTrailing } from '../../text-order.ts';
import { analysisPolicy, limits, squash } from './policy.ts';

const sd = analysisPolicy.structured_data;
const RECOGNIZED = new Set(sd.recognized_types);
const REQUIRED: Record<string, string[]> = sd.required_properties;
const PRODUCT_KEYS = [
  'name',
  'sku',
  'gtin',
  'brand',
  'mpn',
  'price',
  'price_currency',
  'price_valid_until',
  'availability',
  'variants',
  'ratings',
  'description',
  'url',
  'category',
] as const;
type ProductValues = Record<(typeof PRODUCT_KEYS)[number], string[]>;
type SchemaProduct = Partial<ProductValues> & { shipping?: boolean; returns?: boolean };
export type SchemaBlock = {
  type: string;
  syntax: 'json-ld' | 'microdata';
  entity_index?: number;
  parent_property?: string;
  required: string[];
  present: string[];
  missing: string[];
  valid: boolean;
  schema_id: string;
  name: string;
  author: string;
  date_published: string;
  date_modified: string;
  same_as: string[];
  props_present: string[];
  description?: string;
  url: string;
  category?: string;
  is_part_of_url?: string;
  main_entity_id: string;
  main_entity_of_page_id: string;
  breadcrumb_items?: string[];
  product: SchemaProduct;
};
type JsonObject = Record<string, unknown>;

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isEmpty = (value: unknown) =>
  value === null ||
  value === undefined ||
  value === '' ||
  (Array.isArray(value) && !value.length) ||
  (isObject(value) && !Object.keys(value).length);
const emptyProductValues = (): ProductValues => {
  const values: Partial<ProductValues> = {};
  for (const key of PRODUCT_KEYS) values[key] = [];
  return values as ProductValues;
};

function cleanType(value: unknown): string {
  if (typeof value !== 'string') return '';
  let token = stripTrailing(value.trim(), '/');
  if (token.includes('/')) token = token.slice(token.lastIndexOf('/') + 1);
  if (token.includes('#')) token = token.slice(token.lastIndexOf('#') + 1);
  return token;
}
const cleanTypes = (value: unknown) => [
  ...new Set((Array.isArray(value) ? value : [value]).map(cleanType).filter(Boolean)),
];

type NestedJsonLd = { object: JsonObject; parentProperty: string };

function* jsonObjects(node: unknown, depth = 0, parentProperty = ''): Generator<NestedJsonLd> {
  if (depth > limits.jsonld_depth) return;
  if (Array.isArray(node)) {
    for (const child of node) yield* nestedObjects(child, depth, parentProperty);
    return;
  }
  if (!isObject(node)) return;
  yield { object: node, parentProperty };
  for (const [key, child] of Object.entries(node))
    yield* nestedObjects(child, depth, key === '@graph' ? '' : key);
}

function* nestedObjects(
  child: unknown,
  depth: number,
  parentProperty: string,
): Generator<NestedJsonLd> {
  if (typeof child === 'object' && child !== null)
    yield* jsonObjects(child, depth + 1, parentProperty);
}

function pathValue(object: unknown, path: string): unknown {
  let current = object;
  for (const segment of path.split('.')) {
    if (Array.isArray(current)) current = current.find(isObject);
    if (!isObject(current)) return undefined;
    current = current[segment];
    if (current === null || current === undefined) return undefined;
  }
  return current;
}

function firstString(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (isObject(value)) return firstString(value.name);
  if (Array.isArray(value))
    for (const item of value) {
      const text = firstString(item);
      if (text) return text;
    }
  return '';
}
function relationshipUrl(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (isObject(value)) return relationshipUrl(value['@id'] || value.url);
  if (Array.isArray(value))
    for (const item of value) {
      const url = relationshipUrl(item);
      if (url) return url;
    }
  return '';
}
const bounded = (value: string, max: number) => value.slice(0, max);

function breadcrumbItems(value: unknown) {
  const urls: string[] = [];
  for (const entry of Array.isArray(value) ? value : [value]) {
    if (!isObject(entry)) continue;
    const url = relationshipUrl(entry.item || entry);
    if (url && !urls.includes(url)) urls.push(bounded(url, limits.same_as_chars));
    if (urls.length >= limits.same_as_entries) break;
  }
  return urls;
}

function values(value: unknown): string[] {
  const found: string[] = [];
  if (Array.isArray(value)) for (const item of value) found.push(...values(item));
  else if (isObject(value))
    for (const key of sd.product_nested_value_keys) {
      const text = firstString(value[key]);
      if (text) found.push(text);
    }
  else found.push(scalarText(value).trim());
  return [
    ...new Set(found.filter(Boolean).map((item) => bounded(item, sd.product_max_value_chars))),
  ].slice(0, sd.product_max_values);
}

function firstObject(value: unknown): JsonObject {
  if (Array.isArray(value)) return value.find(isObject) ?? {};
  return isObject(value) ? value : {};
}

function productEnrichment(object: JsonObject): SchemaProduct {
  const offer = firstObject(pathValue(object, 'offers'));
  const source = Object.keys(offer).length ? offer : object;
  return {
    sku: values(object.sku),
    gtin: values(['gtin', 'gtin8', 'gtin12', 'gtin13', 'gtin14'].map((key) => object[key])),
    brand: values(object.brand),
    mpn: values(object.mpn),
    price: values(source.price),
    price_currency: values(source.priceCurrency),
    price_valid_until: values(source.priceValidUntil),
    availability: values(source.availability),
    variants: [...values(object.hasVariant), ...values(object.isVariantOf)],
    ratings: [...values(object.aggregateRating), ...values(object.review)],
    shipping: Boolean(offer.shippingDetails),
    returns: Boolean(offer.hasMerchantReturnPolicy),
  };
}

function enrichment(object: JsonObject, type: string) {
  const sameAs = typeof object.sameAs === 'string' ? [object.sameAs] : object.sameAs;
  return {
    schema_id: bounded(relationshipUrl(object['@id']), limits.same_as_chars),
    name: bounded(firstString(object.name) || firstString(object.headline), limits.name_chars),
    author: bounded(firstString(object.author), limits.author_chars),
    date_published: bounded(firstString(object.datePublished), limits.date_chars),
    date_modified: bounded(firstString(object.dateModified), limits.date_chars),
    same_as: Array.isArray(sameAs)
      ? sameAs
          .slice(0, limits.same_as_entries)
          .filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim()))
          .map((entry) => bounded(entry.trim(), limits.same_as_chars))
      : [],
    props_present: sd.property_paths.filter((path) => !isEmpty(pathValue(object, path))),
    description: bounded(firstString(object.description), limits.name_chars),
    url: bounded(relationshipUrl(object.url), limits.same_as_chars),
    category: bounded(firstString(object.category), limits.name_chars),
    is_part_of_url: bounded(relationshipUrl(object.isPartOf), limits.same_as_chars),
    main_entity_id: bounded(relationshipUrl(object.mainEntity), limits.same_as_chars),
    main_entity_of_page_id: bounded(relationshipUrl(object.mainEntityOfPage), limits.same_as_chars),
    breadcrumb_items: type === 'BreadcrumbList' ? breadcrumbItems(object.itemListElement) : [],
    product: productEnrichment(object),
  };
}

function objectBlocks(
  { object, parentProperty }: NestedJsonLd,
  origin: { syntax: 'json-ld'; entityIndex: number } | { syntax: 'microdata' },
): SchemaBlock[] {
  return cleanTypes(object['@type'])
    .filter((type) => RECOGNIZED.has(type))
    .map((type) => {
      const required = REQUIRED[type] ?? [];
      const present = required.filter((name) => name in object && !isEmpty(object[name]));
      const missing = required.filter((name) => !present.includes(name));
      return {
        type,
        syntax: origin.syntax,
        ...(origin.syntax === 'json-ld' ? { entity_index: origin.entityIndex } : {}),
        parent_property: parentProperty,
        required,
        present,
        missing,
        valid: !missing.length,
        ...enrichment(object, type),
      };
    });
}

function declaredSchemaTypes(objects: NestedJsonLd[], root: HtmlNode, maxTypes: number) {
  const types = new Set(objects.flatMap(({ object }) => cleanTypes(object['@type'])));
  for (const node of elements(root))
    if (hasAttribute(node, 'itemscope'))
      for (const candidate of attribute(node, 'itemtype').split(/\s+/u)) {
        const type = cleanType(candidate);
        if (type) types.add(type);
      }
  return [...types].sort(compareText).slice(0, maxTypes);
}

function jsonLdObjects(raw: string[]) {
  const objects: NestedJsonLd[] = [];
  let invalid = 0;
  for (const body of raw) {
    if (!body.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.trim());
    } catch {
      invalid++;
      continue;
    }
    objects.push(...jsonObjects(parsed));
  }
  return { objects, invalid };
}

function jsonLdBlocks(objects: NestedJsonLd[], maxBlocks: number): SchemaBlock[] {
  const blocks: SchemaBlock[] = [];
  for (const [entityIndex, object] of objects.entries()) {
    blocks.push(...objectBlocks(object, { syntax: 'json-ld', entityIndex }));
    if (blocks.length >= maxBlocks) return blocks.slice(0, maxBlocks);
  }
  return blocks;
}

const URL_VALUE_ATTRIBUTES: Record<string, string> = {
  a: 'href',
  area: 'href',
  link: 'href',
  audio: 'src',
  embed: 'src',
  iframe: 'src',
  img: 'src',
  source: 'src',
  track: 'src',
  video: 'src',
  object: 'data',
};

function absoluteUrl(value: string, baseUrl: string) {
  if (!value) return value;
  try {
    return new URL(value, baseUrl).href;
  } catch {
    return value;
  }
}

/**
 * A property's value as the microdata model reads it, after an explicit
 * `content`, which schema.org consumers accept on any element. A URL
 * property's value is absolute, so the page binds by its own URL.
 */
function microdataValue(node: HtmlElement, baseUrl: string) {
  const content = attribute(node, 'content').trim();
  if (content) return content;
  if (node.tagName === 'meta') return '';
  const urlAttribute = URL_VALUE_ATTRIBUTES[node.tagName];
  if (urlAttribute) return absoluteUrl(attribute(node, urlAttribute).trim(), baseUrl);
  if (node.tagName === 'data' || node.tagName === 'meter') return attribute(node, 'value').trim();
  if (node.tagName === 'time' && hasAttribute(node, 'datetime'))
    return attribute(node, 'datetime').trim();
  return squash(textContent(node));
}

function* itemProperties(item: HtmlElement): Generator<HtmlElement> {
  const pending = childElements(item).toReversed();
  while (pending.length) {
    const node = pending.pop()!;
    if (hasAttribute(node, 'itemprop')) yield node;
    if (hasAttribute(node, 'itemscope')) continue;
    for (const child of childElements(node).toReversed()) pending.push(child);
  }
}

const propertyNames = (node: HtmlElement) =>
  attribute(node, 'itemprop').split(/\s+/u).map(cleanType).filter(Boolean);

function propertyValue(property: HtmlElement, depth: number, baseUrl: string): unknown {
  if (!hasAttribute(property, 'itemscope')) return microdataValue(property, baseUrl);
  return depth < limits.jsonld_depth ? microdataObject(property, baseUrl, depth + 1) : undefined;
}

function microdataObject(item: HtmlElement, baseUrl: string, depth = 0): JsonObject {
  const properties = new Map<string, unknown[]>([
    ['@type', attribute(item, 'itemtype').split(/\s+/u).filter(Boolean)],
  ]);
  const id = absoluteUrl(attribute(item, 'itemid').trim(), baseUrl);
  if (id) properties.set('@id', [id]);
  for (const property of itemProperties(item)) {
    const value = propertyValue(property, depth, baseUrl);
    if (isEmpty(value)) continue;
    for (const name of propertyNames(property).filter((name) => !name.startsWith('@'))) {
      const list = properties.get(name);
      if (list) list.push(value);
      else properties.set(name, [value]);
    }
  }
  return Object.fromEntries(
    [...properties].map(([name, list]) => [name, list.length === 1 ? list[0] : list]),
  );
}

function microdataBlocks(root: HtmlNode, maxBlocks: number, baseUrl: string): SchemaBlock[] {
  const blocks: SchemaBlock[] = [];
  for (const node of elements(root)) {
    if (!hasAttribute(node, 'itemscope') || !attribute(node, 'itemtype').trim()) continue;
    const nested = {
      object: microdataObject(node, baseUrl),
      parentProperty: propertyNames(node)[0] ?? '',
    };
    blocks.push(...objectBlocks(nested, { syntax: 'microdata' }));
    if (blocks.length >= maxBlocks) return blocks.slice(0, maxBlocks);
  }
  return blocks;
}

function productFacts(blocks: SchemaBlock[]) {
  const all = blocks.filter((block) => block.type === 'Product');
  const preferred = all.filter(
    (block) =>
      (['sku', 'gtin', 'mpn', 'brand', 'price'] as const).some(
        (key) => block.product[key]?.length,
      ) || block.props_present.includes('offers'),
  );
  const chosen = preferred.length ? preferred : all;
  const merged = emptyProductValues();
  let shipping = false;
  let returns = false;
  for (const block of chosen) {
    const product: SchemaProduct = {
      name: [block.name],
      description: [block.description ?? ''],
      url: [block.url],
      category: [block.category ?? ''],
      ...block.product,
    };
    for (const key of PRODUCT_KEYS)
      for (const value of product[key] ?? [])
        if (value && !merged[key].includes(value) && merged[key].length < sd.product_max_values)
          merged[key].push(value.slice(0, sd.product_max_value_chars));
    shipping ||= Boolean(product.shipping);
    returns ||= Boolean(product.returns);
  }
  return { schema_product_count: chosen.length, ...merged, shipping, returns };
}

export function structuredDataFacts(root: HtmlNode, maxBlocks: number, baseUrl: string) {
  const raw = [...elements(root, 'script')]
    .filter((node) => attribute(node, 'type').toLowerCase() === 'application/ld+json')
    .map(textContent);
  const { objects, invalid } = jsonLdObjects(raw);
  const jsonLd = jsonLdBlocks(objects, maxBlocks);
  const microdata = microdataBlocks(root, maxBlocks, baseUrl);
  const blocks = [...jsonLd, ...microdata].slice(0, maxBlocks);
  return {
    blocks,
    count: blocks.length,
    has_json_ld: jsonLd.length > 0,
    has_microdata: microdata.length > 0,
    invalid_json_ld_count: invalid,
    types: [...new Set(blocks.map((block) => block.type))].sort(compareText),
    declared_types: declaredSchemaTypes(objects, root, maxBlocks),
    product: productFacts(blocks),
  };
}
