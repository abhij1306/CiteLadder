import {
  buyerPromptSchema,
  commerceCatalogSchema,
  commerceProjectionSchema,
  competitorCandidateSchema,
  competitorDiscoveryTaskSchema,
} from '@citeladder/contracts/commerce-suite';
import { sql } from 'kysely';

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { jsonObject } from '../db/json.ts';
import { catalogApplicability, UNCATEGORIZED_KEY } from './projection-facts.ts';
import { ApiError } from '../errors.ts';

export type CommerceScope = { workspaceId: string; projectId: string };

export function commerceMissing(message: string): never {
  throw new ApiError(404, message, { code: 'commerce_not_found' });
}

/**
 * The catalog as navigation: product and category names, memberships and the
 * projection's progress. Each row's evidence (attributes, variants, field
 * sources) stays on the stored row. Products are bounded by configuration
 * (first by name) with the full count beside them; category counts always
 * cover every product. The reads are independent and run together.
 */
export async function catalog(db: Database, scope: CommerceScope) {
  // Archived products are out of the catalog; their history stays on their pages.
  const ownedProducts = db
    .selectFrom('commerce_products')
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('lifecycle_state', '=', 'active');
  // The listed products, first by name; memberships are read for these only.
  const listed = ownedProducts
    .orderBy('name')
    .orderBy('canonical_url')
    .orderBy('id')
    .limit(policy.commerce.catalog_product_limit);
  const ownedMemberships = db
    .selectFrom('commerce_product_categories')
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId);
  const [products, total, categories, memberships, categoryCounts, projection] = await Promise.all([
    listed.select(['id', 'canonical_url', 'name', 'brand']).execute(),
    ownedProducts.select(db.fn.countAll<string>().as('count')).executeTakeFirstOrThrow(),
    // A row named "Uncategorized" (the platform default) is no category: its
    // products read as uncategorized.
    db
      .selectFrom('commerce_categories')
      .select(['id', 'name', 'parent_category_id'])
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .where('normalized_name', '!=', UNCATEGORIZED_KEY)
      .execute(),
    ownedMemberships
      .select(['product_id', 'category_id'])
      .where('product_id', 'in', listed.select('id'))
      .execute(),
    // Category counts cover every active product, listed or not.
    ownedMemberships
      .select((eb) => ['category_id', eb.fn.countAll<string>().as('count')])
      .where('product_id', 'in', ownedProducts.select('id'))
      .groupBy('category_id')
      .execute(),
    catalogProjection(db, scope),
  ]);
  const shown = new Set(categories.map((row) => row.id));
  const byProduct = new Map<string, string[]>();
  for (const row of memberships) {
    if (!shown.has(row.category_id)) continue;
    const ids = byProduct.get(row.product_id);
    if (ids) ids.push(row.category_id);
    else byProduct.set(row.product_id, [row.category_id]);
  }
  const counts = new Map(categoryCounts.map((row) => [row.category_id, Number(row.count)]));
  return commerceCatalogSchema.parse({
    products: products.map((row) => ({
      ...row,
      category_ids: (byProduct.get(row.id) ?? []).sort((a, b) => a.localeCompare(b)),
    })),
    product_total: Number(total.count),
    categories: categories
      .map(({ parent_category_id: parent, ...row }) => ({
        ...row,
        // A parent the list does not show leaves its child at the top.
        parent_id: parent && shown.has(parent) ? parent : null,
        product_count: counts.get(row.id) ?? 0,
      }))
      .sort(
        (a, b) =>
          b.product_count - a.product_count ||
          a.name.localeCompare(b.name) ||
          a.id.localeCompare(b.id),
      ),
    projection,
  });
}

const PROJECTION_TASK = 'commerce_catalog_projection';

/**
 * Projection progress for the catalog header: live tasks, and the failures of
 * the latest projected crawl only, so one old failure is not reported forever.
 * Served alone too, so a screen waiting on projections polls this, not the
 * catalog.
 */
export async function catalogProjection(db: Database, scope: CommerceScope) {
  const terminal = [...policy.task_queue.terminal];
  const tasks = db
    .selectFrom('analytics_tasks as t')
    .where('t.workspace_id', '=', scope.workspaceId)
    .where('t.project_id', '=', scope.projectId)
    .where('t.task_kind', '=', PROJECTION_TASK);
  const sources = tasks
    .innerJoin('site_page_analyses as a', (join) =>
      join.on(sql`a.id::text`, '=', sql`t.payload->>'source_analysis_id'`),
    )
    .where('a.workspace_id', '=', scope.workspaceId);
  const [profile, inFlight, latest] = await Promise.all([
    db
      .selectFrom('brand_profiles')
      .select('business_context')
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .executeTakeFirst(),
    tasks
      .select(db.fn.countAll<string>().as('count'))
      .where('t.status', 'not in', terminal)
      .executeTakeFirstOrThrow(),
    sources.select('a.crawl_id').orderBy('t.created_at', 'desc').limit(1).executeTakeFirst(),
  ]);
  const failed = latest
    ? await sources
        .select(db.fn.countAll<string>().as('count'))
        .where('a.crawl_id', '=', latest.crawl_id)
        .where('t.status', 'in', ['failed', 'cancelled'])
        .executeTakeFirstOrThrow()
    : { count: '0' };
  return commerceProjectionSchema.parse({
    applicability: catalogApplicability(profile?.business_context),
    in_flight: Number(inFlight.count),
    failed: Number(failed.count),
  });
}

