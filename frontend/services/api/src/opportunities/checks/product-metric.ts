/**
 * A per-product commerce finding clears in the answers after go-live: the
 * rule's metric, read by the Products read over the executions completed
 * after the declaration and up to the announced run, meets the frozen target.
 * Too few samples keep it waiting; a metric that cannot be read (no catalog
 * price, the product archived) is unavailable, never unmet.
 */
import { z } from 'zod';

import { ownedHosts } from '../../commerce/discovery-validation.ts';
import type { ExecutionScope } from '../../commerce/products.ts';
import type { Database } from '../../db/database.ts';
import { policy } from '../../config.ts';
import {
  clears,
  isProductMetricRule,
  observationIds,
  productMetricRule,
  productRow,
  readMetric,
  type MetricReading,
} from '../product-metric-rules.ts';
import type { Scope } from '../sources.ts';
import { outcome } from '../verification-decisions.ts';
import type { CheckModule, CheckOf, MemberCheck, MemberFacts } from './kind.ts';
import { once } from './read-context.ts';

type Check = CheckOf<'product_metric'>;
const m = policy.opportunity.opportunities.PRODUCT_METRICS;

const productEvidence = z.object({ product_id: z.uuid(), product_name: z.string() });

/** The rule and product a member is measured on; null for any other finding. */
function productOf(member: MemberFacts) {
  if (!isProductMetricRule(member.rule_id)) return null;
  const parsed = productEvidence.safeParse(member.evidence);
  return parsed.success ? { rule: productMetricRule(member.rule_id), ...parsed.data } : null;
}

/** The check's executions: every engine and prompt over its window, within `bounds`. */
const checkWindow = (check: Check, bounds: { after?: Date; until: Date }): ExecutionScope => ({
  windowDays: check.window_days,
  engine: null,
  promptSet: null,
  ...bounds,
});

/** The check's metric over one window of executions. */
async function reading(
  db: Database,
  scope: Scope,
  check: Check,
  window: ExecutionScope,
  owned: readonly string[],
): Promise<{ reading: MetricReading; executions: number } | null> {
  const found = await productRow(db, scope, window, check.product_id);
  if (!found) return null;
  return {
    reading: readMetric(check, found.row, found.executions, owned),
    executions: found.executions,
  };
}

export const productMetricCheck: CheckModule<'product_metric'> = {
  kind: 'product_metric',
  leg: policy.opportunity.actions.LEG_VISIBILITY_RUN,
  sources: ['audit'],
  measurable: (member) => productOf(member) !== null,
  /** The rule's target, and the reading over the window that ended at go-live. */
  async freeze(members, { db, scope, declaredAt }) {
    const owned = await ownedHosts(db, scope);
    const checks: MemberCheck[] = [];
    for (const member of members) {
      const product = productOf(member);
      if (!product) continue;
      const check: Check = {
        kind: 'product_metric',
        product_id: product.product_id,
        product_name: product.product_name,
        ...product.rule,
        window_days: m.WINDOW_DAYS,
      };
      const window = checkWindow(check, { until: new Date(declaredAt) });
      const before = await reading(db, scope, check, window, owned); // NOSONAR -- One transaction connection.
      if (before?.reading.state === 'measured') check.baseline_value = before.reading.value;
      checks.push({ member, check });
    }
    return checks;
  },
  async read(ctx, source, check) {
    const d = ctx.declaration;
    if (!policy.commerce.products.window_days.includes(check.window_days))
      return outcome(ctx.reading, 'unavailable', 'unsupported_window');
    const scope = { workspaceId: d.workspace_id, projectId: d.project_id };
    const owned = await once(ctx, 'owned_hosts', () => ownedHosts(ctx.db, scope));
    const window = checkWindow(check, {
      after: new Date(d.declared_implemented_at),
      until: new Date(source.observed_at),
    });
    const after = await reading(ctx.db, scope, check, window, owned);
    if (!after) return outcome(ctx.reading, 'unavailable', 'product_not_in_catalog');
    const read = after.reading;
    if (read.state === 'unknown') return outcome(ctx.reading, 'unavailable', read.reason);
    if (read.state === 'insufficient')
      return outcome(
        ctx.reading,
        'waiting',
        after.executions ? read.reason : 'no_answers_after_go_live',
      );
    const ids = await observationIds(ctx.db, scope, window, [check.product_id]);
    for (const id of ids.get(check.product_id) ?? []) ctx.result.metric_ids.add(id);
    return outcome(ctx.reading, clears(check, read.value) ? 'met' : 'unmet');
  },
  subject: (check) => check.product_name,
};
