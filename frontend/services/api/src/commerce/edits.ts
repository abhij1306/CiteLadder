import { isDeepStrictEqual } from 'node:util';
import { productEditRequestSchema } from '@citeladder/contracts/commerce-requests';
import { commerceProductSchema } from '@citeladder/contracts/commerce-suite';
import type { CommerceLifecycleState } from '@citeladder/contracts/commerce-suite';
import type { Selectable, Updateable } from 'kysely';
import { z } from 'zod';

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { jsonObject } from '../db/json.ts';
import { ApiError } from '../errors.ts';
import type { CommerceProducts } from '../generated/db-schema.ts';
import { canonicalUrl } from '../site-health/url-identity.ts';
import {
  addMembership,
  appendObservation,
  categoryByName,
  lockCatalog,
  productCategories,
} from './catalog-store.ts';
import { recordCatalogRevision } from './catalog-revisions.ts';
import { categoryKey, isCategoryName } from './projection-facts.ts';
import { commerceMissing, type CommerceScope } from './reads.ts';

export const productEditInput = productEditRequestSchema
  .refine(
    (edit) =>
      edit.description === undefined ||
      edit.description.length <= policy.commerce.edit.description_max_chars,
    'Description is too long',
  )
  .refine(
    (edit) =>
      edit.categories === undefined ||
      edit.categories.length <= policy.commerce.edit.category_limit,
    'Too many categories',
  )
  .refine(
    (edit) => edit.categories === undefined || edit.categories.every(isCategoryName),
    'A category needs a real name',
  )
  .refine(
    (edit) => edit.canonical_url === undefined || canonicalUrl(edit.canonical_url) !== null,
    'Unsupported catalog URL',
  );
export type ProductEdit = z.output<typeof productEditInput>;
export { productLifecycleRequestSchema as productLifecycleInput } from '@citeladder/contracts/commerce-requests';

const SCALAR_FIELDS = [
  'canonical_url',
  'name',
  'description',
  'brand',
  'price',
  'currency',
  'sku',
  'gtin',
  'mpn',
  'image_url',
] as const;
type ScalarField = (typeof SCALAR_FIELDS)[number];

export function comparable(field: string, value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  if (field === 'price') return String(Number(value));
  return String(value);
}

export const categorySet = (names: Iterable<string>) =>
  [...new Set([...names].map(categoryKey))].sort((a, b) => a.localeCompare(b));

function provenance(value: unknown, field: string): Record<string, unknown> {
  return value === undefined ? {} : jsonObject(value, `field_sources.${field}`);
}

export function importedBaseline(sources: Record<string, unknown>, field: string): unknown {
  const source = provenance(sources[field], field);
  return source.kind === 'edit' ? source.imported : undefined;
}

export function editHolds(sources: Record<string, unknown>, field: string, value: unknown) {
  const imported = importedBaseline(sources, field);
  return imported !== undefined && isDeepStrictEqual(imported, value);
}

function editSource(prior: unknown, field: string, current: unknown, observationId: string) {
  const previous = provenance(prior, field);
  let imported: unknown;
  if (previous.kind === 'edit') imported = previous.imported;
  else if (previous.kind === 'csv') imported = current;
  return {
    kind: 'edit',
    source_id: observationId,
    version: policy.commerce.edit.version,
    ...(imported === undefined ? {} : { imported }),
  };
}

function conflict(message: string): never {
  throw new ApiError(409, message, { code: 'commerce_conflict' });
}

async function lockedProduct(db: Database, scope: CommerceScope, id: string) {
  await lockCatalog(db, scope);
  const product = await db
    .selectFrom('commerce_products')
    .selectAll()
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('id', '=', id)
    .executeTakeFirst();
  if (!product) commerceMissing('Product not found');
  return product;
}

function columnValues(edit: ProductEdit): Updateable<CommerceProducts> {
  const values: Updateable<CommerceProducts> = {};
  if (edit.canonical_url !== undefined)
    values.canonical_url = canonicalUrl(edit.canonical_url) ?? edit.canonical_url;
  if (edit.name !== undefined) values.name = edit.name;
  if (edit.description !== undefined) values.description = edit.description;
  if (edit.brand !== undefined) values.brand = edit.brand;
  if (edit.price !== undefined) {
    values.price = edit.price;
    values.price_max = null;
  }
  if (edit.currency !== undefined) values.currency = edit.currency;
  if (edit.image_url !== undefined) values.image_url = edit.image_url;
  for (const field of ['sku', 'gtin', 'mpn'] as const) {
    const value = edit[field];
    if (value !== undefined) values[field] = value || null;
  }
  return values;
}

