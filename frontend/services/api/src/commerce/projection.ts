import { sql, type Updateable } from 'kysely';
import { z } from 'zod';
import { commerceCategorySchema } from '@citeladder/contracts/commerce-suite';

import { loadWorkerSettings, policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { jsonObject } from '../db/json.ts';
import { enqueueTask } from '../referrals/enqueue.ts';
import type { CommerceProducts } from '../generated/db-schema.ts';
import { TerminalExecutorError, type Executor } from '../workers/executor.ts';
import {
  addMembership,
  appendObservation,
  categoryByName,
  lockCatalog,
  newProduct,
} from './catalog-store.ts';
import type { CommerceScope } from './reads.ts';
import {
  catalogUrl,
  categoryKey,
  categoryTitle,
  pageIdentity,
  PRODUCT_FIELDS,
  productAlias,
  productCategories,
  productFacts,
  readFacts,
  sellsCatalog,
  shelfLinks,
  type CatalogFacts,
} from './projection-facts.ts';

type Source = Awaited<ReturnType<typeof sourceOf>>;

async function sourceOf(db: Database, scope: CommerceScope, id: string) {
  const source = await db
    .selectFrom('site_page_analyses as a')
    .innerJoin('site_fetch_artifacts as f', 'f.id', 'a.artifact_id')
    .innerJoin('site_urls as u', 'u.id', 'a.site_url_id')
    .select([
      'a.id',
      'a.page_kind',
      'a.crawl_id',
      'a.classifier_version',
      'f.id as artifact_id',
      'f.normalized_facts',
      'f.extractor_version',
      'f.final_url',
      'f.requested_url',
      'u.normalized_url',
      'u.latest_title',
    ])
    .where('a.workspace_id', '=', scope.workspaceId)
    .where('a.project_id', '=', scope.projectId)
    .where('f.workspace_id', '=', scope.workspaceId)
    .where('u.workspace_id', '=', scope.workspaceId)
    .where('u.project_id', '=', scope.projectId)
    .where('a.id', '=', id)
    .executeTakeFirst();
  if (!source)
    throw new TerminalExecutorError(
      'commerce_source_missing',
      'Source Site Health analysis not found',
    );
  return source;
}

async function projectCategory(
  db: Database,
  scope: CommerceScope,
  source: Source,
  facts: CatalogFacts,
  url: string,
) {
  const name = categoryTitle(facts, source.latest_title);
  // A listing with no name of its own cannot be told apart from another shelf.
  if (!name) return null;
  const key = categoryKey(name);
  // The category owning this name wins over one matched by URL, so the rename
  // below can never collide with the (project_id, normalized_name) key.
  const existing = await db
    .selectFrom('commerce_categories')
    .selectAll()
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where((eb) => eb.or([eb('normalized_name', '=', key), eb('canonical_url', '=', url)]))
    .orderBy(sql`normalized_name = ${key}`, 'desc')
    .orderBy('id')
    .executeTakeFirst();
  const category = existing ?? (await categoryByName(db, scope, name));
  const provenance = {
    kind: 'site_health',
    source_id: source.id,
    artifact_id: source.artifact_id,
    version: policy.commerce.projector_version,
  };
  const role = commerceCategorySchema.shape.role.safeParse(facts.commerce.category_role);
  await db
    .updateTable('commerce_categories')
    .set({
      name,
      normalized_name: key,
      canonical_url: url,
      role: role.success ? role.data : 'unknown',
      source_analysis_id: source.id,
      projector_version: policy.commerce.projector_version,
      updated_at: new Date(),
      field_sources: JSON.stringify({
        ...jsonObject(category.field_sources, 'commerce_categories.field_sources'),
        name: provenance,
        role: provenance,
      }),
    })
    .where('id', '=', category.id)
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .execute();
  return { shelfId: category.id };
}

/** What a projection may newly link: its own shelf, or its own product. */
type Linkable = { shelfId: string } | { productId: string };

async function projectProduct(
  db: Database,
  scope: CommerceScope,
  source: Source,
  facts: CatalogFacts,
  url: string,
): Promise<Linkable | null> {
  const prior = await db
    .selectFrom('commerce_product_observations')
    .select('id')
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('source_analysis_id', '=', source.id)
    .where('projector_version', '=', policy.commerce.projector_version)
    .executeTakeFirst();
  if (prior) return null;
  const projection = productFacts(facts, url);
  // A listing page the classifier called a product is projected as the shelf it
  // is. An unidentifiable product page that lists no products (a sold-out PDP
  // without identifiers or price) is skipped: projected as a category, its
  // parent breadcrumb would take over that real shelf.
  if (!projection.identified)
    return facts.commerce.product_cards.length
      ? projectCategory(db, scope, source, facts, url)
      : null;
  const existing = await db
    .selectFrom('commerce_products')
    .selectAll()
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('canonical_url', '=', url)
    .executeTakeFirst();
  const product = existing ?? (await newProduct(db, scope, url));
  const sources = jsonObject(product.field_sources, 'commerce_products.field_sources');
  const values: Partial<typeof projection.values> = { ...projection.values };
  for (const field of PRODUCT_FIELDS) {
    const value = projection.values[field];
    const provenance =
      sources[field] === undefined ? {} : jsonObject(sources[field], `field_sources.${field}`);
    if (
      provenance.kind === 'csv' ||
      provenance.kind === 'edit' ||
      value === null ||
      value === '' ||
      (typeof value === 'object' && Object.keys(value).length === 0)
    ) {
      delete values[field];
      continue;
    }
    sources[field] = {
      kind: 'site_health',
      source_id: source.id,
      artifact_id: source.artifact_id,
      version: policy.commerce.projector_version,
      ...(projection.evidencePaths[field]
        ? { evidence_path: projection.evidencePaths[field] }
        : {}),
    };
  }
  // Values are selected from one typed product projection. JSON columns are
  // serialized explicitly for pg; no ORM defaults.
  const { variants, attributes, ...scalarValues } = values;
  const update: Updateable<CommerceProducts> = {
    ...scalarValues,
    field_sources: JSON.stringify(sources),
    updated_at: new Date(),
    ...(variants === undefined ? {} : { variants: JSON.stringify(variants) }),
    ...(attributes === undefined ? {} : { attributes: JSON.stringify(attributes) }),
  };
  await db
    .updateTable('commerce_products')
    .set(update)
    .where('id', '=', product.id)
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .execute();
  const observation = await appendObservation(db, scope, product.id, {
    source_kind: 'site_health',
    source_analysis_id: source.id,
    source_artifact_id: source.artifact_id,
    observed_fields: JSON.stringify({
      ...projection.values,
      _evidence_paths: projection.evidencePaths,
    }),
    extractor_version: source.extractor_version,
    classifier_version: source.classifier_version,
    projector_version: policy.commerce.projector_version,
  });
  for (const name of productCategories(facts, url, [source.final_url, source.requested_url])) {
    const category = await categoryByName(db, scope, name.slice(0, 255));
    await addMembership(db, scope, product.id, category.id, observation);
  }
  return { productId: product.id };
}

/** Crawled URL -> the identities its own stored facts declare, for these URLs only. */
async function declaredIdentities(
  db: Database,
  scope: CommerceScope,
  crawlId: string,
  urls: string[],
) {
  const rows = await db
    .selectFrom('site_urls as u')
    .innerJoin('site_crawl_tasks as t', 't.site_url_id', 'u.id')
    .innerJoin('site_fetch_artifacts as f', 'f.task_id', 't.id')
    .select(['u.normalized_url', 'f.final_url', 'f.normalized_facts'])
    .where('u.workspace_id', '=', scope.workspaceId)
    .where('u.project_id', '=', scope.projectId)
    .where('u.normalized_url', 'in', urls)
    .where('t.workspace_id', '=', scope.workspaceId)
    .where('t.crawl_id', '=', crawlId)
    .where('f.workspace_id', '=', scope.workspaceId)
    .where('f.fetch_purpose', '=', 'discover')
    .execute();
  const identities = new Map<string, string[]>();
  for (const row of rows) {
    if (row.normalized_facts === null) continue;
    const identity = pageIdentity(
      readFacts(row.normalized_facts),
      row.final_url || row.normalized_url,
    );
    if (identity)
      identities.set(row.normalized_url, [...(identities.get(row.normalized_url) ?? []), identity]);
  }
  return identities;
}

/** A shelf lists a product through its URL, a declared identity, or a collection alias. */
function listedProducts(
  links: string[],
  identities: Map<string, string[]>,
  productsByUrl: Map<string, string>,
) {
  const ids = new Set<string>();
  for (const url of links.flatMap((link) => [link, ...(identities.get(link) ?? [])]))
    for (const candidate of [url, productAlias(url)]) {
      const id = candidate ? productsByUrl.get(candidate) : undefined;
      if (id) ids.add(id);
    }
  return ids;
}

/**
 * Link shelves and products in either task order. A shelf source reconciles
 * only its own links; a product source only itself against the projected shelves.
 */
async function linkShelves(db: Database, scope: CommerceScope, crawlId: string, from: Linkable) {
  let shelfQuery = db
    .selectFrom('commerce_categories as c')
    .innerJoin('site_page_analyses as a', 'a.id', 'c.source_analysis_id')
    .innerJoin('site_fetch_artifacts as f', 'f.id', 'a.artifact_id')
    .select(['c.id', 'f.normalized_facts', 'f.final_url', 'f.requested_url'])
    .where('c.workspace_id', '=', scope.workspaceId)
    .where('c.project_id', '=', scope.projectId)
    .where('a.workspace_id', '=', scope.workspaceId)
    .where('a.project_id', '=', scope.projectId)
    .where('f.workspace_id', '=', scope.workspaceId);
  if ('shelfId' in from) shelfQuery = shelfQuery.where('c.id', '=', from.shelfId);
  const shelves = (await shelfQuery.execute()).map((shelf) => ({
    id: shelf.id,
    links: shelfLinks(readFacts(shelf.normalized_facts), shelf.final_url || shelf.requested_url),
  }));
  const urls = [...new Set(shelves.flatMap((shelf) => shelf.links))];
  if (!urls.length) return;
  const identities = await declaredIdentities(db, scope, crawlId, urls);
  let productQuery = db
    .selectFrom('commerce_products')
    .select(['id', 'canonical_url'])
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId);
  if ('productId' in from) productQuery = productQuery.where('id', '=', from.productId);
  const productsByUrl = new Map(
    (await productQuery.execute()).map((row) => [catalogUrl(row.canonical_url), row.id]),
  );
  for (const shelf of shelves)
    for (const productId of listedProducts(shelf.links, identities, productsByUrl))
      await addMembership(db, scope, productId, shelf.id, null);
}

