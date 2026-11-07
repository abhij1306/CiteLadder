/**
 * A tracked prompt's score rises in a later visibility run. Members with no
 * prompt get no check: the project-wide score moves for reasons the Action
 * never touched, so it cannot verify one.
 */
import { sql } from 'kysely';
import { policy } from '../../config.ts';
import { record } from '../../db/json.ts';
import { parseUuid } from '../../http/uuid.ts';
import { scalarText } from '../../text-order.ts';
import { compareMetric, outcome, promptScore } from '../verification-decisions.ts';
import type { CheckModule, CheckOf, FreezeContext, MemberCheck, MemberFacts } from './kind.ts';
import { once } from './read-context.ts';

const o = policy.opportunity.opportunities;

/**
 * The prompts a member is measured on: its own, or for an earned listing,
 * which has no reading of its own, every tracked prompt whose answers cited
 * the page.
 */
function promptsOf(member: MemberFacts): string[] {
  if (member.target_prompt_id !== null) return [member.target_prompt_id];
  const prompts = record(record(member.evidence).content_handoff).affected_prompts;
  if (!Array.isArray(prompts)) return [];
  return [...new Set(prompts.map((item) => scalarText(record(item).prompt_id)).filter(Boolean))];
}

/** A prompt's score, frozen from the snapshot's audit. */
async function promptCheck(
  { db, scope, auditId }: FreezeContext,
  promptId: string,
): Promise<CheckOf<'visibility_metric'>> {
  const check: CheckOf<'visibility_metric'> = {
    kind: 'visibility_metric',
    metric: o.VISIBILITY_METRIC_PROMPT_SCORE,
    direction: 'increase',
    min_delta: o.VISIBILITY_CHECK_MIN_DELTA,
    tolerance: 0,
    target_prompt_id: promptId,
  };
  if (!auditId) return check;
  const baseline = await db
    .selectFrom('metric_snapshots as metric')
    .innerJoin('audit_prompt_snapshots as prompt', 'prompt.audit_id', 'metric.audit_id')
    .select(['metric.id', 'metric.metrics', 'prompt.prompt_index'])
    .where('metric.workspace_id', '=', scope.workspaceId)
    .where('metric.project_id', '=', scope.projectId)
    .where('metric.audit_id', '=', auditId)
    .where('prompt.prompt_id', '=', promptId)
    .executeTakeFirst();
  const value = baseline ? promptScore(baseline.metrics, baseline.prompt_index) : null;
  if (baseline && value !== null) {
    check.baseline_metric_snapshot_id = baseline.id;
    check.baseline_value = value;
  }
  return check;
}

export const visibilityMetricCheck: CheckModule<'visibility_metric'> = {
  kind: 'visibility_metric',
  leg: policy.opportunity.actions.LEG_VISIBILITY_RUN,
  sources: ['audit'],
  measurable: (member) => promptsOf(member).length > 0,
  async freeze(members, context) {
    // One baseline read per prompt, however many members name it.
    const frozen = new Map<string, CheckOf<'visibility_metric'>>();
    const checks: MemberCheck[] = [];
    for (const member of members)
      for (const promptId of promptsOf(member)) {
        let check = frozen.get(promptId);
        if (!check) {
          check = await promptCheck(context, promptId); // NOSONAR -- One transaction connection.
          frozen.set(promptId, check);
        }
        checks.push({ member, check });
      }
    return checks;
  },
  /** A prompt's score in this audit against the score frozen at declaration. */
  async read(ctx, source, check) {
    const d = ctx.declaration;
    const prompt = parseUuid(check.target_prompt_id);
    // Checks declared against the project-wide score measured nothing the
    // Action changed; they stay unmeasurable rather than verify by drift.
    if (!prompt) return outcome(ctx.reading, 'unavailable', 'not_prompt_scoped');
    const snapshot = await once(ctx, 'metric_snapshot', () =>
      ctx.scope
        .selectFrom(ctx.db, 'metric_snapshots')
        .select(['id', 'metrics'])
        .where('project_id', '=', d.project_id)
        .where('audit_id', '=', source.id)
        .where('created_at', '>', sql<Date>`${d.declared_implemented_at}::timestamptz`)
        .executeTakeFirst(),
    );
    if (!snapshot) return outcome(ctx.reading, 'unavailable', 'no_metric_snapshot');
    const row = await ctx.scope
      .selectFrom(ctx.db, 'audits')
      .innerJoin('audit_prompt_snapshots', 'audit_prompt_snapshots.audit_id', 'audits.id')
      .select('prompt_index')
      .where('audits.id', '=', source.id)
      .where('prompt_id', '=', prompt)
      .executeTakeFirst();
    if (!row) return outcome(ctx.reading, 'unavailable', 'prompt_not_in_run');
    ctx.result.metric_ids.add(snapshot.id);
    return compareMetric(
      check,
      check.baseline_value,
      promptScore(snapshot.metrics, row.prompt_index),
      ctx.reading,
      'prompt_score_unavailable',
    );
  },
  subject: (check, prompts) => prompts.get(check.target_prompt_id ?? '') ?? null,
};
