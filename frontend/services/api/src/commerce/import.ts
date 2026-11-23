import { createHash, randomUUID } from 'node:crypto';
import {
  catalogImportSchema,
  catalogImportStageSchema,
  type CatalogImport,
} from '@citeladder/contracts/commerce-suite';
import type { Selectable, Updateable } from 'kysely';

import { policy } from '../config.ts';
import { inTransaction, type Database } from '../db/database.ts';
import { jsonObject, jsonObjects } from '../db/json.ts';
import type { CommerceCsvImports, CommerceProducts } from '../generated/db-schema.ts';
import {
  addMembership,
  appendObservation,
  categoryByName,
  editedField,
  lockCatalog,
  newProduct,
  setCategoryParent,
} from './catalog-store.ts';
import { commerceMissing, type CommerceScope } from './reads.ts';
import { recordCatalogRevision } from './catalog-revisions.ts';
import {
  catalogItems,
  catalogValuesSchema,
  keptCategories,
  proposedTree,
  treeProposal,
  type CatalogFormat,
  type CatalogItem,
  type CatalogValues,
  type CatalogVariant,
} from './catalog-sources.ts';
import { categorySet, comparable, editHolds, importedBaseline } from './edits.ts';
import { categoryKey } from './projection-facts.ts';
import { widen } from '../widen.ts';

type Outcome = CatalogImport['row_outcomes'][number];
type ImportRow = Selectable<CommerceCsvImports>;
type ParsedItem = Extract<CatalogItem, { kind: 'item' }>;

function editAware(
  sources: Record<string, unknown>,
  values: CatalogValues,
  categories: readonly string[],
  provenance: Record<string, unknown>,
) {
  const applied = catalogValuesSchema.parse(
    Object.fromEntries(
      Object.entries(values).filter(
        ([field, value]) => !editHolds(sources, field, comparable(field, value)),
      ),
    ),
  );
  if (applied.price === undefined) delete applied.price_max;
  const keys = categorySet(categories);
  if (!keys.length || editHolds(sources, 'categories', keys))
    return { applied, added: widen<string[]>([]), replaces: false };
  const replaces = editedField(sources, 'categories');
  sources.categories = { ...provenance, keys };
  return { applied, added: [...categories], replaces };
}

async function writeCategories(
  db: Database,
  scope: CommerceScope,
  index: ProductIndex,
  write: { productId: string; observationId: string; added: string[]; replaces: boolean },
) {
  const ids: string[] = [];
  for (const name of write.added) ids.push(await index.category(db, scope, name)); // NOSONAR
  for (const id of ids) await addMembership(db, scope, write.productId, id, write.observationId); // NOSONAR
  if (!write.replaces) return;
  await db
    .deleteFrom('commerce_product_categories')
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('product_id', '=', write.productId)
    .where('category_id', 'not in', ids)
    .execute();
}

const outcome = (rowNumber: number, status: Outcome['status'], productId: string): Outcome => ({
  row_number: rowNumber,
  status,
  product_id: productId,
  error_code: '',
  detail: '',
});
const rejected = (rowNumber: number, errorCode: string, detail: string): Outcome => ({
  row_number: rowNumber,
  status: 'rejected',
  product_id: null,
  error_code: errorCode,
  detail,
});

type Product = Omit<Selectable<CommerceProducts>, 'field_sources'> & {
  field_sources: Record<string, unknown>;
};
const indexed = (row: Selectable<CommerceProducts>): Product => ({
  ...row,
  field_sources: jsonObject(row.field_sources, 'commerce_products.field_sources'),
});
type Identity = {
  canonical_url?: string | null;
  sku?: string | null;
  gtin?: string | null;
  name?: string | null;
  brand?: string | null;
};
const identityKeys = (row: Identity) =>
  [
    row.canonical_url ? `url:${row.canonical_url}` : '',
    row.sku ? `sku:${row.sku}` : '',
    row.gtin ? `gtin:${row.gtin}` : '',
  ].filter(Boolean);
const nameKey = (row: Identity) =>
  row.name ? `name:${categoryKey(row.brand ?? '')}|${categoryKey(row.name)}` : '';

