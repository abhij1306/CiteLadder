/**
 * Bounded JSON-LD and microdata facts. Each recognized schema.org type an
 * object declares becomes one block with its required-property contract, the
 * enrichment fields the page-kind schema checks read, and Product/Offer claims.
 */
import {
  ancestors,
  attribute,
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
  /** The JSON-LD property nesting this object (`publisher`, `author`…); '' at the top level. */
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
const emptyProductValues = (): ProductValues =>
  Object.fromEntries(PRODUCT_KEYS.map((key) => [key, []])) as unknown as ProductValues;

/** `"https://schema.org/Article"` and `"Article"` name the same type. */
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

/** A JSON-LD object and the property that nests it: '' at the top level or in `@graph`. */
type NestedJsonLd = { object: JsonObject; parentProperty: string };

function* jsonObjects(node: unknown, depth = 0, parentProperty = ''): Generator<NestedJsonLd> {
  if (depth > limits.jsonld_depth) return;
  if (Array.isArray(node)) {
    // A list's items keep the property that holds the list.
    for (const child of node) yield* nestedObjects(child, depth, parentProperty);
    return;
  }
  if (!isObject(node)) return;
  yield { object: node, parentProperty };
  for (const [key, child] of Object.entries(node))
    yield* nestedObjects(child, depth, key === '@graph' ? '' : key);
}

/** The JSON-LD objects within one child value, a level deeper. */
function* nestedObjects(
  child: unknown,
  depth: number,
  parentProperty: string,
): Generator<NestedJsonLd> {
  if (typeof child === 'object' && child !== null)
    yield* jsonObjects(child, depth + 1, parentProperty);
}

/** A dotted one-level path; a list collapses to its first object. */
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
/** One explicit relationship URL (`@id` or `url`), never guessed from a name. */
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

/** Stable scalar evidence strings, deduplicated and bounded. */
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
    // Only a BreadcrumbList's items are a trail; a CollectionPage's ItemList lists children.
    breadcrumb_items: type === 'BreadcrumbList' ? breadcrumbItems(object.itemListElement) : [],
    product: productEnrichment(object),
  };
}

/** One block per recognized type; every block names the object it came from. */
function objectBlocks(
  { object, parentProperty }: NestedJsonLd,
  entityIndex: number,
): SchemaBlock[] {
  return cleanTypes(object['@type'])
    .filter((type) => RECOGNIZED.has(type))
    .map((type) => {
      const required = REQUIRED[type] ?? [];
      const present = required.filter((name) => name in object && !isEmpty(object[name]));
      const missing = required.filter((name) => !present.includes(name));
      return {
        type,
        syntax: 'json-ld',
        entity_index: entityIndex,
        parent_property: parentProperty,
        required,
        present,
        missing,
        valid: !missing.length,
        ...enrichment(object, type),
      };
    });
}

/**
 * Every schema.org type the page declares, recognized or not: a page marked up
 * only as `SoftwareApplication` or `Event` has structured data even though no
 * deeper check reads that type.
 */
export function declaredSchemaTypes(objects: NestedJsonLd[], root: HtmlNode, maxTypes: number) {
  const types = new Set(objects.flatMap(({ object }) => cleanTypes(object['@type'])));
  for (const node of elements(root))
    if (hasAttribute(node, 'itemscope'))
      for (const candidate of attribute(node, 'itemtype').split(/\s+/u)) {
        const type = cleanType(candidate);
        if (type) types.add(type);
      }
  return [...types].sort(compareText).slice(0, maxTypes);
}

/** Every object in the page's JSON-LD scripts, in document order, each script parsed once. */
export function jsonLdObjects(raw: string[]): NestedJsonLd[] {
  const objects: NestedJsonLd[] = [];
  for (const body of raw) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.trim());
    } catch {
      continue; // A malformed block cannot discard the others.
    }
    objects.push(...jsonObjects(parsed));
  }
  return objects;
}

