/**
 * One product holder's page (commerce improvement PR 4): its Products row and
 * the answers behind it, over the same executions the Products table reads.
 *
 * The row is the table's own read narrowed to this holder, so the page and the
 * table never disagree. The sections come from one SQL read over the same
 * scoped slots: competing holders by shared executions, merchants, the
 * citations and fan-out queries of the executions it appeared in, per-prompt
 * metrics and the answers themselves. It reads only persisted rows, every
 * table filtered to the authorized workspace and project.
 */
import { commerceProductDetailSchema } from '@citeladder/contracts/commerce-suite';
import { sql } from 'kysely';
import { z } from 'zod';

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { utcTextOf, wireUtc } from '../db/timestamps.ts';
import { productCategories } from './catalog-store.ts';
import {
  holderKindSchema,
  listedCompetitor,
  productMetrics,
  scopedSlots,
  type ExecutionScope,
} from './products.ts';
import { commerceMissing, targetActions, type CommerceScope } from './reads.ts';

const count = z.number().int();
const sectionsSchema = z.object({
  competing: z.array(
    z.object({
      holder_id: z.uuid(),
      kind: holderKindSchema,
      name: z.string(),
      brand: z.string(),
      shared: count,
      ahead: count,
      position: z.number().nullable(),
    }),
  ),
  merchants: z.array(z.object({ domain: z.string(), count })),
  sources: z.array(z.object({ url: z.string(), title: z.string(), domain: z.string(), count })),
  fan_out_queries: z.array(z.object({ query: z.string(), count })),
  prompts: z.array(
    z.object({
      prompt_id: z.uuid().nullable(),
      text: z.string(),
      executions: count,
      appearances: count,
      ordered: count,
      wins: count,
      position: z.number().nullable(),
    }),
  ),
  answers: z.array(
    z.object({
      task_id: z.uuid(),
      audit_id: z.uuid(),
      prompt_text: z.string(),
      engine: z.string(),
      completed_at: z.string(),
      rank: z.number().int().nullable(),
    }),
  ),
  answer_total: count,
  description: z.string().nullable(),
  image_url: z.string().nullable(),
});

const ratio = (part: number, whole: number) => (whole > 0 ? part / whole : null);

function outcome(rank: number | null) {
  if (rank === null) return 'unranked';
  return rank === 1 ? 'won' : 'lost';
}

