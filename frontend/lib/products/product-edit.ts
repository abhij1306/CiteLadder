import {
  productEditRequestSchema,
  type ProductEditRequest,
} from '@citeladder/contracts/commerce-requests';
import type { CommerceProductDetail } from '@citeladder/contracts/commerce-suite';

type Catalog = NonNullable<CommerceProductDetail['product']['catalog']>;

/** The edit form's values: every field as typed, categories as a list. */
export type ProductEditForm = Readonly<{
  name: string;
  brand: string;
  description: string;
  price: string;
  currency: string;
  canonical_url: string;
  image_url: string;
  sku: string;
  gtin: string;
  mpn: string;
  categories: readonly string[];
}>;

/** The form a catalog product's edit starts from: its record as stored. */
export function productEditForm(
  product: Pick<CommerceProductDetail['product'], 'name' | 'brand' | 'description' | 'url'>,
  catalog: Catalog,
): ProductEditForm {
  return {
    name: product.name,
    brand: product.brand,
    description: product.description,
    price: catalog.price === null ? '' : String(catalog.price),
    currency: catalog.currency,
    canonical_url: product.url,
    image_url: catalog.image_url,
    sku: catalog.sku,
    gtin: catalog.gtin,
    mpn: catalog.mpn,
    categories: catalog.categories,
  };
}

const TEXT_FIELDS = [
  'name',
  'brand',
  'description',
  'currency',
  'canonical_url',
  'image_url',
  'sku',
  'gtin',
  'mpn',
] as const;

/** A text field as the server stores it: trimmed, a currency upper-cased. */
const stored = (field: (typeof TEXT_FIELDS)[number], value: string) =>
  field === 'currency' ? value.trim().toUpperCase() : value.trim();

/** Category names as the catalog keys them: case and inner whitespace do not count. */
const sameSet = (a: readonly string[], b: readonly string[]) => {
  const key = (values: readonly string[]) =>
    [...new Set(values.map((value) => value.trim().replaceAll(/\s+/gu, ' ').toLowerCase()))]
      .sort((a, b) => a.localeCompare(b))
      .join('\n');
  return key(a) === key(b);
};

export type ProductEditResult =
  | { kind: 'unchanged' }
  | { kind: 'invalid'; message: string }
  | { kind: 'edit'; edit: ProductEditRequest };

/**
 * The edit to send: only the fields that changed, so an untouched field keeps
 * whatever owns it (CSV, crawl or an earlier edit). Validated against the
 * request contract before it leaves the browser.
 */
export function productEditChanges(
  initial: ProductEditForm,
  values: ProductEditForm,
): ProductEditResult {
  const changed: Record<string, unknown> = {};
  for (const field of TEXT_FIELDS)
    if (stored(field, values[field]) !== stored(field, initial[field]))
      changed[field] = values[field];
  if (values.price.trim() !== initial.price.trim()) {
    const price = values.price.trim();
    if (price && !Number.isFinite(Number(price)))
      return { kind: 'invalid', message: 'Price must be a number' };
    changed.price = price ? Number(price) : null;
  }
  if (!sameSet(values.categories, initial.categories)) changed.categories = [...values.categories];
  if (!Object.keys(changed).length) return { kind: 'unchanged' };
  const parsed = productEditRequestSchema.safeParse(changed);
  if (!parsed.success) {
    const [issue] = parsed.error.issues;
    const field = issue?.path.join('.') ?? '';
    return {
      kind: 'invalid',
      message: field ? `${field.replace('_', ' ')}: ${issue?.message}` : 'Check the fields',
    };
  }
  return { kind: 'edit', edit: parsed.data };
}
