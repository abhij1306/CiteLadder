import type { Selectable } from 'kysely';
import type { Database } from '../db/database.ts';
import type { CommerceProducts } from '../generated/db-schema.ts';
import { ApiError, notFound } from '../errors.ts';
import { auditPolicy } from '../audits/config.ts';
import type { CommerceScope } from './reads.ts';
import { recordCatalogRevision } from './catalog-revisions.ts';

const unavailable = (message: string) => new ApiError(400, message);
function productEvidence(product: Selectable<CommerceProducts>) {
  return {
    id: product.id,
    canonical_url: product.canonical_url,
    name: product.name,
    brand: product.brand,
    sku: product.sku,
    gtin: product.gtin,
    mpn: product.mpn,
    price: product.price === null ? null : Number(product.price),
    currency: product.currency,
    attributes: product.attributes,
    field_sources: product.field_sources,
  };
}

/** The archived products among prompt targets. */
async function archivedProducts(
  db: Database,
  scope: CommerceScope,
  targets: readonly { target_kind: string; target_id: string }[],
) {
  const ids = targets.filter((row) => row.target_kind === 'product').map((row) => row.target_id);
  if (!ids.length) return new Set<string>();
  const rows = await db
    .selectFrom('commerce_products')
    .select('id')
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('id', 'in', ids)
    .where('lifecycle_state', '=', 'archived')
    .execute();
  return new Set(rows.map((row) => row.id));
}

/** Copy approved target evidence at admission; workers never reread the mutable catalog. */
export async function freezeCommerceContext(
  db: Database,
  scope: CommerceScope,
  promptIds: string[],
) {
  const project = await db
    .selectFrom('projects')
    .select('id')
    .where('workspace_id', '=', scope.workspaceId)
    .where('id', '=', scope.projectId)
    .executeTakeFirst();
  if (!project) throw notFound('Project');
  const approved = promptIds.length
    ? await db
        .selectFrom('commerce_prompt_targets')
        .selectAll()
        .where('workspace_id', '=', scope.workspaceId)
        .where('project_id', '=', scope.projectId)
        .where('prompt_id', 'in', promptIds)
        .where('approved_at', 'is not', null)
        .orderBy('created_at')
        .orderBy('id')
        .execute()
    : [];
  // An archived product is out of prompt context: its prompts freeze no target.
  const archived = await archivedProducts(db, scope, approved);
  const targets = approved.filter((target) => !archived.has(target.target_id));
  const evidence = [];
  // Several approved prompts share one target; its evidence is frozen once.
  const distinct = new Map(targets.map((row) => [`${row.target_kind}:${row.target_id}`, row]));
  for (const target of distinct.values()) {
    const category =
      target.target_kind === 'category'
        ? await db
            .selectFrom('commerce_categories')
            .select(['id', 'name'])
            .where('workspace_id', '=', scope.workspaceId)
            .where('project_id', '=', scope.projectId)
            .where('id', '=', target.target_id)
            .executeTakeFirst()
        : null;
    if (target.target_kind === 'category' && !category)
      throw unavailable('Selected Commerce category is unavailable');
    let products;
    if (target.target_kind === 'product') {
      products = await db
        .selectFrom('commerce_products')
        .selectAll()
        .where('workspace_id', '=', scope.workspaceId)
        .where('project_id', '=', scope.projectId)
        .where('id', '=', target.target_id)
        .where('lifecycle_state', '=', 'active')
        .execute();
    } else if (target.target_kind === 'category') {
      products = await db
        .selectFrom('commerce_products as p')
        .innerJoin('commerce_product_categories as m', 'm.product_id', 'p.id')
        .selectAll('p')
        .where('p.workspace_id', '=', scope.workspaceId)
        .where('p.project_id', '=', scope.projectId)
        .where('m.workspace_id', '=', scope.workspaceId)
        .where('m.project_id', '=', scope.projectId)
        .where('m.category_id', '=', target.target_id)
        .where('p.lifecycle_state', '=', 'active')
        .orderBy('p.id')
        .execute();
    } else throw unavailable('Selected Commerce target kind is unsupported');
    if (!products.length)
      throw unavailable('Selected Commerce target has no active product evidence');
    const competitors = await db
      .selectFrom('commerce_competitor_candidates')
      .select(['id', 'canonical_url', 'product_name', 'brand_name'])
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .where('target_kind', '=', target.target_kind)
      .where('target_id', '=', target.target_id)
      .where('state', '=', 'approved')
      .orderBy('id')
      .execute();
    evidence.push({
      kind: target.target_kind,
      id: target.target_id,
      category: category ?? null,
      products: products.map(productEvidence),
      approved_competitors: competitors,
    });
  }
  return {
    targets: evidence,
    prompt_target_ids: targets.map((target) => target.id),
    ...auditPolicy.commerce_versions,
  };
}

/**
 * Every audit scope of a project that qualifies for catalog matching freezes
 * the current catalog revision, recording a new one when the catalog changed
 * since the last, so brand answers are matched too (CM1). Projects without the
 * `commerce` capability or with no catalog and no approved competitor freeze
 * nothing and pay nothing.
 */
export async function freezeCatalogRevision(db: Database, scope: CommerceScope) {
  const revision = await recordCatalogRevision(db, scope, { kind: 'audit', id: null });
  return revision
    ? {
        commerce_catalog: {
          revision_id: revision.id,
          revision_number: revision.revision_number,
          parser_version: auditPolicy.commerce_versions.parser_version,
          matcher_version: auditPolicy.commerce_versions.matcher_version,
        },
      }
    : {};
}
