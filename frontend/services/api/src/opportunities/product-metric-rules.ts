/**
 * Commerce Actions from the per-product metrics (commerce improvement PR 9).
 * Each rule reads one metric of the Products read (`commerce/products.ts`)
 * for an owned catalog product: the refresh raises a finding when a reading
 * with enough samples does not clear the rule's target, and a declared
 * Action's check reads the same metric over the answers after go-live.
 *
 * A reading is `measured`, `insufficient` (fewer samples than the rule needs:
 * no finding, a waiting check) or `unknown` (the metric cannot be read, such
 * as a price gap without a catalog price). None of them becomes a zero.
 */
import type { CommerceProductPage } from '@citeladder/contracts/commerce-suite';
import type { ExpectedCheck } from '@citeladder/contracts/opportunities';
import { sql } from 'kysely';

import type { DetectorHit } from '../analysis/opportunities/evidence.ts';
import { rules } from '../analysis/opportunities/detectors.ts';
import { isOwnedHost, ownedHosts } from '../commerce/discovery-validation.ts';
import { productMetrics, scopedSlots, type ExecutionScope } from '../commerce/products.ts';
import type { CommerceScope } from '../commerce/reads.ts';
import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';

const o = policy.opportunity.opportunities;
const m = o.PRODUCT_METRICS;

type ProductMetricCheck = Extract<ExpectedCheck, { kind: 'product_metric' }>;
export type ProductMetricRule = Pick<
  ProductMetricCheck,
  'metric' | 'comparison' | 'target' | 'min_samples'
>;
export type ProductMetricRuleId = keyof typeof m.RULES;
type ProductRow = CommerceProductPage['items'][number];

export const isProductMetricRule = (id: string): id is ProductMetricRuleId =>
  Object.hasOwn(m.RULES, id);

export const productMetricRule = (id: ProductMetricRuleId): ProductMetricRule => m.RULES[id];

export type MetricReading =
  | { state: 'measured'; value: number; samples: number }
  | {
      state: 'insufficient';
      samples: number;
      /** Only quotes in other currencies, which are not converted, or too few samples. */
      reason: 'quotes_in_other_currencies' | 'too_few_samples';
    }
  | { state: 'unknown'; reason: 'no_catalog_price' };

/** A value and its samples; `excluded` counts readings left out (quotes in other currencies). */
type Raw =
  | { value: number | null; samples: number; excluded: number }
  | { unknown: 'no_catalog_price' };

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

/**
 * How far a quoted price sits outside the catalog price (or its variant
 * range), as a share of the nearest bound; 0 inside the range.
 */
function priceGap(price: number, catalog: { min: number; max: number }) {
  if (price < catalog.min) return (catalog.min - price) / catalog.min;
  if (price > catalog.max) return (price - catalog.max) / catalog.max;
  return 0;
}

/** The metric's value and sample count on one row, before the rule's minimum. */
function raw(
  metric: ProductMetricRule['metric'],
  row: ProductRow,
  executions: number,
  owned: readonly string[],
): Raw {
  switch (metric) {
    case 'appearances':
      return { value: row.appearances, samples: executions, excluded: 0 };
    case 'win_rate':
      return { value: row.win_rate, samples: row.ordered_appearances, excluded: 0 };
    case 'price_gap_share': {
      const catalog = row.catalog_price;
      if (!catalog?.currency || catalog.min <= 0) return { unknown: 'no_catalog_price' };
      // The read medians quotes in the catalog currency; others are not converted.
      const { median, currency, quoted, other_currency: excluded } = row.mentioned_price;
      if (median === null || currency !== catalog.currency)
        return { value: null, samples: 0, excluded };
      return { value: priceGap(median, catalog), samples: quoted, excluded };
    }
    case 'owned_merchant_answers':
      return {
        value: sum(
          row.merchants.filter((item) => isOwnedHost(item.domain, owned)).map((item) => item.count),
        ),
        samples: sum(row.merchants.map((item) => item.count)),
        excluded: 0,
      };
    default: {
      const _exhaustive: never = metric;
      return _exhaustive;
    }
  }
}

/** One rule's reading of one product row. */
export function readMetric(
  rule: ProductMetricRule,
  row: ProductRow,
  executions: number,
  owned: readonly string[],
): MetricReading {
  const found = raw(rule.metric, row, executions, owned);
  if ('unknown' in found) return { state: 'unknown', reason: found.unknown };
  if (found.value === null || found.samples < rule.min_samples)
    return {
      state: 'insufficient',
      samples: found.samples,
      reason:
        found.samples === 0 && found.excluded > 0
          ? 'quotes_in_other_currencies'
          : 'too_few_samples',
    };
  return { state: 'measured', value: found.value, samples: found.samples };
}

