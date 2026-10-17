import { sql, type Selectable } from 'kysely';
import { comparisonHash, frozenComparisonKey } from '../analysis/comparison.ts';
import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { utcText } from '../db/timestamps.ts';
import { WorkspaceScope } from '../db/workspace-scope.ts';
import type {
  Audits,
  OpportunityImplementationEvents,
  OpportunitySnapshots,
} from '../generated/db-schema.ts';
import { record } from '../db/json.ts';
import {
  gapChanges,
  leg,
  valueState,
  visibilityMeasurementLeg,
  referralMeasurementLeg,
} from './verification-decisions.ts';
export type Declaration = Omit<
  Selectable<OpportunityImplementationEvents>,
  'created_at' | 'declared_implemented_at'
> & { created_at: string; declared_implemented_at: string };
type Context = { db: Database; scope: WorkspaceScope; declaration: Declaration };
const limitLeg = (state: string, limitation: string) => leg(state, { limitations: [limitation] });
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : []);
const operand = (text: string) => sql<Date>`${text}::timestamptz`;
function auditIdentity(
  audit: Pick<Selectable<Audits>, 'id' | 'configuration' | 'benchmark_mode' | 'repetitions'>,
  prompts: unknown[][],
  engines: unknown[][],
): string {
  const config = record(audit.configuration);
  return comparisonHash({
    frozen_context: frozenComparisonKey(config) || audit.id,
    prompts,
    engines,
    benchmark_mode: audit.benchmark_mode,
    repetitions: audit.repetitions,
    locale: config.locale
      ? config.locale
      : {
          country_code: config.country_code ?? null,
          language_code: config.language_code ?? null,
        },
    retrieval: config.retrieval_policy ?? null,
  });
}
async function identity(ctx: Context, audit: Selectable<Audits>): Promise<string> {
  const prompts = await ctx.scope
    .selectFrom(ctx.db, 'audits')
    .innerJoin('audit_prompt_snapshots', 'audit_prompt_snapshots.audit_id', 'audits.id')
    .select(['text', 'cohort', 'buyer_stage', 'prompt_intent', 'intent'])
    .where('audits.id', '=', audit.id)
    .orderBy('prompt_index')
    .execute();
  const engines = await ctx.scope
    .selectFrom(ctx.db, 'audits')
    .innerJoin('audit_engine_snapshots', 'audit_engine_snapshots.audit_id', 'audits.id')
    .select(['logical_engine', 'transport_provider', 'transport_model'])
    .where('audits.id', '=', audit.id)
    .orderBy('logical_engine')
    .execute();
  return auditIdentity(
    audit,
    prompts.map((p) => [p.text, p.cohort, p.buyer_stage, p.prompt_intent, p.intent]),
    engines.map((e) => [e.logical_engine, e.transport_provider, e.transport_model]),
  );
}
async function visibilityLeg(
  ctx: Context,
  baseline: Selectable<OpportunitySnapshots>,
  postId: string | null,
) {
  if (!baseline.audit_id || !postId)
    return limitLeg('not_run', 'A comparable post-action audit has not run.');
  const beforeAudit = await ctx.scope
    .selectFrom(ctx.db, 'audits')
    .selectAll()
    .where('id', '=', baseline.audit_id)
    .executeTakeFirst();
  const afterAudit = await ctx.scope
    .selectFrom(ctx.db, 'audits')
    .selectAll()
    .where('id', '=', postId)
    .executeTakeFirst();
  if (!beforeAudit || !afterAudit)
    return limitLeg('unavailable', 'Audit provenance is unavailable.');
  if ((await identity(ctx, beforeAudit)) !== (await identity(ctx, afterAudit)))
    return leg('non_comparable', {
      baselineId: beforeAudit.id,
      postId: afterAudit.id,
      limitations: ['Prompt, engine, model/retrieval, locale, or repetition identity changed.'],
    });
  const before = await ctx.scope
    .selectFrom(ctx.db, 'metric_snapshots')
    .selectAll()
    .where('audit_id', '=', beforeAudit.id)
    .executeTakeFirst();
  const after = await ctx.scope
    .selectFrom(ctx.db, 'metric_snapshots')
    .selectAll()
    .where('audit_id', '=', afterAudit.id)
    .executeTakeFirst();
  return visibilityMeasurementLeg(before ?? null, after ?? null);
}
function referralSnapshot(ctx: Context, after: boolean) {
  return ctx.scope
    .selectFrom(ctx.db, 'ai_referrals_snapshots')
    .selectAll()
    .select([
      utcText(sql.ref('window_start')).as('start_text'),
      utcText(sql.ref('window_end')).as('end_text'),
    ])
    .where('project_id', '=', ctx.declaration.project_id)
    .where('created_at', after ? '>' : '<=', operand(ctx.declaration.declared_implemented_at))
    .orderBy('created_at', 'desc')
    .limit(1)
    .executeTakeFirst();
}
async function referralLeg(ctx: Context) {
  const before = await referralSnapshot(ctx, false);
  const after = await referralSnapshot(ctx, true);
  const measurement = (row: typeof before) =>
    row ? { ...row, start_text: row.start_text!, end_text: row.end_text! } : null;
  return referralMeasurementLeg(measurement(before), measurement(after));
}
async function brandedValue(ctx: Context, id: string) {
  const rows = await ctx.scope
    .selectFrom(ctx.db, 'demand_signals')
    .selectAll()
    .where('snapshot_id', '=', id)
    .where('signal_type', '=', policy.demand.DEMAND_SIGNAL_BRANDED_QUERY)
    .execute();
  return {
    value: rows.reduce((total, row) => total + Number(record(row.metrics).impressions || 0), 0),
    ids: rows.map((row) => row.id),
    versions: rows[0]
      ? { analyzer: rows[0].analyzer_version, formula: rows[0].formula_version }
      : {},
  };
}
async function demandLeg(ctx: Context, baseline: Selectable<OpportunitySnapshots>) {
  if (!baseline.demand_snapshot_id)
    return limitLeg('unavailable', 'No branded-demand baseline was frozen.');
  const after = await ctx.scope
    .selectFrom(ctx.db, 'demand_snapshots')
    .selectAll()
    .where('project_id', '=', ctx.declaration.project_id)
    .where('created_at', '>', operand(ctx.declaration.declared_implemented_at))
    .orderBy('created_at', 'desc')
    .limit(1)
    .executeTakeFirst();
  if (!after)
    return leg('not_run', {
      baselineId: baseline.demand_snapshot_id,
      limitations: ['No post-action demand snapshot.'],
    });
  const before = await ctx.scope
    .selectFrom(ctx.db, 'demand_snapshots')
    .selectAll()
    .where('id', '=', baseline.demand_snapshot_id)
    .executeTakeFirst();
  if (!before) return limitLeg('unavailable', 'Frozen demand baseline is unavailable.');
  const a = await brandedValue(ctx, before.id);
  const b = await brandedValue(ctx, after.id);
  const result = leg(valueState(b.value), {
    baselineId: before.id,
    postId: after.id,
    baseline: a.value,
    post: b.value,
    versions: b.versions,
  });
  result.baseline_source_ids.push(...a.ids);
  result.post_source_ids.push(...b.ids);
  return result;
}
export async function buildVerificationResult(
  db: Database,
  declaration: Declaration,
  postAuditId: string | null,
) {
  const ctx = { db, declaration, scope: new WorkspaceScope(declaration.workspace_id) };
  const baseline = await ctx.scope
    .selectFrom(db, 'opportunity_snapshots')
    .selectAll()
    .where('id', '=', declaration.opportunity_snapshot_id)
    .executeTakeFirst();
  if (!baseline)
    return {
      state: 'unavailable',
      legs: {},
      limitations: ['Frozen Opportunity snapshot is unavailable.'],
    };
  const latest = await ctx.scope
    .selectFrom(db, 'opportunity_snapshots')
    .selectAll()
    .select(utcText(sql.ref('created_at')).as('created_text'))
    .where('project_id', '=', declaration.project_id)
    .where('created_at', '>', operand(declaration.declared_implemented_at))
    .orderBy('created_at', 'desc')
    .limit(1)
    .executeTakeFirst();
  const overlaps = await ctx.scope
    .selectFrom(db, 'opportunity_implementation_events')
    .select('id')
    .where('project_id', '=', declaration.project_id)
    .where('id', '!=', declaration.id)
    .where('declared_implemented_at', '>=', operand(declaration.declared_implemented_at))
    .where(
      'declared_implemented_at',
      '<=',
      operand(
        latest?.created_text ? `${latest.created_text}Z` : declaration.declared_implemented_at,
      ),
    )
    .execute();
  return {
    state: 'available',
    legs: {
      visibility: await visibilityLeg(ctx, baseline, postAuditId),
      ai_referral_traffic: await referralLeg(ctx),
      branded_search_demand: await demandLeg(ctx, baseline),
    },
    gap_changes: gapChanges(
      strings(record(baseline.source_mix).gap_keys),
      strings(record(latest?.source_mix).gap_keys),
      !!latest,
    ),
    overlapping_action_ids: overlaps.map((row) => row.id),
    causality_notice:
      'Later observations are not proof that this implementation caused the change.',
  };
}