function importedKeys(row: Product) {
  const imported = (field: keyof Identity) => {
    const value = importedBaseline(row.field_sources, field);
    return typeof value === 'string' ? value : null;
  };
  return identityKeys({
    canonical_url: imported('canonical_url'),
    sku: imported('sku'),
    gtin: imported('gtin'),
  });
}

class ProductIndex {
  private readonly rows = new Map<string, Product>();
  private readonly keys = new Map<string, Set<string>>();
  private readonly replaced = new Map<string, Set<string>>();
  private readonly categories = new Map<string, string>();
  private readonly memberships = new Map<string, Set<string>>();

  static async load(db: Database, scope: CommerceScope) {
    const index = new ProductIndex();
    const [rows, memberships] = await Promise.all([
      db
        .selectFrom('commerce_products')
        .selectAll()
        .where('workspace_id', '=', scope.workspaceId)
        .where('project_id', '=', scope.projectId)
        .execute(),
      db
        .selectFrom('commerce_product_categories as m')
        .innerJoin('commerce_categories as c', (join) =>
          join
            .onRef('c.id', '=', 'm.category_id')
            .onRef('c.workspace_id', '=', 'm.workspace_id')
            .onRef('c.project_id', '=', 'm.project_id'),
        )
        .select(['m.product_id', 'c.normalized_name'])
        .where('m.workspace_id', '=', scope.workspaceId)
        .where('m.project_id', '=', scope.projectId)
        .execute(),
    ]);
    for (const row of rows) index.put(indexed(row));
    for (const row of memberships)
      index.memberships.set(
        row.product_id,
        (index.memberships.get(row.product_id) ?? new Set()).add(row.normalized_name),
      );
    return index;
  }

  joins(productId: string, names: readonly string[]) {
    const keys = this.memberships.get(productId) ?? new Set<string>();
    const fresh = names.map(categoryKey).filter((key) => !keys.has(key));
    for (const key of fresh) keys.add(key);
    this.memberships.set(productId, keys);
    return fresh.length > 0;
  }

  private static add(map: Map<string, Set<string>>, keys: string[], id: string) {
    for (const key of keys) map.set(key, (map.get(key) ?? new Set()).add(id));
  }

  matches(values: Identity): Product[] {
    const ids = (map: Map<string, Set<string>>, keys: string[]) =>
      new Set(keys.flatMap((key) => [...(map.get(key) ?? [])]));
    const keys = identityKeys(values);
    let found = keys.length ? ids(this.keys, keys) : ids(this.keys, [nameKey(values)]);
    if (!found.size) found = ids(this.replaced, keys);
    return [...found].flatMap((id) => this.rows.get(id) ?? []);
  }

  put(row: Product) {
    const prior = this.rows.get(row.id);
    if (prior) {
      for (const key of [...identityKeys(prior), nameKey(prior)])
        this.keys.get(key)?.delete(row.id);
      for (const key of importedKeys(prior)) this.replaced.get(key)?.delete(row.id);
    }
    this.rows.set(row.id, row);
    ProductIndex.add(this.keys, [...identityKeys(row), nameKey(row)].filter(Boolean), row.id);
    ProductIndex.add(this.replaced, importedKeys(row), row.id);
  }

  async category(db: Database, scope: CommerceScope, name: string) {
    const key = categoryKey(name);
    const known = this.categories.get(key);
    if (known) return known;
    const { id } = await categoryByName(db, scope, name);
    this.categories.set(key, id);
    return id;
  }

  written(): ReadonlyMap<string, string> {
    return this.categories;
  }
}

const numeric = (value: string | number | null | undefined) =>
  value === null || value === undefined ? null : Number(value);
const stored = (value: number | null) => (value === null ? null : String(value));

function changes(product: Product, applied: CatalogValues) {
  return Object.entries(applied).some(([field, value]) => {
    const previous = product[field as keyof CatalogValues];
    return field === 'price' || field === 'price_max'
      ? numeric(previous) !== value
      : (previous ?? '') !== value;
  });
}

const aliasOf = (product: Product, url: string | undefined) =>
  product.canonical_url && url && product.canonical_url !== url ? url : undefined;

