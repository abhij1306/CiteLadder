/**
 * The Shopping overview read (commerce improvement PR 5): one window's brand
 * and product rankings, the catalog's most and least visible products, the
 * merchants answers send shoppers to and the fan-out queries of answers that
 * held a product, over the same answers and slots as the Products table
 * (`scopedSlots`).
 *
 * A brand folds its products' slots to one per execution, at the best rank
 * (a ranked slot beats an unranked one, a carousel card's rank a text-list
 * rank), so its visibility, win rate and position read like a product's. Its
 * Share of Shelf is its product slots ÷ every product slot in scope. Holders
 * with no brand are unknown, not a brand, and stay out of the brand ranking
 * (their slots still count in the denominator).
 *
 * With a category, every list narrows to the category's holders and the
 * category's latest Commerce audit snapshot is read beside them: the
 * category-target metrics keep their definitions (`shelfMetrics`).
 *
 * It reads only persisted rows: no provider, model or repair, and every table
 * is filtered to the authorized workspace and project.
 */
import { commerceShoppingOverviewSchema } from '@citeladder/contracts/commerce-suite';
import { sql } from 'kysely';
import { z } from 'zod';

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { ApiError } from '../errors.ts';
import { holderKindSchema, holderRows, scopedSlots } from './products.ts';
import type { CommerceScope } from './reads.ts';

export type OverviewQuery = { windowDays: number; category: string | null };

const counts = {
  appearances: z.number().int(),
  ordered: z.number().int(),
  wins: z.number().int(),
  position: z.number().nullable(),
};
const productSchema = z.object({
  holder_id: z.uuid(),
  kind: holderKindSchema,
  name: z.string(),
  brand: z.string(),
  ...counts,
});
const rowSchema = z.object({
  executions: z.number().int(),
  slots: z.number().int(),
  holding: z.number().int(),
  searched: z.number().int(),
  unsearched: z.number().int(),
  brands: z.array(
    z.object({ brand: z.string(), owned: z.boolean(), slots: z.number().int(), ...counts }),
  ),
  products: z.array(productSchema),
  most_visible: z.array(productSchema),
  least_visible: z.array(productSchema),
  merchants: z.array(
    z.object({ domain: z.string(), answers: z.number().int(), products: z.number().int() }),
  ),
  queries: z.array(z.object({ query: z.string(), answers: z.number().int() })),
});

type Counts = { appearances: number; ordered: number; wins: number; position: number | null };

/** The rates of one holder's counts; unavailable (null) without a denominator. */
function metrics(row: Counts, executions: number) {
  return {
    visibility: executions ? row.appearances / executions : null,
    appearances: row.appearances,
    ordered_appearances: row.ordered,
    win_rate: row.ordered ? row.wins / row.ordered : null,
    position: row.ordered ? row.position : null,
  };
}

/** The category's latest Commerce audit snapshot; a category outside the project is not found. */
async function categoryShelf(db: Database, scope: CommerceScope, categoryId: string) {
  const category = await db
    .selectFrom('commerce_categories')
    .select('id')
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('id', '=', categoryId)
    .executeTakeFirst();
  if (!category) throw new ApiError(404, 'Commerce category not found');
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
      'created_at',
    ])
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('target_kind', '=', 'category')
    .where('target_id', '=', categoryId)
    .orderBy('created_at', 'desc')
    .orderBy('id')
    .limit(1)
    .executeTakeFirst();
  if (!snapshot) return null;
  const { created_at, ...measured } = snapshot;
  return {
    ...measured,
    // Stored as 0 with no successful execution: unavailable, not zero.
    product_visibility: snapshot.successful_execution_count ? snapshot.product_visibility : null,
    measured_at: created_at.toISOString(),
  };
}