export const projectCatalog: Executor = async (task, { db, checkCancelled }) => {
  const payload = jsonObject(task.payload, 'analytics_tasks.payload');
  const analysisId = z.uuid().parse(payload.source_analysis_id).toLowerCase();
  const scope = { workspaceId: task.workspace_id, projectId: z.uuid().parse(task.project_id) };
  await checkCancelled('catalog projection');
  await db.transaction().execute(async (trx) => {
    await lockCatalog(trx, scope);
    const source = await sourceOf(trx, scope, analysisId);
    if (source.page_kind !== 'product' && source.page_kind !== 'category') return;
    // A source that cannot be read or has no URL fails the same way on every
    // retry, so it ends the task at once.
    let facts: CatalogFacts;
    try {
      facts = readFacts(source.normalized_facts);
    } catch {
      throw new TerminalExecutorError('commerce_facts_invalid', 'Catalog source facts are invalid');
    }
    const url = pageIdentity(facts, source.final_url || source.normalized_url);
    if (!url)
      throw new TerminalExecutorError(
        'commerce_source_url_missing',
        'Catalog source has no usable URL',
      );
    const projected =
      source.page_kind === 'category'
        ? await projectCategory(trx, scope, source, facts, url)
        : await projectProduct(trx, scope, source, facts, url);
    if (projected) await linkShelves(trx, scope, source.crawl_id, projected);
  });
};

/**
 * Queue projection of a catalog page's analysis, once per analysis and
 * projector version. Only a brand whose confirmed business model, primary or
 * secondary, sells a catalog is projected; unknown context fails closed.
 */
export async function enqueueCatalogProjection(
  db: Database,
  scope: CommerceScope,
  analysisId: string,
) {
  const profile = await db
    .selectFrom('brand_profiles')
    .select('business_context')
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .executeTakeFirst();
  if (!sellsCatalog(profile?.business_context)) return;
  await enqueueTask(db, {
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    kind: 'commerce_catalog_projection',
    payload: { source_analysis_id: analysisId },
    keyParts: [],
    idempotencyKey: `commerce:project:${analysisId}:${policy.commerce.projector_version}`,
    maxAttempts: loadWorkerSettings().taskMaxAttempts,
  });
}
