import {
  buyerPromptSchema,
  commerceCatalogSchema,
  commerceProductSchema,
  competitorCandidateSchema,
  competitorDiscoveryTaskSchema,
  shelfHolderSchema,
  shelfSchema,
} from '@citeladder/contracts/commerce-suite';
import { sql } from 'kysely';
import { z } from 'zod';

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { jsonObject } from '../db/json.ts';
import { sellsCatalog, UNCATEGORIZED_KEY } from './projection-facts.ts';
import { holderIdentity, orderedRank } from './shelf-metrics.ts';
import { ApiError } from '../errors.ts';

export type CommerceScope = { workspaceId: string; projectId: string };

export function commerceMissing(message: string): never {
  throw new ApiError(404, message, { code: 'commerce_not_found' });
}

function numeric(value: string | null): number | null {
  if (value === null) return null;
  if (!value.trim()) throw new TypeError('Empty persisted numeric');
  return z.number().parse(Number(value));
}

export async function catalog(db: Database, scope: CommerceScope) {
  const projection = projectionState(db, scope);
  const products = await db
    .selectFrom('commerce_products')
    .selectAll()
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .orderBy('name')
    .orderBy('canonical_url')
    .execute();
  // A row named "Uncategorized" (the platform default) is no category: its
  // products read as uncategorized.
  const categories = await db
    .selectFrom('commerce_categories')
    .selectAll()
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('normalized_name', '!=', UNCATEGORIZED_KEY)
    .execute();
  const shown = new Set(categories.map((row) => row.id));
  const memberships = (
    await db
      .selectFrom('commerce_product_categories')
      .select(['product_id', 'category_id'])
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .execute()
  ).filter((row) => shown.has(row.category_id));
  const byProduct = new Map<string, string[]>();
  const counts = new Map<string, number>();
  for (const row of memberships) {
    byProduct.set(row.product_id, [...(byProduct.get(row.product_id) ?? []), row.category_id]);
    counts.set(row.category_id, (counts.get(row.category_id) ?? 0) + 1);
  }
  return commerceCatalogSchema.parse({
    products: products.map(({ workspace_id, project_id, ...row }) => ({
      ...row,
      price: numeric(row.price),
      attributes: jsonObject(row.attributes, 'commerce_products.attributes'),
      field_sources: jsonObject(row.field_sources, 'commerce_products.field_sources'),
      variants: commerceProductSchema.shape.variants.parse(row.variants),
      category_ids: (byProduct.get(row.id) ?? []).sort((a, b) => a.localeCompare(b)),
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    })),
    categories: categories
      .map(({ workspace_id, project_id, normalized_name, created_at, updated_at, ...row }) => ({
        ...row,
        product_count: counts.get(row.id) ?? 0,
        field_sources: jsonObject(row.field_sources, 'commerce_categories.field_sources'),
      }))
      .sort(
        (a, b) =>
          b.product_count - a.product_count ||
          a.name.localeCompare(b.name) ||
          a.id.localeCompare(b.id),
      ),
    projection: await projection,
  });
}

const PROJECTION_TASK = 'commerce_catalog_projection';

/**
 * Projection progress for the catalog header: live tasks, and the failures of
 * the latest projected crawl only, so one old failure is not reported forever.
 */
async function projectionState(db: Database, scope: CommerceScope) {
  const terminal = [...policy.task_queue.terminal];
  const profile = await db
    .selectFrom('brand_profiles')
    .select('business_context')
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .executeTakeFirst();
  const tasks = db
    .selectFrom('analytics_tasks as t')
    .where('t.workspace_id', '=', scope.workspaceId)
    .where('t.project_id', '=', scope.projectId)
    .where('t.task_kind', '=', PROJECTION_TASK);
  const inFlight = tasks
    .select(db.fn.countAll<string>().as('count'))
    .where('t.status', 'not in', terminal)
    .executeTakeFirstOrThrow();
  const sources = tasks
    .innerJoin('site_page_analyses as a', (join) =>
      join.on(sql`a.id::text`, '=', sql`t.payload->>'source_analysis_id'`),
    )
    .where('a.workspace_id', '=', scope.workspaceId);
  const latest = await sources
    .select('a.crawl_id')
    .orderBy('t.created_at', 'desc')
    .limit(1)
    .executeTakeFirst();
  const failed = latest
    ? await sources
        .select(db.fn.countAll<string>().as('count'))
        .where('a.crawl_id', '=', latest.crawl_id)
        .where('t.status', 'in', ['failed', 'cancelled'])
        .executeTakeFirstOrThrow()
    : { count: '0' };
  return {
    applies: sellsCatalog(profile?.business_context),
    in_flight: Number((await inFlight).count),
    failed: Number(failed.count),
  };
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
    ({ target_kind, target_id, approved_at, ...row }) =>
      buyerPromptSchema.parse({
        ...row,
        target: { kind: target_kind, id: target_id },
        approved_at: approved_at?.toISOString() ?? null,
      }),
  );
}

