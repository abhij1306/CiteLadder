import { createHash, randomUUID } from 'node:crypto';
import { catalogImportSchema } from '@citeladder/contracts/commerce-suite';
import { parse } from 'csv-parse/sync';
import type { Selectable, Updateable } from 'kysely';
import { z } from 'zod';

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { jsonObject, jsonObjects } from '../db/json.ts';
import { ApiError } from '../errors.ts';
import type { CommerceProducts } from '../generated/db-schema.ts';
import {
  addMembership,
  appendObservation,
  categoryByName,
  lockCatalog,
  newProduct,
} from './catalog-store.ts';
import type { CommerceScope } from './reads.ts';
import { catalogUrl, categoryKey, isCategoryName } from './projection-facts.ts';

const productInput = z
  .object({
    canonical_url: z.url().refine((value) => catalogUrl(value) !== '', 'Unsupported catalog URL'),
    name: z.string().max(512),
    description: z.string(),
    brand: z.string().max(255),
    price: z.number().nonnegative().max(999999999999.99),
    currency: z.string().max(3),
    sku: z.string().max(255),
    gtin: z.string().max(64),
    mpn: z.string().max(255),
  })
  .partial();
const supported = new Set([
  ...Object.keys(productInput.shape),
  'category',
  'categories',
  'variants',
  'attributes',
]);
type Outcome = z.output<typeof catalogImportSchema>['row_outcomes'][number];

function invalid(message: string): never {
  throw new ApiError(422, message, { code: 'commerce_invalid' });
}

function rowsOf(content: string): Record<string, string>[] {
  if (!content.trim()) invalid('CSV is empty');
  if (Buffer.byteLength(content, 'utf8') > policy.commerce.import_max_bytes)
    invalid('CSV exceeds the byte limit');
  let rows: string[][];
  try {
    rows = parse(content, {
      bom: true,
      skip_empty_lines: true,
      max_record_size: policy.commerce.import_max_bytes,
    }) as string[][];
  } catch {
    invalid('Invalid comma-delimited CSV');
  }
  const header = rows.shift()?.map((value) => value.trim().toLowerCase()) ?? [];
  if (!header.length || !header.some((value) => supported.has(value)))
    invalid('CSV has no supported catalog columns');
  if (new Set(header).size !== header.length) invalid('CSV header contains duplicate columns');
  if (rows.length > policy.commerce.import_max_rows) invalid('CSV exceeds the row limit');
  return rows.map((row) =>
    Object.fromEntries(header.map((name, index) => [name, row[index]!.trim()])),
  );
}

function productValues(row: Record<string, string>) {
  if (row.variants || row.attributes)
    throw new Error('variants and attributes cannot be imported from CSV');
  const categories = new Set(
    (row.categories || row.category || '')
      .split(/[;|]/u)
      .map((name) => name.trim())
      .filter(isCategoryName),
  );
  if ([...categories].some((name) => name.length > 255))
    throw new Error('Category name exceeds 255 characters');
  const values: Record<string, string | number> = {};
  for (const field of Object.keys(productInput.shape)) {
    const value = row[field];
    if (value) values[field] = field === 'price' ? Number(value) : value;
  }
  const parsed = productInput.safeParse(values);
  if (!parsed.success)
    throw new Error(
      parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
    );
  if (parsed.data.canonical_url) {
    parsed.data.canonical_url = catalogUrl(parsed.data.canonical_url);
  }
  return { values: parsed.data, categories };
}

function outcome(rowNumber: number, status: Outcome['status'], productId: string): Outcome {
  return { row_number: rowNumber, status, product_id: productId, error_code: '', detail: '' };
}

type Product = Omit<Selectable<CommerceProducts>, 'field_sources'> & {
  field_sources: Record<string, unknown>;
};
const indexed = (row: Selectable<CommerceProducts>): Product => ({
  ...row,
  field_sources: jsonObject(row.field_sources, 'commerce_products.field_sources'),
});
type Identity = { canonical_url?: string | null; sku?: string | null; gtin?: string | null };
const identityKeys = (row: Identity) =>
  [
    row.canonical_url ? `url:${row.canonical_url}` : '',
    row.sku ? `sku:${row.sku}` : '',
    row.gtin ? `gtin:${row.gtin}` : '',
  ].filter(Boolean);

/**
 * The project's products by URL, SKU and GTIN, read once per import (under the
 * catalog lock) and kept current as rows write, so each row matches in memory
 * instead of scanning unindexed identifier columns.
 */
class ProductIndex {
  private readonly rows = new Map<string, Product>();
  private readonly keys = new Map<string, Set<string>>();
  private readonly categories = new Map<string, string>();

  static async load(db: Database, scope: CommerceScope) {
    const index = new ProductIndex();
    const rows = await db
      .selectFrom('commerce_products')
      .selectAll()
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .execute();
    for (const row of rows) index.put(indexed(row));
    return index;
  }

  matches(values: Identity): Product[] {
    const ids = new Set(identityKeys(values).flatMap((key) => [...(this.keys.get(key) ?? [])]));
    return [...ids].flatMap((id) => this.rows.get(id) ?? []);
  }

