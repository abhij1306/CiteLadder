import {
  commerceProductPageSchema,
  commerceProductRowSchema,
} from '@citeladder/contracts/commerce-suite';
import type {
  CommerceProductSort,
  CommerceProductSource,
} from '@citeladder/contracts/commerce-suite';
import { sql, type RawBuilder } from 'kysely';
import { z } from 'zod';

import { DAY_MS } from '../calendar-days.ts';
import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { ApiError } from '../errors.ts';
import {
  decodeKeysetCursor,
  encodeKeysetCursor,
  InvalidCursorError,
} from '../http/keyset-cursor.ts';
import { UNCATEGORIZED_KEY } from './projection-facts.ts';
import type { CommerceScope } from './reads.ts';

export type ProductQuery = {
  source: CommerceProductSource;
  category: string | null;
  windowDays: number;
  engine: string | null;
  promptSet: string | null;
  q: string | null;
  sort: CommerceProductSort;
  cursor: string | null;
  limit: number;
  holder?: string;
  allMerchants?: boolean;
  until?: Date;
  after?: Date;
};

const CURSOR_SCOPE = 'commerce.products';
const NOTHING = sql``;
const OWNED_PRODUCT = sql<string>`p.id`;
const COMPETITOR_TARGET = sql<string>`c.target_id`;

const SORT_KEYS: Record<CommerceProductSort, RawBuilder<number>> = {
  visibility: sql`-f.appearances::float8`,
  win_rate: sql`-coalesce(f.win_rate, -1)`,
  position: sql`coalesce(f.position, 1e9)`,
  name: sql`0::float8`,
};

export const holderKindSchema = commerceProductRowSchema.shape.kind;

export function listedCompetitor(alias: string) {
  const state = sql.ref(alias + '.state');
  const source = sql.ref(alias + '.source_kind');
  return sql`(${state} = 'approved' OR (${state} = 'pending' AND ${source} = 'ai_observed'))`;
}

const rowSchema = z.object({
  executions: z.number().int(),
  total: z.number().int(),
  holder_id: z.uuid().nullable(),
  kind: holderKindSchema.nullable(),
  name: z.string().nullable(),
  name_key: z.string().nullable(),
  brand: z.string().nullable(),
  url: z.string().nullable(),
  sort_key: z.number().nullable(),
  appearances: z.number().int().nullable(),
  ordered_appearances: z.number().int().nullable(),
  visibility: z.number().nullable(),
  win_rate: z.number().nullable(),
  position: z.number().nullable(),
  catalog_price: z.number().nullable(),
  catalog_price_max: z.number().nullable(),
  catalog_currency: z.string().nullable(),
  price_currency: z.string().nullable(),
  price_median: z.number().nullable(),
  price_quoted: z.number().int().nullable(),
  price_other: z.number().int().nullable(),
  merchants: z.array(z.object({ domain: z.string(), count: z.number().int() })).nullable(),
  category_ids: z.array(z.uuid()).nullable(),
});

const ESCAPED_MATCH = String.raw`\$&`;
const likePattern = (text: string) => `%${text.replaceAll(/[\\%_]/gu, ESCAPED_MATCH)}%`;

function cursorPosition(query: ProductQuery, filters: Record<string, unknown>) {
  if (!query.cursor) return null;
  try {
    const [key, name, id] = decodeKeysetCursor(query.cursor, CURSOR_SCOPE, filters);
    if (key === undefined || name === undefined || !id || !z.uuid().safeParse(id).success)
      throw new InvalidCursorError('invalid Products cursor');
    const sortKey = Number(key);
    if (!Number.isFinite(sortKey)) throw new InvalidCursorError('invalid Products cursor');
    return { sortKey, name, id };
  } catch (error) {
    if (error instanceof InvalidCursorError) throw new ApiError(422, error.message);
    throw error;
  }
}

export type ExecutionScope = Pick<
  ProductQuery,
  'windowDays' | 'engine' | 'promptSet' | 'until' | 'after'
>;

function requireWindow(windowDays: number) {
  if (!policy.commerce.products.window_days.includes(windowDays))
    throw new ApiError(422, 'window must be one of the configured windows', {
      code: 'validation_error',
    });
}

const SLOT_RANKING = sql`(o.order_observable AND o.rank IS NOT NULL) DESC,
      (o.surface_kind = 'shopping_result') DESC, o.rank ASC NULLS LAST, o.created_at, o.id`;