type HolderKind = z.infer<typeof shelfHolderSchema>['kind'];
const SETTLED_ACTION_STATUSES = ['done', 'dismissed'];

/**
 * The latest measurement of one target, the recommendations behind it and the
 * Actions open against it.
 *
 * Holders come from exactly the observations the snapshot was computed from,
 * so the list and the numbers above it always describe the same answers.
 */
export async function shelf(
  db: Database,
  scope: CommerceScope,
  target: { kind: 'category' | 'product'; id: string },
) {
  // Independent of the snapshot; read alongside it.
  const actions = targetActions(db, scope, target);
  const snapshot = await db
    .selectFrom('commerce_shelf_snapshots')
    .select([
      'product_visibility',
      'share_of_shelf',
      'average_shelf_position',
      'first_position_win_rate',
      'successful_execution_count',
      'recognized_slot_count',
      'ranked_execution_count',
      'source_observation_ids',
      'created_at',
    ])
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('target_kind', '=', target.kind)
    .where('target_id', '=', target.id)
    .orderBy('created_at', 'desc')
    .orderBy('id')
    .limit(1)
    .executeTakeFirst();
  const sourceIds = z.array(z.uuid()).parse(snapshot?.source_observation_ids ?? []);
  const observations = sourceIds.length
    ? await db
        .selectFrom('commerce_recommendation_observations')
        .select([
          'task_id',
          'classification',
          'product_id',
          'competitor_candidate_id',
          'observed_product',
          'observed_brand',
          'merchant_domain',
          'rank',
          'order_observable',
        ])
        .where('workspace_id', '=', scope.workspaceId)
        .where('project_id', '=', scope.projectId)
        .where('id', 'in', sourceIds)
        .orderBy('created_at')
        .orderBy('id')
        .execute()
    : [];
  const holders = new Map<
    string,
    {
      kind: HolderKind;
      name: string;
      brand: string;
      merchant_domain: string;
      tasks: Set<string>;
      best_rank: number | null;
    }
  >();
  let unresolved = 0;
  for (const row of observations) {
    const identity = holderIdentity(row);
    const kind = shelfHolderSchema.shape.kind.safeParse(row.classification);
    if (identity === null || !kind.success) {
      unresolved++;
      continue;
    }
    const key = JSON.stringify([kind.data, identity]);
    const holder = holders.get(key) ?? {
      kind: kind.data,
      name: row.observed_product,
      brand: row.observed_brand,
      merchant_domain: row.merchant_domain,
      tasks: new Set<string>(),
      best_rank: null,
    };
    holder.tasks.add(row.task_id);
    holder.merchant_domain ||= row.merchant_domain;
    const rank = orderedRank(row);
    if (rank !== null && (holder.best_rank === null || rank < holder.best_rank))
      holder.best_rank = rank;
    holders.set(key, holder);
  }
  return shelfSchema.parse({
    target,
    snapshot: snapshot
      ? {
          product_visibility: snapshot.successful_execution_count
            ? snapshot.product_visibility
            : null,
          share_of_shelf: snapshot.share_of_shelf,
          average_shelf_position: snapshot.average_shelf_position,
          first_position_win_rate: snapshot.first_position_win_rate,
          successful_execution_count: snapshot.successful_execution_count,
          recognized_slot_count: snapshot.recognized_slot_count,
          ranked_execution_count: snapshot.ranked_execution_count,
          measured_at: snapshot.created_at.toISOString(),
        }
      : null,
    holders: [...holders.values()]
      .map(({ tasks, ...holder }) => ({ ...holder, appearances: tasks.size }))
      .sort(
        (a, b) =>
          b.appearances - a.appearances ||
          (a.best_rank ?? Infinity) - (b.best_rank ?? Infinity) ||
          a.name.localeCompare(b.name),
      ),
    unresolved_count: unresolved,
    actions: await actions,
  });
}

/** Live commerce Opportunities keyed to the target, by the Action that holds them. */
async function targetActions(
  db: Database,
  scope: CommerceScope,
  target: { kind: 'category' | 'product'; id: string },
) {
  const rows = await db
    .selectFrom('opportunities as o')
    .innerJoin('actions as a', 'a.id', 'o.action_id')
    .select(['a.id', 'a.status', 'o.title'])
    .where('o.workspace_id', '=', scope.workspaceId)
    .where('o.project_id', '=', scope.projectId)
    .where('a.workspace_id', '=', scope.workspaceId)
    .where('o.opportunity_type', '=', 'commerce')
    .where('o.target_key', '=', `${target.kind}:${target.id}`)
    .where('o.superseded_at', 'is', null)
    .where('a.status', 'not in', SETTLED_ACTION_STATUSES)
    .orderBy('o.priority_score', 'desc')
    .orderBy('a.id')
    .execute();
  // An Action holding several of the target's Opportunities is listed once,
  // under its highest-priority title.
  const byAction = new Map<string, (typeof rows)[number]>();
  for (const row of rows) if (!byAction.has(row.id)) byAction.set(row.id, row);
  return [...byAction.values()];
}