function rowColumns(product: Product, applied: CatalogValues, variants: CatalogVariant[]) {
  const priceMax = applied.price === undefined ? undefined : (applied.price_max ?? null);
  const listed = variants.length ? JSON.stringify(variants) : undefined;
  const changed =
    changes(product, applied) ||
    (priceMax === null && product.price_max !== null) ||
    (listed !== undefined && listed !== JSON.stringify(product.variants));
  const columns: Updateable<CommerceProducts> = {
    ...applied,
    ...(priceMax === undefined ? {} : { price_max: priceMax }),
    ...(listed ? { variants: listed } : {}),
  };
  const after = (sources: Record<string, unknown>): Product => ({
    ...product,
    ...applied,
    price: applied.price === undefined ? product.price : String(applied.price),
    price_max: priceMax === undefined ? product.price_max : stored(priceMax),
    variants: listed ? variants : product.variants,
    field_sources: sources,
  });
  return { columns, listed: listed !== undefined, changed, after };
}

async function importItem(
  db: Database,
  scope: CommerceScope,
  run: { index: ProductIndex; importId: string; format: CatalogFormat; excluded: Set<string> },
  item: ParsedItem,
): Promise<Outcome> {
  const { index } = run;
  const values = { ...item.values };
  const matches = index.matches(values);
  if (matches.length > 1)
    return rejected(
      item.row_number,
      'identity_conflict',
      'Its URL, SKU, GTIN or name belong to different products',
    );
  const product = matches[0] ?? indexed(await newProduct(db, scope, values.canonical_url ?? ''));
  const alias = aliasOf(product, values.canonical_url);
  if (alias) delete values.canonical_url;
  const sources = { ...product.field_sources };
  const provenance = {
    kind: 'csv',
    format: run.format,
    source_id: run.importId,
    row_number: item.row_number,
    version: policy.commerce.importer_version,
  };
  const categories = keptCategories(item.paths, run.excluded);
  const { applied, added, replaces } = editAware(sources, values, categories, provenance);
  const row = rowColumns(product, applied, item.variants);
  const joined = index.joins(product.id, added);
  for (const field of Object.keys(applied)) sources[field] = provenance;
  if (row.listed) sources.variants = provenance;
  await db
    .updateTable('commerce_products')
    .set({ ...row.columns, field_sources: JSON.stringify(sources), updated_at: new Date() })
    .where('id', '=', product.id)
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .execute();
  const observationId = await appendObservation(db, scope, product.id, {
    source_kind: 'csv',
    csv_import_id: run.importId,
    csv_row_number: item.row_number,
    observed_fields: JSON.stringify({
      ...item.values,
      ...(item.variants.length ? { variants: item.variants } : {}),
      categories: item.paths.map((path) => path.join(' > ')),
      ...(alias ? { alias_url: alias } : {}),
    }),
    importer_version: policy.commerce.importer_version,
  });
  index.put(row.after(sources));
  await writeCategories(db, scope, index, {
    productId: product.id,
    observationId,
    added,
    replaces,
  });
  if (!matches.length) return outcome(item.row_number, 'created', product.id);
  return outcome(item.row_number, row.changed || joined ? 'updated' : 'unchanged', product.id);
}

async function writeParents(
  db: Database,
  scope: CommerceScope,
  items: readonly CatalogItem[],
  written: ReadonlyMap<string, string>,
) {
  for (const node of proposedTree(items).values()) {
    const childId = written.get(node.key);
    const parentId = node.parent_key ? written.get(node.parent_key) : undefined;
    if (childId && parentId)
      await setCategoryParent(db, scope, { childId, parentId, replace: true }); // NOSONAR
  }
}

function resultOf(row: ImportRow): CatalogImport {
  return catalogImportSchema.parse({
    import_id: row.id,
    created: row.created_count,
    updated: row.updated_count,
    unchanged: row.unchanged_count,
    rejected: row.rejected_count,
    row_outcomes: jsonObjects(row.row_outcomes, 'commerce_csv_imports.row_outcomes').slice(
      0,
      policy.commerce.import_error_limit,
    ),
  });
}