async function sections(
  db: Database,
  scope: CommerceScope,
  executions: ExecutionScope,
  holder: string,
) {
  const ws = scope.workspaceId,
    project = scope.projectId;
  const {
    list_limit: list,
    prompt_limit: prompts,
    answer_limit: answers,
  } = policy.commerce.products.detail;
  const result = await sql<unknown>`
    WITH ${scopedSlots(scope, executions)},
    mine AS (SELECT task_id, best_rank FROM slots WHERE holder_id = ${holder}),
    tasks AS (
      SELECT t.id AS task_id, t.audit_id, t.logical_engine, t.completed_at,
             s.prompt_id, s.text AS prompt_text
      FROM (SELECT DISTINCT task_id FROM scoped_passes) sp
      JOIN audit_tasks t ON t.id = sp.task_id AND t.workspace_id = ${ws} AND t.project_id = ${project}
      JOIN audit_prompt_snapshots s ON s.id = t.prompt_snapshot_id AND s.audit_id = t.audit_id
    ),
    analyses AS (
      SELECT ra.id, ra.task_id, ra.fanout_queries
      FROM response_analyses ra JOIN mine m ON m.task_id = ra.task_id
      WHERE ra.workspace_id = ${ws}
    ),
    targeted AS (
      SELECT pt.prompt_id FROM commerce_prompt_targets pt
      WHERE pt.workspace_id = ${ws} AND pt.project_id = ${project}
        AND pt.target_kind = 'product' AND pt.target_id = ${holder}
    )
    SELECT
      (SELECT coalesce(json_agg(c ORDER BY c.shared DESC, c.name, c.holder_id), '[]'::json) FROM (
        SELECT o.holder_id, o.shared, o.ahead, o.position,
               coalesce(p.name, cc.product_name) AS name, coalesce(p.brand, cc.brand_name) AS brand,
               CASE WHEN p.id IS NOT NULL THEN 'owned'
                    WHEN cc.state = 'approved' THEN 'approved_competitor'
                    ELSE 'ai_observed_competitor' END AS kind
        FROM (
          SELECT s.holder_id, count(*)::int AS shared,
                 count(*) FILTER (WHERE s.best_rank IS NOT NULL
                   AND (m.best_rank IS NULL OR s.best_rank < m.best_rank))::int AS ahead,
                 avg(s.best_rank)::float8 AS position
          FROM slots s JOIN mine m ON m.task_id = s.task_id
          WHERE s.holder_id <> ${holder}
          GROUP BY s.holder_id
        ) o
        LEFT JOIN commerce_products p
          ON p.id = o.holder_id AND p.workspace_id = ${ws} AND p.project_id = ${project}
          AND p.lifecycle_state = 'active'
        LEFT JOIN commerce_competitor_candidates cc
          ON cc.id = o.holder_id AND cc.workspace_id = ${ws} AND cc.project_id = ${project}
          AND ${listedCompetitor('cc')}
        -- Only holders the Products table lists, so each links to a page.
        WHERE p.id IS NOT NULL OR cc.id IS NOT NULL
        ORDER BY o.shared DESC, name, o.holder_id
        LIMIT ${list}
      ) c) AS competing,
      (SELECT coalesce(json_agg(json_build_object('domain', d.domain, 'count', d.n)
                                ORDER BY d.n DESC, d.domain), '[]'::json) FROM (
        SELECT o.merchant_domain AS domain, count(DISTINCT o.task_id)::int AS n
        FROM observed o WHERE o.holder_id = ${holder} AND o.merchant_domain <> ''
        GROUP BY o.merchant_domain ORDER BY n DESC, domain LIMIT ${list}
      ) d) AS merchants,
      (SELECT coalesce(json_agg(json_build_object(
                'url', u.url, 'title', u.title, 'domain', u.domain, 'count', u.n)
              ORDER BY u.n DESC, u.url), '[]'::json) FROM (
        SELECT c.url, max(c.title) AS title, max(c.domain) AS domain,
               count(DISTINCT a.task_id)::int AS n
        FROM citations c JOIN analyses a ON a.id = c.analysis_id
        WHERE c.workspace_id = ${ws} AND c.url <> ''
        GROUP BY c.url ORDER BY n DESC, c.url LIMIT ${list}
      ) u) AS sources,
      (SELECT coalesce(json_agg(json_build_object('query', q.query, 'count', q.n)
                                ORDER BY q.n DESC, q.query), '[]'::json) FROM (
        SELECT f.query, count(DISTINCT a.task_id)::int AS n
        FROM analyses a CROSS JOIN LATERAL unnest(a.fanout_queries) AS f(query)
        WHERE f.query <> ''
        GROUP BY f.query ORDER BY n DESC, f.query LIMIT ${list}
      ) q) AS fan_out_queries,
      (SELECT coalesce(json_agg(pr ORDER BY pr.appearances DESC, pr.executions DESC, pr.text), '[]'::json)
       FROM (
        SELECT (array_agg(t.prompt_id))[1] AS prompt_id, min(t.prompt_text) AS text,
               count(*)::int AS executions, count(m.task_id)::int AS appearances,
               count(m.best_rank)::int AS ordered,
               count(*) FILTER (WHERE m.best_rank = 1)::int AS wins,
               avg(m.best_rank)::float8 AS position
        FROM tasks t LEFT JOIN mine m ON m.task_id = t.task_id
        GROUP BY coalesce(t.prompt_id::text, t.prompt_text)
        HAVING count(m.task_id) > 0 OR bool_or(t.prompt_id IN (SELECT prompt_id FROM targeted))
        ORDER BY appearances DESC, executions DESC, text LIMIT ${prompts}
      ) pr) AS prompts,
      (SELECT coalesce(json_agg(json_build_object(
                'task_id', a.task_id, 'audit_id', a.audit_id, 'prompt_text', a.prompt_text,
                'engine', a.logical_engine, 'completed_at', a.completed_at, 'rank', a.best_rank)
              ORDER BY a.completed_at DESC, a.task_id), '[]'::json) FROM (
        SELECT t.task_id, t.audit_id, t.prompt_text, t.logical_engine,
               ${utcTextOf(sql.ref('t.completed_at'))} AS completed_at, m.best_rank
        FROM mine m JOIN tasks t ON t.task_id = m.task_id
        ORDER BY t.completed_at DESC, t.task_id LIMIT ${answers}
      ) a) AS answers,
      (SELECT count(*)::int FROM mine) AS answer_total,
      (SELECT p.description FROM commerce_products p
       WHERE p.id = ${holder} AND p.workspace_id = ${ws} AND p.project_id = ${project}) AS description,
      (SELECT o.observed_image_url FROM commerce_recommendation_observations o
       WHERE o.workspace_id = ${ws} AND o.project_id = ${project}
         AND (o.product_id = ${holder} OR o.competitor_candidate_id = ${holder})
         AND coalesce(o.observed_image_url, '') <> ''
       ORDER BY o.created_at DESC, o.id DESC LIMIT 1) AS image_url
  `.execute(db);
  return sectionsSchema.parse(result.rows[0]);
}