/** Whether a value clears the rule: the finding's condition no longer holds. */
export const clears = (rule: ProductMetricRule, value: number) =>
  rule.comparison === 'at_least' ? value >= rule.target : value <= rule.target;

/** The Products read for owned products, every merchant included. */
function catalogQuery(scope: ExecutionScope, holder?: string) {
  return {
    ...scope,
    source: 'catalog' as const,
    category: null,
    q: null,
    sort: 'name' as const,
    allMerchants: true,
    ...(holder === undefined ? {} : { holder }),
  };
}

/** One owned product's row and the executions in scope; null when it is not an active product. */
export async function productRow(
  db: Database,
  scope: CommerceScope,
  executions: ExecutionScope,
  productId: string,
) {
  const page = await productMetrics(db, scope, {
    ...catalogQuery(executions, productId),
    cursor: null,
    limit: 1,
  });
  const [row] = page.items;
  return row ? { row, executions: page.executions } : null;
}

/** Every owned product's row, page by page, and the executions in scope. */
async function catalogRows(db: Database, scope: CommerceScope, executions: ExecutionScope) {
  const rows: ProductRow[] = [];
  let total = 0;
  let cursor: string | null = null;
  do {
    const query = { ...catalogQuery(executions), cursor, limit: m.PAGE_SIZE };
    const page: CommerceProductPage = await productMetrics(db, scope, query); // NOSONAR -- Each page continues from the previous cursor.
    total = page.executions;
    rows.push(...page.items);
    cursor = page.next_cursor;
  } while (cursor);
  return { rows, executions: total };
}

/** The observations each holder's metrics were read from, by holder. */
export async function observationIds(
  db: Database,
  scope: CommerceScope,
  executions: ExecutionScope,
  holders: string[],
): Promise<Map<string, string[]>> {
  if (!holders.length) return new Map();
  const { rows } = await sql<{ holder_id: string; ids: string[] }>`
    WITH ${scopedSlots(scope, executions)}
    SELECT o.holder_id::text AS holder_id, array_agg(o.id::text ORDER BY o.id) AS ids
    FROM observed o WHERE o.holder_id = ANY(${holders}::uuid[])
    GROUP BY o.holder_id
  `.execute(db);
  return new Map(rows.map((row) => [row.holder_id, row.ids]));
}

/** What a finding stores: the product, the window measured, the reading and the row's figures. */
function evidence(
  row: ProductRow,
  rule: ProductMetricRule,
  reading: Extract<MetricReading, { state: 'measured' }>,
  context: { asOf: Date; executions: number },
) {
  return {
    product_id: row.holder_id,
    product_name: row.name,
    window_days: m.WINDOW_DAYS,
    as_of: context.asOf.toISOString(),
    executions: context.executions,
    metric: rule.metric,
    value: reading.value,
    samples: reading.samples,
    threshold: rule.target,
    appearances: row.appearances,
    ordered_appearances: row.ordered_appearances,
    win_rate: row.win_rate,
    mentioned_price: {
      median: row.mentioned_price.median,
      currency: row.mentioned_price.currency,
      quoted: row.mentioned_price.quoted,
    },
    catalog_price: row.catalog_price
      ? { amount: row.catalog_price.min, currency: row.catalog_price.currency }
      : null,
    merchants: row.merchants,
  };
}

/**
 * The per-product metric findings for the window ending at `asOf`, in
 * (rule, product) order: each enabled rule over every active owned product.
 */
export async function productMetricHits(
  db: Database,
  scope: CommerceScope,
  asOf: Date,
): Promise<DetectorHit[]> {
  const enabled = Object.keys(m.RULES)
    .filter(isProductMetricRule)
    .filter((id) => rules[id]?.enabled);
  if (!enabled.length) return [];
  const window: ExecutionScope = {
    windowDays: m.WINDOW_DAYS,
    engine: null,
    promptSet: null,
    until: asOf,
  };
  const { rows, executions } = await catalogRows(db, scope, window);
  const owned = await ownedHosts(db, scope);
  const found = enabled.flatMap((id) =>
    rows.flatMap((row) => {
      const rule = productMetricRule(id);
      const reading = readMetric(rule, row, executions, owned);
      return reading.state === 'measured' && !clears(rule, reading.value)
        ? [{ id, rule, row, reading }]
        : [];
    }),
  );
  const ids = await observationIds(db, scope, window, [
    ...new Set(found.map((item) => item.row.holder_id)),
  ]);
  return found.map(({ id, rule, row, reading }) => ({
    rule_id: id,
    target: { kind: 'product' as const, product_id: row.holder_id },
    evidence: evidence(row, rule, reading, { asOf, executions }),
    source_analysis_ids: [],
    source_issue_ids: [],
    source_metric_ids: ids.get(row.holder_id) ?? [],
    value_factor: o.COMMERCE_VALUE_FACTOR,
    gap_factor: o.COMMERCE_GAP_FACTOR,
  }));
}
