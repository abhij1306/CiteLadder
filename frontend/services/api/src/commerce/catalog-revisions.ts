/**
 * Catalog revisions: immutable, numbered copies of a project's matching
 * identity (active products with their categories, and approved competitors).
 *
 * Every answer is matched against a revision, never the mutable catalog, so a
 * match pass names exactly the catalog it read. A revision is recorded only
 * for a project whose plan grants Commerce and whose catalog or approved
 * competitor list is non-empty, and only when that identity changed; each new
 * revision queues one `commerce_answer_matching` backfill (CM1).
 */
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { subjectXactLock } from '../db/advisory-lock.ts';
import { enqueueDerivedOpportunityRefresh } from '../opportunities/enqueue.ts';
import { enqueueCoalesced, enqueueTask } from '../queue/enqueue.ts';
import type { CommerceScope } from './reads.ts';
import { competitorSchema, productSchema, type ShelfCatalog } from './shelf-parsing.ts';

const ANSWER_MATCHING_KIND = 'commerce_answer_matching';

const targetKindSchema = z.enum(['product', 'category']);
export type ShelfTargetRef = { target_kind: z.infer<typeof targetKindSchema>; target_id: string };

const revisionIdentitySchema = z.object({
  products: z.array(productSchema.extend({ category_ids: z.array(z.uuid()) })),
  approved_competitors: z.array(
    competitorSchema.extend({ target_kind: targetKindSchema, target_id: z.uuid() }),
  ),
});
export type RevisionIdentity = z.infer<typeof revisionIdentitySchema>;

/** What created a revision: a catalog writer, or an audit admission that found the catalog changed. */
export type RevisionSource =
  | { kind: 'import'; id: string }
  | { kind: 'projection'; id: string | null }
  | { kind: 'competitor_decision'; id: string }
  | { kind: 'edit'; id: string }
  | { kind: 'audit'; id: null };

export type CatalogRevision = { id: string; revision_number: number };

/** The current matching identity, in a stable order so equal catalogs hash equal. */
async function catalogIdentity(db: Database, scope: CommerceScope): Promise<RevisionIdentity> {
  const products = await db
    .selectFrom('commerce_products')
    .select(['id', 'canonical_url', 'name', 'brand', 'gtin', 'sku', 'mpn', 'attributes'])
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('lifecycle_state', '=', 'active')
    .orderBy('id')
    .execute();
  const memberships = await db
    .selectFrom('commerce_product_categories')
    .select(['product_id', 'category_id'])
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .orderBy('product_id')
    .orderBy('category_id')
    .execute();
  const categories = new Map<string, string[]>();
  for (const row of memberships)
    categories.set(row.product_id, [...(categories.get(row.product_id) ?? []), row.category_id]);
  const competitors = await db
    .selectFrom('commerce_competitor_candidates')
    .select(['id', 'canonical_url', 'product_name', 'brand_name', 'target_kind', 'target_id'])
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('state', '=', 'approved')
    .orderBy('id')
    .execute();
  return revisionIdentitySchema.parse({
    products: products.map((row) => ({ ...row, category_ids: categories.get(row.id) ?? [] })),
    approved_competitors: competitors,
  });
}

/**
 * The project's current revision, recording a new one first when the
 * matching identity changed; null when the project does not qualify. A new
 * revision queues its backfill in the caller's transaction, so the work is
 * visible exactly when the revision is.
 */
export async function recordCatalogRevision(
  db: Database,
  scope: CommerceScope,
  source: RevisionSource,
): Promise<CatalogRevision | null> {
  // A catalog write moves catalog-field findings even when the matching
  // identity is unchanged (a description or price edit), so it asks for a
  // refresh; an audit admission's own completion already announces one.
  if (source.kind !== 'audit')
    await enqueueDerivedOpportunityRefresh(db, {
      ...scope,
      triggerKind: `commerce_catalog_${source.kind}`,
      triggerId: source.id ?? scope.projectId,
    });
  // Revision numbers are per project; concurrent writers take them in turn.
  await subjectXactLock(db, `commerce_catalog_revision:${scope.workspaceId}:${scope.projectId}`);
  const identity = await catalogIdentity(db, scope);
  if (!identity.products.length && !identity.approved_competitors.length) return null;
  const hash = createHash('sha256').update(JSON.stringify(identity)).digest('hex');
  const latest = await db
    .selectFrom('commerce_catalog_revisions')
    .select(['id', 'revision_number', 'identity_hash'])
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .orderBy('revision_number', 'desc')
    .limit(1)
    .executeTakeFirst();
  if (latest?.identity_hash === hash)
    return { id: latest.id, revision_number: latest.revision_number };
  const revision = {
    id: randomUUID(),
    revision_number: (latest?.revision_number ?? 0) + 1,
  };
  await db
    .insertInto('commerce_catalog_revisions')
    .values({
      ...revision,
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      identity_snapshot: JSON.stringify(identity),
      identity_hash: hash,
      source_kind: source.kind,
      source_id: source.id,
      created_at: new Date(),
    })
    .execute();
  await enqueueTask(db, {
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    kind: ANSWER_MATCHING_KIND,
    payload: { catalog_revision_id: revision.id },
    keyParts: [revision.id],
  });
  return revision;
}

/**
 * Crawl projection writes the catalog one page at a time, so it asks for a
 * revision instead of recording one per page: queued requests coalesce and
 * keep the earliest deadline, so a long crawl records at most one revision per
 * `projection_delay_seconds`, and the task records it (`matchAnswers`).
 */
export async function requestProjectionRevision(
  db: Database,
  scope: CommerceScope,
  crawlId: string,
) {
  await enqueueCoalesced(db, {
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    kind: ANSWER_MATCHING_KIND,
    payload: { source_kind: 'projection', crawl_id: crawlId },
    coalesceOn: ['source_kind'],
    merge: (queued) => ({ ...queued, crawl_id: crawlId }),
    delaySeconds: policy.commerce.answer_matching.projection_delay_seconds,
  });
}

/** One revision's identity, within its workspace and project; null when it does not exist there. */
export async function loadRevision(db: Database, scope: CommerceScope, id: string) {
  const row = await db
    .selectFrom('commerce_catalog_revisions')
    .select(['id', 'revision_number', 'identity_snapshot'])
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('id', '=', id)
    .executeTakeFirst();
  return row
    ? {
        id: row.id,
        revision_number: row.revision_number,
        identity: revisionIdentitySchema.parse(row.identity_snapshot),
      }
    : null;
}

/**
 * What one answer is matched against: a buyer prompt's target sees its own
 * products and approved competitors, as the AI Shelf always has; an answer no
 * buyer prompt targets sees the whole catalog.
 */
export function revisionShelf(
  identity: RevisionIdentity,
  target: ShelfTargetRef | null,
): ShelfCatalog {
  if (!target) return identity;
  const holds = (product: RevisionIdentity['products'][number]) =>
    target.target_kind === 'product'
      ? product.id === target.target_id
      : product.category_ids.includes(target.target_id);
  return {
    products: identity.products.filter(holds),
    approved_competitors: identity.approved_competitors.filter(
      (row) => row.target_kind === target.target_kind && row.target_id === target.target_id,
    ),
  };
}
