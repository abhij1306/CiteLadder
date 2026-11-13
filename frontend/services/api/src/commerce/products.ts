/**
 * The Products table read: one keyset-paged SQL read of every product holder's
 * metrics over persisted observations (commerce improvement PR 3, formula
 * version 1 of the plan's "Metric definitions").
 *
 * Scope is the successful executions in the window (and engine and prompt set,
 * when filtered) whose answer has a match pass; each answer counts once,
 * through its latest pass (highest catalog revision, then newest). Branded
 * comparisons stay out, as they stay out of organic Visibility and the AI
 * Shelf. A holder (an owned product or a competitor candidate) holds at most
 * one slot per execution, at its best rank: a ranked slot beats an unranked
 * one and a carousel card's rank wins over a text-list rank.
 *
 * It reads only persisted rows: no provider, model or repair, and every table
 * is filtered to the authorized workspace and project.
 */
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
  /** One holder's row only: the detail page's KPIs, never set by the table. */
  holder?: string;
  /** Every merchant, not the table's top few: commerce Actions judge the whole list. */
  allMerchants?: boolean;
  /** The window ends here rather than now: an Action records the instant it measured. */
  until?: Date;
  /** Only executions completed after this instant: an Action's later window. */
  after?: Date;
};

const CURSOR_SCOPE = 'commerce.products';
const NOTHING = sql``;
const OWNED_PRODUCT = sql<string>`p.id`;
const COMPETITOR_TARGET = sql<string>`c.target_id`;

/**
 * Every sort is ascending on one float key, then the lowercased name, then the
 * holder id, so a keyset cursor is one row comparison. A descending metric is
 * negated; a missing one sorts last. Visibility shares its denominator across
 * rows, so it orders by appearances, an exact integer.
 */
const SORT_KEYS: Record<CommerceProductSort, RawBuilder<number>> = {
  visibility: sql`-f.appearances::float8`,
  win_rate: sql`-coalesce(f.win_rate, -1)`,
  position: sql`coalesce(f.position, 1e9)`,
  name: sql`0::float8`,
};

/** Owned, approved competitor or AI-observed competitor: the holders a Commerce metrics read lists. */
export const holderKindSchema = commerceProductRowSchema.shape.kind;

/**
 * The competitor candidates a Commerce metrics read lists, on the candidate
 * table aliased `alias`: approved ones, and pending ones the AI observed.
 */
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

/** `%` and `_` in the reader's text match themselves, not any character. */
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

/** The executions a product read covers: its window, engine and prompt set. */
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

/** A slot's best observation first: ordered, then carousel, then rank. */
const SLOT_RANKING = sql`(o.order_observable AND o.rank IS NOT NULL) DESC,
      (o.surface_kind = 'shopping_result') DESC, o.rank ASC NULLS LAST, o.created_at, o.id`;

/**
 * The CTEs every Commerce metrics read (the Products table, a product's page
 * and the Shopping overview) starts from: `scoped_passes`, each successful
 * non-branded execution in scope once, through its latest match pass;
 * `executions`, their count (the visibility denominator); `observed`, the
 * holder observations of those passes; and `slots`, each holder's one slot
 * per execution at its best rank. A window outside the configured ones is
 * refused.
 */
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
    observed AS (
      SELECT o.*,
             CASE WHEN o.classification = 'owned' THEN o.product_id
                  ELSE o.competitor_candidate_id END AS holder_id
      FROM commerce_recommendation_observations o
      JOIN scoped_passes sp ON sp.pass_id = o.pass_id
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

/**
 * The product holders a read lists, as `kind, holder_id, name, brand, url,
 * catalog_price, catalog_price_max, catalog_currency` rows: the active catalog (or with
 * `archived` the archived one), and with `all` the approved and AI-observed
 * competitors; with a category, only its own. One `holder`'s read under
 * `all` (the product page) takes its product in either state; under `catalog`
 * it stays the active product alone.
 */
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
  // Optional fragments are built here, so the read below has no nested templates.
  const competitorInCategory = category
    ? sql`AND ((c.target_kind = 'category' AND c.target_id = ${category})
           OR (c.target_kind = 'product' AND ${inCategory(COMPETITOR_TARGET)}))`
    : NOTHING;
  const competitors =
    source === 'all'
      ? sql`UNION ALL
        SELECT CASE WHEN c.state = 'approved' THEN 'approved_competitor'
                    ELSE 'ai_observed_competitor' END,
               c.id, c.product_name, c.brand_name, c.canonical_url, NULL::float8, NULL::float8, ''
        FROM commerce_competitor_candidates c
        WHERE c.workspace_id = ${ws} AND c.project_id = ${project}
          AND ${listedCompetitor('c')}
          ${competitorInCategory}`
      : NOTHING;
  const ownedInCategory = category ? sql`AND ${inCategory(OWNED_PRODUCT)}` : NOTHING;
  // A product page reads its holder archived or not; any other read takes one state.
  const listedState = source === 'archived' ? 'archived' : 'active';
  const anyState = holder !== undefined && source === 'all';
  const ownedLifecycle = anyState ? NOTHING : sql`AND p.lifecycle_state = ${listedState}`;
  return sql`
      SELECT 'owned'::text AS kind, p.id AS holder_id, p.name, p.brand, p.canonical_url AS url,
             p.price::float8 AS catalog_price,
             coalesce(p.price_max, p.price)::float8 AS catalog_price_max, p.currency AS catalog_currency
      FROM commerce_products p
      WHERE p.workspace_id = ${ws} AND p.project_id = ${project}
        ${ownedLifecycle}
        ${ownedInCategory}
      ${competitors}`;
}

export async function productMetrics(db: Database, scope: CommerceScope, query: ProductQuery) {
  const slotsInScope = scopedSlots(scope, query);
  // A cursor is bound to its project and filters; any other read refuses it.
  const { cursor: _cursor, limit: _limit, ...rest } = query;
  const filters = { ...rest, project: scope.projectId };
  const position = cursorPosition(query, filters);
  const ws = scope.workspaceId,
    project = scope.projectId;
  const search = query.q?.trim() ? likePattern(query.q.trim()) : null;
  const searchFilter = search
    ? sql`AND (h.name ILIKE ${search} OR h.brand ILIKE ${search} OR h.url ILIKE ${search})`
    : NOTHING;
  const holderFilter = query.holder ? sql`AND h.holder_id = ${query.holder}` : NOTHING;
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
      FROM keyed k
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
      ${afterCursor}
      ORDER BY k.sort_key, k.name_key, k.holder_id
      LIMIT ${query.limit + 1}
    ) page ON true
    ORDER BY page.sort_key, page.name_key, page.holder_id
  `.execute(db);
  const rows = result.rows.map((row) => rowSchema.parse(row));
  // The executions row always exists; the page joins to it laterally.
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