  put(row: Product) {
    const prior = this.rows.get(row.id);
    if (prior) for (const key of identityKeys(prior)) this.keys.get(key)?.delete(row.id);
    this.rows.set(row.id, row);
    for (const key of identityKeys(row))
      this.keys.set(key, (this.keys.get(key) ?? new Set()).add(row.id));
  }

  async category(db: Database, scope: CommerceScope, name: string) {
    const key = categoryKey(name);
    const known = this.categories.get(key);
    if (known) return known;
    const { id } = await categoryByName(db, scope, name);
    this.categories.set(key, id);
    return id;
  }
}

async function importRow(
  db: Database,
  scope: CommerceScope,
  index: ProductIndex,
  importId: string,
  rowNumber: number,
  row: Record<string, string>,
): Promise<Outcome> {
  let parsed: ReturnType<typeof productValues>;
  try {
    parsed = productValues(row);
  } catch (error) {
    return {
      row_number: rowNumber,
      status: 'rejected',
      product_id: null,
      error_code: 'invalid_row',
      detail: String((error as Error).message).slice(0, 500),
    };
  }
  const { values, categories } = parsed;
  const matches = index.matches(values);
  if (matches.length > 1)
    throw new ApiError(409, `Row ${rowNumber}: identifiers resolve to different products`, {
      code: 'commerce_conflict',
    });
  if (!matches.length && !values.canonical_url)
    return {
      row_number: rowNumber,
      status: 'rejected',
      product_id: null,
      error_code: 'invalid_row',
      detail: 'canonical_url is required for a new product',
    };
  const product = matches[0] ?? indexed(await newProduct(db, scope, values.canonical_url!));
  const sources = { ...product.field_sources };
  let changed = false;
  for (const [field, value] of Object.entries(values)) {
    const previous = product[field as keyof typeof values];
    if ((field === 'price' && previous !== null ? Number(previous) : previous) !== value)
      changed = true;
    sources[field] = {
      kind: 'csv',
      source_id: importId,
      row_number: rowNumber,
      version: policy.commerce.importer_version,
    };
  }
  const update: Updateable<CommerceProducts> = {
    ...values,
    field_sources: JSON.stringify(sources),
    updated_at: new Date(),
  };
  await db
    .updateTable('commerce_products')
    .set(update)
    .where('id', '=', product.id)
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .execute();
  const observationId = await appendObservation(db, scope, product.id, {
    source_kind: 'csv',
    csv_import_id: importId,
    csv_row_number: rowNumber,
    observed_fields: JSON.stringify(values),
    importer_version: policy.commerce.importer_version,
  });
  index.put({
    ...product,
    ...values,
    price: values.price === undefined ? product.price : String(values.price),
    field_sources: sources,
  });
  for (const name of categories)
    await addMembership(
      db,
      scope,
      product.id,
      await index.category(db, scope, name),
      observationId,
    );
  if (!matches.length) return outcome(rowNumber, 'created', product.id);
  return outcome(rowNumber, changed ? 'updated' : 'unchanged', product.id);
}

export function importCatalog(
  db: Database,
  scope: CommerceScope,
  input: { content: string; filename: string; content_type: string },
) {
  const rows = rowsOf(input.content);
  const hash = createHash('sha256').update(input.content).digest('hex');
  return db.transaction().execute(async (trx) => {
    await lockCatalog(trx, scope);
    const prior = await trx
      .selectFrom('commerce_csv_imports')
      .selectAll()
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .where('content_hash', '=', hash)
      .executeTakeFirst();
    if (prior)
      return catalogImportSchema.parse({
        import_id: prior.id,
        created: prior.created_count,
        updated: prior.updated_count,
        unchanged: prior.unchanged_count,
        rejected: prior.rejected_count,
        row_outcomes: jsonObjects(prior.row_outcomes, 'commerce_csv_imports.row_outcomes').slice(
          0,
          policy.commerce.import_error_limit,
        ),
      });
    const id = randomUUID();
    await trx
      .insertInto('commerce_csv_imports')
      .values({
        id,
        workspace_id: scope.workspaceId,
        project_id: scope.projectId,
        content_hash: hash,
        filename: input.filename,
        content_type: input.content_type,
        raw_payload: input.content,
        row_outcomes: '[]',
        created_count: 0,
        updated_count: 0,
        unchanged_count: 0,
        rejected_count: 0,
        importer_version: policy.commerce.importer_version,
        created_at: new Date(),
      })
      .execute();
    const index = await ProductIndex.load(trx, scope);
    const outcomes: Outcome[] = [];
    for (const [position, row] of rows.entries())
      outcomes.push(await importRow(trx, scope, index, id, position + 2, row));
    const counts = { created: 0, updated: 0, unchanged: 0, rejected: 0 };
    for (const row of outcomes) counts[row.status]++;
    await trx
      .updateTable('commerce_csv_imports')
      .set({
        row_outcomes: JSON.stringify(outcomes),
        created_count: counts.created,
        updated_count: counts.updated,
        unchanged_count: counts.unchanged,
        rejected_count: counts.rejected,
      })
      .where('id', '=', id)
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .execute();
    return {
      import_id: id,
      ...counts,
      row_outcomes: outcomes.slice(0, policy.commerce.import_error_limit),
    };
  });
}