export function scopedSlots(scope: CommerceScope, executions: ExecutionScope) {
  requireWindow(executions.windowDays);
  const ws = scope.workspaceId,
    project = scope.projectId;
  const end = executions.until ?? new Date();
  const since = new Date(end.getTime() - executions.windowDays * DAY_MS);
  const branded = [...policy.prompts.branded_cohorts];
  const untilFilter = executions.until ? sql`AND t.completed_at <= ${executions.until}` : NOTHING;
  const afterFilter = executions.after ? sql`AND t.completed_at > ${executions.after}` : NOTHING;
  const engineFilter = executions.engine
    ? sql`AND t.logical_engine = ${executions.engine}`
    : NOTHING;
  const promptSetFilter = executions.promptSet
    ? sql`AND pr.prompt_set_id = ${executions.promptSet}`
    : NOTHING;
  return sql`
    scoped_passes AS (
      SELECT DISTINCT ON (p.artifact_id) p.id AS pass_id, p.task_id, p.artifact_id
      FROM commerce_match_passes p
      JOIN audit_tasks t ON t.id = p.task_id AND t.workspace_id = p.workspace_id
      JOIN audit_prompt_snapshots s ON s.id = t.prompt_snapshot_id AND s.audit_id = t.audit_id
      LEFT JOIN prompts pr ON pr.id = s.prompt_id
      LEFT JOIN commerce_catalog_revisions r
        ON r.id = p.catalog_revision_id AND r.workspace_id = p.workspace_id
      WHERE p.workspace_id = ${ws} AND p.project_id = ${project}
        AND t.status = 'succeeded' AND t.completed_at >= ${since}
        AND s.cohort <> ALL(${branded}::text[])
        ${untilFilter}
        ${afterFilter}
        ${engineFilter}
        ${promptSetFilter}
      ORDER BY p.artifact_id, r.revision_number DESC NULLS LAST, p.created_at DESC, p.id DESC
    ),
    executions AS (SELECT count(DISTINCT task_id)::int AS n FROM scoped_passes),
    competitor_holders AS (
      SELECT c.id AS candidate_id,
             first_value(c.id) OVER (PARTITION BY c.canonical_url
               ORDER BY (c.state = 'approved') DESC, c.created_at, c.id) AS holder_id
      FROM commerce_competitor_candidates c
      WHERE c.workspace_id = ${ws} AND c.project_id = ${project} AND ${listedCompetitor('c')}
    ),
    observed AS (
      SELECT o.*,
             CASE WHEN o.classification = 'owned' THEN o.product_id
                  ELSE coalesce(ch.holder_id, o.competitor_candidate_id) END AS holder_id
      FROM commerce_recommendation_observations o
      JOIN scoped_passes sp ON sp.pass_id = o.pass_id
      LEFT JOIN competitor_holders ch ON ch.candidate_id = o.competitor_candidate_id
      WHERE o.workspace_id = ${ws} AND o.project_id = ${project}
        AND o.classification IN ('owned', 'approved_competitor', 'ai_observed_competitor')
    ),
    slots AS (
      SELECT DISTINCT ON (o.task_id, o.holder_id) o.task_id, o.holder_id, o.surface_kind,
             CASE WHEN o.order_observable THEN o.rank END AS best_rank
      FROM observed o WHERE o.holder_id IS NOT NULL
      ORDER BY o.task_id, o.holder_id, ${SLOT_RANKING}
    )`;
}

