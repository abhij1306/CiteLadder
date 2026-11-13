import { randomUUID } from 'node:crypto';
import { sql, type Insertable, type Selectable } from 'kysely';

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import type { CommerceProducts, CommerceProductObservations } from '../generated/db-schema.ts';
import { categoryKey, isCategoryName, UNCATEGORIZED_KEY } from './projection-facts.ts';
import { commerceMissing, type CommerceScope } from './reads.ts';

/**
 * Catalog writers serialize at the project, before touching catalog rows.
 *
 * `FOR NO KEY UPDATE`, not `FOR UPDATE`: every insert into a table that
 * references `projects` takes a key-share lock on the row, so a full update
 * lock would stall the project's audits, crawls and queue writes for as long
 * as a large import runs. This still excludes other catalog writers and a
 * concurrent project delete.
 */
export async function lockCatalog(db: Database, scope: CommerceScope) {
  const project = await db
    .selectFrom('projects')
    .select('id')
    .where('workspace_id', '=', scope.workspaceId)
    .where('id', '=', scope.projectId)
    .forNoKeyUpdate()
    .executeTakeFirst();
  if (!project) commerceMissing('Project not found');
}

export function newProduct(
  db: Database,
  scope: CommerceScope,
  url: string,
): Promise<Selectable<CommerceProducts>> {
  return db
    .insertInto('commerce_products')
    .values({
      id: randomUUID(),
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      canonical_url: url,
      name: '',
      description: '',
      brand: '',
      price: null,
      price_max: null,
      image_url: '',
      currency: '',
      sku: null,
      gtin: null,
      mpn: null,
      observed_external_id: '',
      variants: '[]',
      attributes: '{}',
      field_sources: '{}',
      lifecycle_state: 'active',
      created_at: new Date(),
      updated_at: new Date(),
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export async function categoryByName(db: Database, scope: CommerceScope, name: string) {
  const normalized = categoryKey(name);
  if (!isCategoryName(name)) throw new Error('A catalog category needs a real name');
  const existing = await db
    .selectFrom('commerce_categories')
    .selectAll()
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('normalized_name', '=', normalized)
    .executeTakeFirst();
  if (existing) return existing;
  return db
    .insertInto('commerce_categories')
    .values({
      id: randomUUID(),
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      name: name.trim(),
      normalized_name: normalized,
      role: 'unknown',
      canonical_url: '',
      field_sources: '{}',
      source_analysis_id: null,
      projector_version: policy.commerce.projector_version,
      created_at: new Date(),
      updated_at: new Date(),
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

/**
 * Name `parentId` the category one level up of `childId`, both of this
 * project. A parent that would close a cycle is never written. Crawl
 * projection only fills a category that has no parent (`replace: false`); an
 * applied import, an explicit decision, replaces it.
 */
export async function setCategoryParent(
  db: Database,
  scope: CommerceScope,
  link: { childId: string; parentId: string; replace: boolean },
) {
  if (link.childId === link.parentId) return;
  const ws = scope.workspaceId,
    project = scope.projectId;
  const { rows } = await sql<{ cycle: boolean }>`
    WITH RECURSIVE up(id) AS (
      SELECT ${link.parentId}::uuid
      UNION
      SELECT c.parent_category_id FROM commerce_categories c JOIN up ON c.id = up.id
      WHERE c.workspace_id = ${ws} AND c.project_id = ${project}
        AND c.parent_category_id IS NOT NULL
    )
    SELECT EXISTS (SELECT 1 FROM up WHERE id = ${link.childId}) AS cycle`.execute(db);
  if (rows[0]?.cycle) return;
  await db
    .updateTable('commerce_categories')
    .set({ parent_category_id: link.parentId, updated_at: new Date() })
    .where('workspace_id', '=', ws)
    .where('project_id', '=', project)
    .where('id', '=', link.childId)
    .where((eb) =>
      link.replace
        ? eb.or([
            eb('parent_category_id', 'is', null),
            eb('parent_category_id', '!=', link.parentId),
          ])
        : eb('parent_category_id', 'is', null),
    )
    .execute();
}

/**
 * A product's category memberships joined to their categories (`m`, `c`),
 * the platform's "Uncategorized" left out; the caller selects and orders.
 */
export function productCategories(db: Database, scope: CommerceScope, productId: string) {
  return db
    .selectFrom('commerce_product_categories as m')
    .innerJoin('commerce_categories as c', (join) =>
      join.onRef('c.id', '=', 'm.category_id').onRef('c.workspace_id', '=', 'm.workspace_id'),
    )
    .where('m.workspace_id', '=', scope.workspaceId)
    .where('m.project_id', '=', scope.projectId)
    .where('m.product_id', '=', productId)
    .where('c.normalized_name', '!=', UNCATEGORIZED_KEY);
}

export async function addMembership(
  db: Database,
  scope: CommerceScope,
  productId: string,
  categoryId: string,
  observationId: string | null,
) {
  await db
    .insertInto('commerce_product_categories')
    .values({
      id: randomUUID(),
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      product_id: productId,
      category_id: categoryId,
      source_observation_id: observationId,
      created_at: new Date(),
    })
    .onConflict((oc) =>
      // A shelf link records no observation; later product evidence supplies one.
      oc
        .columns(['product_id', 'category_id'])
        .doUpdateSet({ source_observation_id: (eb) => eb.ref('excluded.source_observation_id') })
        .where('commerce_product_categories.source_observation_id', 'is', null),
    )
    .execute();
}

type Evidence = Pick<Insertable<CommerceProductObservations>, 'source_kind' | 'observed_fields'> &
  Partial<
    Pick<
      Insertable<CommerceProductObservations>,
      | 'csv_import_id'
      | 'csv_row_number'
      | 'source_analysis_id'
      | 'source_artifact_id'
      | 'extractor_version'
      | 'classifier_version'
      | 'importer_version'
      | 'projector_version'
      | 'edit_version'
    >
  >;

/** Whether an in-app edit owns this field now: crawl never replaces it. */
export function editedField(sources: Record<string, unknown>, field: string) {
  const source = sources[field];
  return (
    typeof source === 'object' && source !== null && 'kind' in source && source.kind === 'edit'
  );
}

export async function appendObservation(
  db: Database,
  scope: CommerceScope,
  productId: string,
  evidence: Evidence,
) {
  const id = randomUUID();
  await db
    .insertInto('commerce_product_observations')
    .values({
      id,
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      product_id: productId,
      csv_import_id: null,
      csv_row_number: null,
      source_analysis_id: null,
      source_artifact_id: null,
      extractor_version: '',
      classifier_version: '',
      importer_version: '',
      projector_version: '',
      edit_version: '',
      created_at: new Date(),
      ...evidence,
    })
    .execute();
  return id;
}
