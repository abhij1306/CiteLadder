import { sql } from 'kysely';
import { policy } from '../../config.ts';
import { record } from '../../db/json.ts';
import { parseUuid } from '../../http/uuid.ts';
import { scalarText } from '../../text-order.ts';
import { compareMetric, outcome, promptScore } from '../verification-decisions.ts';
import type { CheckModule, CheckOf, FreezeContext, MemberCheck, MemberFacts } from './kind.ts';
import { once } from './read-context.ts';

const o = policy.opportunity.opportunities;

function promptsOf(member: MemberFacts): string[] {
  if (member.target_prompt_id !== null) return [member.target_prompt_id];
  const prompts = record(record(member.evidence).content_handoff).affected_prompts;
  if (!Array.isArray(prompts)) return [];
  return [...new Set(prompts.map((item) => scalarText(record(item).prompt_id)).filter(Boolean))];
}

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
    const frozen = new Map<string, CheckOf<'visibility_metric'>>();
    const checks: MemberCheck[] = [];
    for (const member of members)
      for (const promptId of promptsOf(member)) {
        let check = frozen.get(promptId);
        if (!check) {
          check = await promptCheck(context, promptId); // NOSONAR
          frozen.set(promptId, check);
        }
        checks.push({ member, check });
      }
    return checks;
  },
  async read(ctx, source, check) {
    const d = ctx.declaration;
    const prompt = parseUuid(check.target_prompt_id);
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
