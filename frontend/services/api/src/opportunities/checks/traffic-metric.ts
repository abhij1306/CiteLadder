/**
 * Search Console clicks per day on the member's query or page rise against
 * the latest daily window that ended before the declaration day. Sync
 * windows differ in length, so windows compare as daily rates.
 */
import { sql } from 'kysely';
import { policy } from '../../config.ts';
import { WorkspaceScope } from '../../db/workspace-scope.ts';
import { roundScaled } from '../../numbers.ts';
import type { OpportunityRow } from '../projection.ts';
import { scopedDailyRate, windowDays } from '../traffic-scope.ts';
import { compareMetric, outcome } from '../verification-decisions.ts';
import type { CheckModule, CheckOf, FreezeContext, MemberFacts } from './kind.ts';
import { dayOf, once } from './read-context.ts';

const o = policy.opportunity.opportunities;

/** The query a member names, else its page; null when it names neither. */
function scopeOf(member: MemberFacts): { scope: 'page' | 'query'; key: string } | null {
  if (member.target_theme) return { scope: 'query', key: member.target_theme };
  if (member.target_url) return { scope: 'page', key: member.target_url };
  return null;
}

async function freezeOne(
  { db, scope, declaredDay }: FreezeContext,
  member: OpportunityRow,
): Promise<CheckOf<'traffic_metric'> | null> {
  const target = scopeOf(member);
  if (!target) return null;
  const check: CheckOf<'traffic_metric'> = {
    kind: 'traffic_metric',
    metric: o.TRAFFIC_METRIC_CLICKS,
    direction: 'increase',
    scope: target.scope,
    scope_key: target.key,
    min_delta: o.TRAFFIC_CHECK_MIN_DAILY_GAIN,
    tolerance: 0,
  };
  const snapshot = await new WorkspaceScope(scope.workspaceId)
    .selectFrom(db, 'traffic_snapshots')
    .select(['id', windowDays.as('days')])
    .where('project_id', '=', scope.projectId)
    .where('granularity', '=', policy.traffic.TRAFFIC_DEFAULT_GRANULARITY)
    .where(sql<boolean>`window_end::date < ${declaredDay}::date`)
    .orderBy('window_end', 'desc')
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(1)
    .executeTakeFirst();
  if (!snapshot) return check;
  check.baseline_traffic_snapshot_id = snapshot.id;
  check.baseline_window_days = Number(snapshot.days);
  const { rate } = await scopedDailyRate(db, scope, snapshot, {
    scope: target.scope,
    key: target.key,
    metric: o.TRAFFIC_METRIC_CLICKS,
  });
  if (rate !== null) check.baseline_value = roundScaled(rate, 4);
  return check;
}

export const trafficMetricCheck: CheckModule<'traffic_metric'> = {
  kind: 'traffic_metric',
  leg: policy.opportunity.actions.LEG_SEARCH_CONSOLE_WINDOW,
  sources: ['traffic_snapshot'],
  measurable: (member) => scopeOf(member) !== null,
  async freeze(members, context) {
    const checks = [];
    for (const member of members) {
      const check = await freezeOne(context, member); // NOSONAR -- One transaction connection.
      if (check) checks.push({ member, check });
    }
    return checks;
  },
  /**
   * Clicks per day in a window that starts after the go-live day (that day is
   * partly before the change, and its UTC date can differ from the user's).
   */
  async read(ctx, source, check) {
    const d = ctx.declaration;
    const { scope, scope_key: key } = check;
    // Rows declared before scoping carry only a project total.
    if (!scope || !key) return outcome(ctx.reading, 'unavailable', 'not_page_scoped');
    const snapshot = await once(ctx, 'traffic_snapshot', () =>
      ctx.scope
        .selectFrom(ctx.db, 'traffic_snapshots')
        .select(['id', sql<string>`window_start::date::text`.as('start'), windowDays.as('days')])
        .where('project_id', '=', d.project_id)
        .where('id', '=', source.id)
        .executeTakeFirst(),
    );
    if (!snapshot) return outcome(ctx.reading, 'unavailable', 'no_traffic_snapshot');
    if (snapshot.start <= dayOf(d.declared_implemented_at))
      return outcome(ctx.reading, 'unavailable', 'window_overlaps_declaration');
    const { rowId, rate } = await scopedDailyRate(
      ctx.db,
      { workspaceId: d.workspace_id, projectId: d.project_id },
      snapshot,
      { scope, key, metric: check.metric },
    );
    if (rowId) ctx.result.metric_ids.add(rowId);
    return compareMetric(check, check.baseline_value, rate, ctx.reading, 'no_search_console_row');
  },
  subject: (check) => check.scope_key || null,
};