export function holderRows(
  scope: CommerceScope,
  {
    source,
    category,
    holder,
  }: { source: CommerceProductSource; category: string | null; holder?: string },
) {
  const ws = scope.workspaceId,
    project = scope.projectId;
  const inCategory = (column: RawBuilder<string>) => sql`${column} IN (
      SELECT m.product_id FROM commerce_product_categories m
      WHERE m.workspace_id = ${ws} AND m.project_id = ${project} AND m.category_id = ${category})`;
  const competitorInCategory = category
    ? sql`AND EXISTS (SELECT 1 FROM commerce_competitor_candidates c
           WHERE c.workspace_id = ${ws} AND c.project_id = ${project} AND c.id = ANY(g.members)
             AND ((c.target_kind = 'category' AND c.target_id = ${category})
               OR (c.target_kind = 'product' AND ${inCategory(COMPETITOR_TARGET)})))`
    : NOTHING;
  const competitors =
    source === 'all'
      ? sql`UNION ALL
        SELECT CASE WHEN c.state = 'approved' THEN 'approved_competitor'
                    ELSE 'ai_observed_competitor' END,
               c.id, c.product_name, c.brand_name, c.canonical_url, NULL::float8, NULL::float8, '',
               g.members
        FROM (SELECT holder_id, array_agg(candidate_id ORDER BY candidate_id) AS members
              FROM competitor_holders GROUP BY holder_id) g
        JOIN commerce_competitor_candidates c
          ON c.id = g.holder_id AND c.workspace_id = ${ws} AND c.project_id = ${project}
        WHERE true ${competitorInCategory}`
      : NOTHING;
  const ownedInCategory = category ? sql`AND ${inCategory(OWNED_PRODUCT)}` : NOTHING;
  const listedState = source === 'archived' ? 'archived' : 'active';
  const anyState = holder !== undefined && source === 'all';
  const ownedLifecycle = anyState ? NOTHING : sql`AND p.lifecycle_state = ${listedState}`;
  return sql`
      SELECT 'owned'::text AS kind, p.id AS holder_id, p.name, p.brand, p.canonical_url AS url,
             p.price::float8 AS catalog_price,
             coalesce(p.price_max, p.price)::float8 AS catalog_price_max, p.currency AS catalog_currency,
             ARRAY[p.id] AS members
      FROM commerce_products p
      WHERE p.workspace_id = ${ws} AND p.project_id = ${project}
        ${ownedLifecycle}
        ${ownedInCategory}
      ${competitors}`;
}