const catalogSchema = commerceProductDetailSchema.shape.product.shape.catalog.unwrap();

/** An owned product's editable record: its fields, catalog image and category names. */
async function catalogRecord(db: Database, scope: CommerceScope, holder: string) {
  const [product, categories] = await Promise.all([
    db
      .selectFrom('commerce_products')
      .select(['lifecycle_state', 'price', 'currency', 'sku', 'gtin', 'mpn', 'image_url'])
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .where('id', '=', holder)
      .executeTakeFirstOrThrow(),
    productCategories(db, scope, holder).select('c.name').orderBy('c.name').execute(),
  ]);
  return catalogSchema.parse({
    lifecycle_state: product.lifecycle_state,
    price: product.price === null ? null : Number(product.price),
    currency: product.currency,
    sku: product.sku ?? '',
    gtin: product.gtin ?? '',
    mpn: product.mpn ?? '',
    image_url: product.image_url,
    categories: categories.map((row) => row.name),
  });
}

/**
 * The page for `holder`: an owned product (active or archived), an approved
 * competitor or an AI-observed one, as the Products table lists it. A holder
 * the table would not list (rejected, another project's) is not found.
 */
export async function productDetail(
  db: Database,
  scope: CommerceScope,
  holder: string,
  executions: ExecutionScope,
) {
  // Both reads refuse a window outside the configured ones before any query.
  const [page, detail] = await Promise.all([
    productMetrics(db, scope, {
      ...executions,
      source: 'all',
      category: null,
      q: null,
      sort: 'name',
      cursor: null,
      limit: 1,
      holder,
    }),
    sections(db, scope, executions, holder),
  ]);
  const [row] = page.items;
  if (!row) commerceMissing('Product not found');
  const owned = row.kind === 'owned';
  const [actions, record] = await Promise.all([
    owned ? targetActions(db, scope, { kind: 'product', id: holder }) : [],
    owned ? catalogRecord(db, scope, holder) : null,
  ]);
  const { description, image_url, prompts, answers, ...lists } = detail;
  return commerceProductDetailSchema.parse({
    window_days: page.window_days,
    executions: page.executions,
    product: {
      ...row,
      description: description ?? '',
      image_url: record?.image_url || image_url,
      catalog: record,
    },
    ...lists,
    prompts: prompts.map(({ ordered, wins, appearances, executions: asked, ...prompt }) => ({
      ...prompt,
      executions: asked,
      appearances,
      visibility: ratio(appearances, asked),
      win_rate: ratio(wins, ordered),
    })),
    answers: answers.map(({ rank, completed_at, ...answer }) => ({
      ...answer,
      completed_at: wireUtc(completed_at),
      rank,
      outcome: outcome(rank),
    })),
    actions,
  });
}