const candidateFields = [
  'id',
  'target_kind',
  'target_id',
  'canonical_url',
  'product_name',
  'brand_name',
  'evidence',
  'source_kind',
  'state',
  'decision_at',
] as const;

export async function candidates(db: Database, scope: CommerceScope, id?: string) {
  let query = db
    .selectFrom('commerce_competitor_candidates')
    .select(candidateFields)
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId);
  if (id) query = query.where('id', '=', id);
  return (await query.orderBy('created_at', 'desc').orderBy('id').execute()).map((row) =>
    competitorCandidateSchema.parse({
      ...row,
      evidence: jsonObject(row.evidence, 'commerce_competitor_candidates.evidence'),
      decision_at: row.decision_at?.toISOString() ?? null,
    }),
  );
}

export async function discoveries(db: Database, scope: CommerceScope, ids: string[] | null) {
  const terminal = new Set<string>(policy.task_queue.terminal);
  let query = db
    .selectFrom('analytics_tasks')
    .select(['id', 'payload', 'status', 'error_code'])
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('task_kind', '=', 'commerce_competitor_discovery');
  if (ids !== null) {
    if (!ids.length) return [];
    query = query.where('id', 'in', ids);
  } else query = query.where('status', 'not in', [...terminal]);
  const rows = await query.orderBy('created_at').orderBy('id').execute();
  const byId = new Map(rows.map((row) => [row.id, row]));
  const ordered =
    ids === null
      ? rows
      : [...new Set(ids)].map(
          (id) => byId.get(id) ?? commerceMissing('Competitor discovery task not found'),
        );
  return ordered.map((row) =>
    competitorDiscoveryTaskSchema.parse({
      id: row.id,
      target: jsonObject(row.payload, 'analytics_tasks.payload').target,
      status: row.status,
      error_code: row.error_code,
      terminal: terminal.has(row.status),
    }),
  );
}

export async function buyerPrompts(db: Database, scope: CommerceScope, id?: string) {
  let query = db
    .selectFrom('prompts as p')
    .innerJoin('prompt_sets as ps', 'ps.id', 'p.prompt_set_id')
    .innerJoin('projects as project', 'project.id', 'ps.project_id')
    .innerJoin('commerce_prompt_targets as t', 't.prompt_id', 'p.id')
    .select([
      'p.id',
      'p.prompt_set_id',
      'p.text',
      'p.branded',
      'p.buyer_stage',
      'p.persona',
      'p.enabled',
      't.target_kind',
      't.target_id',
      't.approved_at',
    ])
    .where('project.workspace_id', '=', scope.workspaceId)
    .where('project.id', '=', scope.projectId)
    .where('t.workspace_id', '=', scope.workspaceId)
    .where('t.project_id', '=', scope.projectId);
  if (id) query = query.where('p.id', '=', id);
  return (await query.orderBy('p.created_at').orderBy('p.id').execute()).map(
    ({ target_kind, target_id, approved_at, persona, ...row }) =>
      buyerPromptSchema.parse({
        ...row,
        context: persona,
        target: { kind: target_kind, id: target_id },
        approved_at: approved_at?.toISOString() ?? null,
      }),
  );
}

const SETTLED_ACTION_STATUSES = ['done', 'dismissed'];

/** Live commerce Opportunities keyed to the target, by the Action that holds them. */
export async function targetActions(
  db: Database,
  scope: CommerceScope,
  target: { kind: 'category' | 'product'; id: string },
) {
  const rows = await db
    .selectFrom('opportunities as o')
    .innerJoin('actions as a', 'a.id', 'o.action_id')
    .select(['a.id', 'a.effective_status as status', 'o.title'])
    .where('o.workspace_id', '=', scope.workspaceId)
    .where('o.project_id', '=', scope.projectId)
    .where('a.workspace_id', '=', scope.workspaceId)
    .where('o.opportunity_type', '=', 'commerce')
    .where('o.target_key', '=', `${target.kind}:${target.id}`)
    .where('o.superseded_at', 'is', null)
    // The status readers see: `done` exists only there, never as a stored decision.
    .where('a.effective_status', 'not in', SETTLED_ACTION_STATUSES)
    .orderBy('o.priority_score', 'desc')
    .orderBy('a.id')
    .execute();
  // An Action holding several of the target's Opportunities is listed once,
  // under its highest-priority title.
  const byAction = new Map<string, (typeof rows)[number]>();
  for (const row of rows) if (!byAction.has(row.id)) byAction.set(row.id, row);
  return [...byAction.values()];
}