export async function shoppingOverview(db: Database, scope: CommerceScope, query: OverviewQuery) {
  const limits = policy.commerce.overview;
  const slotsInScope = scopedSlots(scope, {
    windowDays: query.windowDays,
    engine: null,
    promptSet: null,
  });
  const shelf = query.category ? await categoryShelf(db, scope, query.category) : null;
  const holders = holderRows(scope, { source: 'all', category: query.category });
  const product = sql`json_build_object('holder_id', m.holder_id, 'kind', m.kind, 'name', m.name,
      'brand', m.brand, 'appearances', m.appearances, 'ordered', m.ordered, 'wins', m.wins,
      'position', m.position)`;
  const result = await sql<unknown>`
    WITH ${slotsInScope},
    holders AS (${holders}),
    held AS (
      SELECT s.task_id, s.holder_id, s.best_rank, s.surface_kind,
             lower(btrim(h.brand)) AS brand_key
      FROM slots s JOIN holders h ON h.holder_id = s.holder_id
    ),
    product_metrics AS (
      SELECT h.holder_id, h.kind, h.name, h.brand, lower(h.name) AS name_key,
             count(x.task_id)::int AS appearances, count(x.best_rank)::int AS ordered,
             count(*) FILTER (WHERE x.best_rank = 1)::int AS wins,
             avg(x.best_rank)::float8 AS position
      FROM holders h LEFT JOIN held x ON x.holder_id = h.holder_id
      GROUP BY h.holder_id, h.kind, h.name, h.brand
    ),
    most_visible AS (
      SELECT * FROM product_metrics WHERE kind = 'owned'
      ORDER BY appearances DESC, name_key, holder_id LIMIT ${limits.extremes_limit}
    ),
    least_visible AS (
      SELECT * FROM product_metrics
      WHERE kind = 'owned' AND holder_id NOT IN (SELECT holder_id FROM most_visible)
      ORDER BY appearances, name_key, holder_id LIMIT ${limits.extremes_limit}
    ),
    brand_best AS (
      SELECT DISTINCT ON (brand_key, task_id) brand_key, task_id, best_rank
      FROM held WHERE brand_key <> ''
      ORDER BY brand_key, task_id, (best_rank IS NOT NULL) DESC,
               (surface_kind = 'shopping_result') DESC, best_rank
    ),
    brand_names AS (
      SELECT lower(btrim(brand)) AS brand_key, min(btrim(brand)) AS brand,
             bool_or(kind = 'owned') AS owned
      FROM holders WHERE btrim(brand) <> '' GROUP BY 1
    ),
    brand_metrics AS (
      SELECT n.brand_key, n.brand, n.owned,
             count(b.task_id)::int AS appearances, count(b.best_rank)::int AS ordered,
             count(*) FILTER (WHERE b.best_rank = 1)::int AS wins,
             avg(b.best_rank)::float8 AS position,
             (SELECT count(*) FROM held x WHERE x.brand_key = n.brand_key)::int AS slots
      FROM brand_names n LEFT JOIN brand_best b ON b.brand_key = n.brand_key
      GROUP BY n.brand_key, n.brand, n.owned
    ),
    merchants AS (
      SELECT o.merchant_domain AS domain, count(DISTINCT o.task_id)::int AS answers,
             count(DISTINCT o.holder_id)::int AS products
      FROM observed o JOIN holders h ON h.holder_id = o.holder_id
      WHERE o.merchant_domain <> ''
      GROUP BY o.merchant_domain
    ),
    holding AS (SELECT DISTINCT task_id FROM held),
    analyses AS (
      SELECT DISTINCT ON (ra.artifact_id) ra.task_id, ra.fanout_state, ra.fanout_queries
      FROM response_analyses ra
      JOIN scoped_passes sp ON sp.artifact_id = ra.artifact_id AND sp.task_id = ra.task_id
      WHERE ra.workspace_id = ${scope.workspaceId}
        AND ra.task_id IN (SELECT task_id FROM holding)
      ORDER BY ra.artifact_id, ra.created_at DESC, ra.id DESC
    ),
    queries AS (
      SELECT btrim(q.query) AS query, count(DISTINCT a.task_id)::int AS answers
      FROM analyses a CROSS JOIN LATERAL unnest(a.fanout_queries) AS q(query)
      WHERE btrim(q.query) <> ''
      GROUP BY 1
    )
    SELECT e.n AS executions,
      (SELECT count(*) FROM held)::int AS slots,
      (SELECT count(*) FROM holding)::int AS holding,
      (SELECT count(DISTINCT task_id) FROM analyses
        WHERE fanout_state = 'queries_available')::int AS searched,
      (SELECT count(DISTINCT task_id) FROM analyses WHERE fanout_state = 'no_search')::int
        AS unsearched,
      (SELECT coalesce(json_agg(json_build_object('brand', m.brand, 'owned', m.owned,
                'slots', m.slots, 'appearances', m.appearances, 'ordered', m.ordered,
                'wins', m.wins, 'position', m.position)
              ORDER BY m.appearances DESC, m.brand_key), '[]'::json)
        FROM (SELECT * FROM brand_metrics
              ORDER BY appearances DESC, brand_key LIMIT ${limits.ranking_limit}) m) AS brands,
      (SELECT coalesce(json_agg(${product} ORDER BY m.appearances DESC, m.name_key, m.holder_id),
                '[]'::json)
        FROM (SELECT * FROM product_metrics
              ORDER BY appearances DESC, name_key, holder_id LIMIT ${limits.ranking_limit}) m)
        AS products,
      (SELECT coalesce(json_agg(${product} ORDER BY m.appearances DESC, m.name_key, m.holder_id),
                '[]'::json) FROM most_visible m) AS most_visible,
      (SELECT coalesce(json_agg(${product} ORDER BY m.appearances, m.name_key, m.holder_id),
                '[]'::json) FROM least_visible m) AS least_visible,
      (SELECT coalesce(json_agg(json_build_object('domain', m.domain, 'answers', m.answers,
                'products', m.products) ORDER BY m.answers DESC, m.domain), '[]'::json)
        FROM (SELECT * FROM merchants
              ORDER BY answers DESC, domain LIMIT ${limits.merchant_limit}) m) AS merchants,
      (SELECT coalesce(json_agg(json_build_object('query', m.query, 'answers', m.answers)
              ORDER BY m.answers DESC, m.query), '[]'::json)
        FROM (SELECT * FROM queries
              ORDER BY answers DESC, query LIMIT ${limits.fanout_query_limit}) m) AS queries
    FROM executions e
  `.execute(db);
  const row = rowSchema.parse(result.rows[0]);
  const { executions } = row;
  const productOf = ({
    appearances,
    ordered,
    wins,
    position,
    ...holder
  }: z.infer<typeof productSchema>) => ({
    ...holder,
    ...metrics({ appearances, ordered, wins, position }, executions),
  });
  return commerceShoppingOverviewSchema.parse({
    window_days: query.windowDays,
    category: query.category,
    executions,
    slots: row.slots,
    brands: row.brands.map(({ appearances, ordered, wins, position, ...brand }) => ({
      ...brand,
      ...metrics({ appearances, ordered, wins, position }, executions),
      share_of_shelf: row.slots ? brand.slots / row.slots : null,
    })),
    products: row.products.map(productOf),
    most_visible: row.most_visible.map(productOf),
    least_visible: row.least_visible.map(productOf),
    merchants: row.merchants,
    fanout: {
      answers: row.holding,
      answers_with_queries: row.searched,
      answers_without_search: row.unsearched,
      queries: row.queries,
    },
    category_shelf: shelf,
  });
}