export async function productMetrics(db: Database, scope: CommerceScope, query: ProductQuery) {
  const slotsInScope = scopedSlots(scope, query);
  const { cursor: _cursor, limit: _limit, ...rest } = query;
  const filters = { ...rest, project: scope.projectId };
  const position = cursorPosition(query, filters);
  const ws = scope.workspaceId,
    project = scope.projectId;
  const search = query.q?.trim() ? likePattern(query.q.trim()) : null;
  const searchFilter = search
    ? sql`AND (h.name ILIKE ${search} OR h.brand ILIKE ${search} OR h.url ILIKE ${search})`
    : NOTHING;
  const holderFilter = query.holder ? sql`AND ${query.holder}::uuid = ANY(h.members)` : NOTHING;
  // LIMIT NULL is no limit.
  const merchantLimit = query.allMerchants ? null : policy.commerce.products.merchant_limit;
  const afterCursor = position
    ? sql`WHERE (k.sort_key, k.name_key, k.holder_id)
              > (${position.sortKey}::float8, ${position.name}, ${position.id}::uuid)`
    : NOTHING;
  const result = await sql<unknown>`
    WITH ${slotsInScope},
    slot_metrics AS (
      SELECT holder_id, count(*)::int AS appearances, count(best_rank)::int AS ordered,
             count(*) FILTER (WHERE best_rank = 1)::int AS wins,
             avg(best_rank)::float8 AS position
      FROM slots GROUP BY holder_id
    ),
    priced AS (
      SELECT DISTINCT ON (o.task_id, o.holder_id) o.holder_id,
             o.observed_price::float8 AS price, o.observed_currency AS currency
      FROM observed o WHERE o.holder_id IS NOT NULL AND o.observed_price IS NOT NULL
      ORDER BY o.task_id, o.holder_id, ${SLOT_RANKING}
    ),
    merchant_counts AS (
      SELECT o.holder_id, o.merchant_domain AS domain, count(DISTINCT o.task_id)::int AS n
      FROM observed o WHERE o.holder_id IS NOT NULL AND o.merchant_domain <> ''
      GROUP BY o.holder_id, o.merchant_domain
    ),
    holders AS (${holderRows(scope, query)}),
    filtered AS (
      SELECT h.*, lower(h.name) AS name_key,
             coalesce(m.appearances, 0) AS appearances,
             coalesce(m.ordered, 0) AS ordered_appearances,
             m.position,
             CASE WHEN e.n > 0 THEN coalesce(m.appearances, 0)::float8 / e.n END AS visibility,
             CASE WHEN m.ordered > 0 THEN m.wins::float8 / m.ordered END AS win_rate
      FROM holders h CROSS JOIN executions e
      LEFT JOIN slot_metrics m ON m.holder_id = h.holder_id
      WHERE true ${searchFilter} ${holderFilter}
    ),
    keyed AS (SELECT f.*, ${SORT_KEYS[query.sort]} AS sort_key FROM filtered f)
    SELECT e.n AS executions, (SELECT count(*)::int FROM filtered) AS total, page.*
    FROM executions e
    LEFT JOIN LATERAL (
      SELECT k.holder_id, k.kind, k.name, k.name_key, k.brand, k.url, k.sort_key,
             k.appearances, k.ordered_appearances, k.visibility, k.win_rate, k.position,
             k.catalog_price, k.catalog_price_max, k.catalog_currency,
             cur.currency AS price_currency, price.median AS price_median,
             price.quoted AS price_quoted, price.other AS price_other,
             merch.merchants, cats.category_ids
      -- Cut the page first so the per-holder laterals below run only for its rows.
      FROM (SELECT * FROM keyed k ${afterCursor}
            ORDER BY k.sort_key, k.name_key, k.holder_id LIMIT ${query.limit + 1}) k
      LEFT JOIN LATERAL (
        SELECT coalesce(nullif(k.catalog_currency, ''), (
          SELECT pq.currency FROM priced pq
          WHERE pq.holder_id = k.holder_id AND pq.currency <> ''
          GROUP BY pq.currency ORDER BY count(*) DESC, pq.currency LIMIT 1), '') AS currency
      ) cur ON true
      LEFT JOIN LATERAL (
        SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY pq.price)
                 FILTER (WHERE pq.currency = cur.currency) AS median,
               count(*) FILTER (WHERE pq.currency = cur.currency)::int AS quoted,
               count(*) FILTER (WHERE pq.currency <> cur.currency)::int AS other
        FROM priced pq WHERE pq.holder_id = k.holder_id
      ) price ON true
      LEFT JOIN LATERAL (
        SELECT coalesce(json_agg(json_build_object('domain', mc.domain, 'count', mc.n)
                                 ORDER BY mc.n DESC, mc.domain), '[]'::json) AS merchants
        FROM (SELECT * FROM merchant_counts mc WHERE mc.holder_id = k.holder_id
              ORDER BY mc.n DESC, mc.domain LIMIT ${merchantLimit}) mc
      ) merch ON true
      LEFT JOIN LATERAL (
        SELECT coalesce(array_agg(m.category_id::text ORDER BY m.category_id), '{}') AS category_ids
        FROM commerce_product_categories m
        JOIN commerce_categories c ON c.id = m.category_id AND c.workspace_id = m.workspace_id
        WHERE m.workspace_id = ${ws} AND m.project_id = ${project}
          AND m.product_id = k.holder_id AND c.normalized_name <> ${UNCATEGORIZED_KEY}
      ) cats ON true
      ORDER BY k.sort_key, k.name_key, k.holder_id
    ) page ON true
    ORDER BY page.sort_key, page.name_key, page.holder_id
  `.execute(db);
  const rows = result.rows.map((row) => rowSchema.parse(row));
  const [first] = rows;
  if (!first) throw new Error('Products read returned no executions row');
  const present = rows.filter((row) => row.holder_id !== null);
  const shown = present.slice(0, query.limit);
  const last = shown.at(-1);
  return commerceProductPageSchema.parse({
    window_days: query.windowDays,
    executions: first.executions,
    total: first.total,
    items: shown.map((row) => ({
      holder_id: row.holder_id,
      kind: row.kind,
      name: row.name,
      brand: row.brand,
      url: row.url,
      category_ids: row.category_ids ?? [],
      visibility: row.visibility,
      appearances: row.appearances,
      ordered_appearances: row.ordered_appearances,
      win_rate: row.win_rate,
      position: row.position,
      mentioned_price: {
        median: row.price_median,
        currency: row.price_currency ?? '',
        quoted: row.price_quoted ?? 0,
        other_currency: row.price_other ?? 0,
      },
      catalog_price:
        row.catalog_price === null
          ? null
          : {
              min: row.catalog_price,
              max: row.catalog_price_max ?? row.catalog_price,
              currency: row.catalog_currency ?? '',
            },
      merchants: row.merchants ?? [],
    })),
    next_cursor:
      present.length > query.limit && last
        ? encodeKeysetCursor(CURSOR_SCOPE, filters, [
            String(last.sort_key),
            last.name_key ?? '',
            last.holder_id ?? '',
          ])
        : null,
  });
}