async function stageOf(db: Database, scope: CommerceScope, row: ImportRow, items: CatalogItem[]) {
  const existing = await db
    .selectFrom('commerce_categories')
    .select('normalized_name')
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .execute();
  return catalogImportStageSchema.parse({
    import_id: row.id,
    source_format: row.source_format,
    source_label: row.source_format === 'shopify' ? row.source_ref : row.filename,
    products: items.filter((item) => item.kind === 'item').length,
    rejected: items.filter((item) => item.kind === 'rejected').length,
    categories: treeProposal(items, new Set(existing.map((category) => category.normalized_name))),
    result: row.applied_at ? resultOf(row) : null,
  });
}

function contentType(format: CatalogFormat, content: string) {
  const start = content.trimStart();
  if (format === 'shopify' || start.startsWith('{') || start.startsWith('['))
    return 'application/json';
  if (start.startsWith('<')) return 'application/xml';
  return (content.split('\n', 1)[0] ?? '').includes('\t')
    ? 'text/tab-separated-values'
    : 'text/csv';
}

type CatalogSource = {
  format: CatalogFormat;
  content: string;
  label: string;
};

export async function stageImport(db: Database, scope: CommerceScope, source: CatalogSource) {
  const items = catalogItems(source.format, source.content);
  const hash = createHash('sha256').update(`${source.format}\n${source.content}`).digest('hex');
  const row = await inTransaction(db, async (trx) => {
    await lockCatalog(trx, scope);
    const prior = await trx
      .selectFrom('commerce_csv_imports')
      .selectAll()
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .where('content_hash', '=', hash)
      .executeTakeFirst();
    if (prior) return prior;
    return trx
      .insertInto('commerce_csv_imports')
      .values({
        id: randomUUID(),
        workspace_id: scope.workspaceId,
        project_id: scope.projectId,
        content_hash: hash,
        source_format: source.format,
        source_ref: source.format === 'shopify' ? source.label : '',
        filename: source.label.slice(0, 255),
        content_type: contentType(source.format, source.content),
        raw_payload: source.content,
        row_outcomes: '[]',
        excluded_categories: '[]',
        created_count: 0,
        updated_count: 0,
        unchanged_count: 0,
        rejected_count: 0,
        importer_version: policy.commerce.importer_version,
        created_at: new Date(),
        applied_at: null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  });
  return stageOf(db, scope, row, items);
}

export function applyImport(
  db: Database,
  scope: CommerceScope,
  importId: string,
  excluded: readonly string[],
) {
  return inTransaction(db, async (trx) => {
    await lockCatalog(trx, scope);
    const row = await trx
      .selectFrom('commerce_csv_imports')
      .selectAll()
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .where('id', '=', importId)
      .forUpdate()
      .executeTakeFirst();
    if (!row) commerceMissing('Import not found');
    if (row.applied_at) return resultOf(row);
    const format = catalogImportStageSchema.shape.source_format.parse(row.source_format);
    const items = catalogItems(format, row.raw_payload);
    const index = await ProductIndex.load(trx, scope);
    const run = { index, importId: row.id, format, excluded: new Set(excluded.map(categoryKey)) };
    const outcomes: Outcome[] = [];
    for (const item of items)
      outcomes.push(
        item.kind === 'rejected'
          ? rejected(item.row_number, 'invalid_row', item.detail)
          : await importItem(trx, scope, run, item), // NOSONAR
      );
    await writeParents(trx, scope, items, index.written());
    outcomes.sort(
      (a, b) =>
        Number(b.status === 'rejected') - Number(a.status === 'rejected') ||
        a.row_number - b.row_number,
    );
    const counts = { created: 0, updated: 0, unchanged: 0, rejected: 0 };
    for (const entry of outcomes) counts[entry.status]++;
    const applied = await trx
      .updateTable('commerce_csv_imports')
      .set({
        row_outcomes: JSON.stringify(outcomes),
        excluded_categories: JSON.stringify([...run.excluded]),
        created_count: counts.created,
        updated_count: counts.updated,
        unchanged_count: counts.unchanged,
        rejected_count: counts.rejected,
        applied_at: new Date(),
      })
      .where('id', '=', row.id)
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .returningAll()
      .executeTakeFirstOrThrow();
    await recordCatalogRevision(trx, scope, { kind: 'import', id: row.id });
    return resultOf(applied);
  });
}
