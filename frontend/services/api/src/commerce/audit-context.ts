import type { Selectable } from 'kysely';
import type { Database } from '../db/database.ts';
import type { CommerceProducts } from '../generated/db-schema.ts';
import { ApiError, notFound } from '../errors.ts';
import { auditPolicy } from '../audits/config.ts';
import type { CommerceScope } from './reads.ts';

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
  const targets = promptIds.length
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