async function refuseIdentityConflict(
  db: Database,
  scope: CommerceScope,
  productId: string,
  values: Updateable<CommerceProducts>,
) {
  const claims = (['canonical_url', 'sku', 'gtin'] as const).flatMap((field) => {
    const value = values[field];
    return typeof value === 'string' && value ? [{ field, value }] : [];
  });
  if (!claims.length) return;
  const other = await db
    .selectFrom('commerce_products')
    .select('id')
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('id', '!=', productId)
    .where((eb) => eb.or(claims.map(({ field, value }) => eb(field, '=', value))))
    .executeTakeFirst();
  if (other) conflict('Another product already has this URL, SKU or GTIN');
}

async function replaceCategories(
  db: Database,
  scope: CommerceScope,
  productId: string,
  names: readonly string[],
  observationId: string,
) {
  const byKey = new Map(names.map((name) => [categoryKey(name), name]));
  const ids: string[] = [];
  for (const name of byKey.values()) ids.push((await categoryByName(db, scope, name)).id); // NOSONAR -- One edit transaction: statements run in order.
  let removal = db
    .deleteFrom('commerce_product_categories')
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('product_id', '=', productId);
  if (ids.length) removal = removal.where('category_id', 'not in', ids);
  await removal.execute();
  for (const id of ids) await addMembership(db, scope, productId, id, observationId); // NOSONAR -- One edit transaction: statements run in order.
}

async function catalogProduct(db: Database, scope: CommerceScope, product: { id: string }) {
  const row = await db
    .selectFrom('commerce_products')
    .select(['id', 'canonical_url', 'name', 'brand'])
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('id', '=', product.id)
    .executeTakeFirstOrThrow();
  const memberships = await productCategories(db, scope, product.id)
    .select('m.category_id')
    .orderBy('m.category_id')
    .execute();
  return commerceProductSchema.parse({
    ...row,
    category_ids: memberships.map((membership) => membership.category_id),
  });
}

function currentValue(product: Selectable<CommerceProducts>, field: ScalarField) {
  return comparable(field, product[field]);
}

export function editProduct(db: Database, scope: CommerceScope, id: string, edit: ProductEdit) {
  return db.transaction().execute(async (trx) => {
    const product = await lockedProduct(trx, scope, id);
    const values = columnValues(edit);
    await refuseIdentityConflict(trx, scope, product.id, values);
    const observationId = await appendObservation(trx, scope, product.id, {
      source_kind: 'edit',
      observed_fields: JSON.stringify(edit),
      edit_version: policy.commerce.edit.version,
    });
    const sources = jsonObject(product.field_sources, 'commerce_products.field_sources');
    for (const field of SCALAR_FIELDS)
      if (values[field] !== undefined)
        sources[field] = editSource(
          sources[field],
          field,
          currentValue(product, field),
          observationId,
        );
    if (edit.categories !== undefined) {
      const prior = provenance(sources.categories, 'categories');
      sources.categories = editSource(
        sources.categories,
        'categories',
        prior.kind === 'csv' ? prior.keys : undefined,
        observationId,
      );
      await replaceCategories(trx, scope, product.id, edit.categories, observationId);
    }
    await trx
      .updateTable('commerce_products')
      .set({ ...values, field_sources: JSON.stringify(sources), updated_at: new Date() })
      .where('id', '=', product.id)
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .execute();
    await recordCatalogRevision(trx, scope, { kind: 'edit', id: observationId });
    return catalogProduct(trx, scope, product);
  });
}

export function setProductLifecycle(
  db: Database,
  scope: CommerceScope,
  id: string,
  state: CommerceLifecycleState,
) {
  return db.transaction().execute(async (trx) => {
    const product = await lockedProduct(trx, scope, id);
    if (product.lifecycle_state === state) return catalogProduct(trx, scope, product);
    const observationId = await appendObservation(trx, scope, product.id, {
      source_kind: 'edit',
      observed_fields: JSON.stringify({ lifecycle_state: state }),
      edit_version: policy.commerce.edit.version,
    });
    const sources = jsonObject(product.field_sources, 'commerce_products.field_sources');
    sources.lifecycle_state = editSource(undefined, 'lifecycle_state', undefined, observationId);
    await trx
      .updateTable('commerce_products')
      .set({
        lifecycle_state: state,
        field_sources: JSON.stringify(sources),
        updated_at: new Date(),
      })
      .where('id', '=', product.id)
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .execute();
    await recordCatalogRevision(trx, scope, { kind: 'edit', id: observationId });
    return catalogProduct(trx, scope, product);
  });
}