export function jsonLdBlocks(objects: NestedJsonLd[], maxBlocks: number): SchemaBlock[] {
  const blocks: SchemaBlock[] = [];
  for (const [entityIndex, object] of objects.entries()) {
    blocks.push(...objectBlocks(object, entityIndex));
    if (blocks.length >= maxBlocks) return blocks.slice(0, maxBlocks);
  }
  return blocks;
}

const MICRODATA_PRODUCT_TARGETS: Record<string, keyof ProductValues> = {
  name: 'name',
  sku: 'sku',
  gtin: 'gtin',
  gtin8: 'gtin',
  gtin12: 'gtin',
  gtin13: 'gtin',
  gtin14: 'gtin',
  brand: 'brand',
  manufacturer: 'brand',
  mpn: 'mpn',
  price: 'price',
  priceCurrency: 'price_currency',
  priceValidUntil: 'price_valid_until',
  availability: 'availability',
  description: 'description',
  url: 'url',
  category: 'category',
};
const declaresProduct = (node: HtmlElement) =>
  attribute(node, 'itemtype')
    .split(/\s+/u)
    .some((value) => stripTrailing(value, '/').split('/').at(-1) === 'Product');

function microdataValue(node: HtmlElement) {
  for (const name of ['content', 'href', 'datetime', 'value', 'src']) {
    const value = attribute(node, name).trim();
    if (value) return value;
  }
  return squash(textContent(node));
}
/** A nested Product's properties belong to that product, not this one. */
function nestedProductProperty(product: HtmlElement, property: HtmlElement) {
  for (const node of [property, ...ancestors(property)]) {
    if (node === product) return false;
    if (hasAttribute(node, 'itemscope') && declaresProduct(node)) return true;
  }
  return false;
}
function microdataProduct(product: HtmlElement): ProductValues {
  const found = emptyProductValues();
  for (const property of elements(product)) {
    if (property === product || !hasAttribute(property, 'itemprop')) continue;
    if (nestedProductProperty(product, property)) continue;
    const value = microdataValue(property);
    if (value) addMicrodataValue(found, attribute(property, 'itemprop'), value);
  }
  return found;
}
/** File one property value under each product field its `itemprop` names. */
function addMicrodataValue(found: ProductValues, itemprop: string, value: string) {
  for (const name of itemprop.split(/\s+/u)) {
    const target = MICRODATA_PRODUCT_TARGETS[name];
    const bucket = target ? found[target] : undefined;
    if (bucket && !bucket.includes(value) && bucket.length < sd.product_max_values)
      bucket.push(value.slice(0, sd.product_max_value_chars));
  }
}

/** Microdata stays shallow: each recognized `itemtype` is a block, Products carry their properties. */
export function microdataBlocks(root: HtmlNode, maxBlocks: number): SchemaBlock[] {
  const scoped = [...elements(root)].filter(
    (node) => hasAttribute(node, 'itemscope') && attribute(node, 'itemtype').trim(),
  );
  const products = scoped.filter(declaresProduct).map(microdataProduct);
  const blocks: SchemaBlock[] = [];
  let productIndex = 0;
  for (const node of scoped)
    for (const candidate of attribute(node, 'itemtype').split(/\s+/u)) {
      const type = cleanType(candidate);
      if (!type || !RECOGNIZED.has(type)) continue;
      const required = REQUIRED[type] ?? [];
      const product =
        type === 'Product' && products.length
          ? products[Math.min(productIndex++, products.length - 1)]!
          : {};
      blocks.push({
        type,
        syntax: 'microdata',
        required,
        present: [],
        missing: [...required],
        valid: !required.length,
        schema_id: '',
        name: '',
        author: '',
        date_published: '',
        date_modified: '',
        same_as: [],
        props_present: [],
        url: '',
        main_entity_id: '',
        main_entity_of_page_id: '',
        product,
      });
      if (blocks.length >= maxBlocks) return blocks;
    }
  return blocks;
}

/**
 * The preferred Product observations merged into one fact. Nested variant
 * Products are skipped when an identity- or offer-bearing Product exists.
 */
export function productFacts(blocks: SchemaBlock[]) {
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
