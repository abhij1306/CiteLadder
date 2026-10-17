/** The declaration and bounded observation history, with persisted measurement legs. */
import { sql, type Selectable } from 'kysely';
import type { Database } from '../db/database.ts';
import type { OpportunityImplementationEvents } from '../generated/db-schema.ts';
import { policy } from '../config.ts';
import { wireUtc, utcTextOf } from '../db/timestamps.ts';
import { record, strings } from '../db/json.ts';
import { measurementLegs } from './measurement-legs.ts';
import { declarationCheckSchema, measurementLegSchema } from '@citeladder/contracts/actions';
import { expectedCheckSchema } from '@citeladder/contracts/opportunities';
import { z } from 'zod';
import { checkWindowDays, storedOutcomes } from './verification-decisions.ts';
import { scalarText } from '../text-order.ts';
import { ruleTitle } from '../site-health/reads/rules.ts';

const observationKind = z.enum(['observed', 'verified', 'contradicted']);
const o = policy.opportunity.opportunities;
const legOf: Record<string, string> = policy.opportunity.actions.CHECK_KIND_MEASUREMENT_LEG;

/**
 * What a check names, for a reader: its rule, prompt text, page or query, link
 * or publisher page. A prompt deleted since names nothing.
 */
function subject(check: Record<string, unknown>, prompts: ReadonlyMap<string, string>) {
  const text = (value: unknown) => scalarText(value) || null;
  if (check.kind === 'site_rule') return ruleTitle(scalarText(check.rule_id));
  if (check.kind === 'visibility_metric')
    return prompts.get(scalarText(check.target_prompt_id)) ?? null;
  if (check.kind === 'traffic_metric') return text(check.scope_key);
  if (check.kind === 'keyword_presence') return text(check.keyword);
  return text(check.target_url);
}

/** The project's tracked prompts that visibility checks measure, by id. */
async function checkPrompts(
  db: Database,
  row: Selectable<OpportunityImplementationEvents>,
  checks: Record<string, unknown>[],
): Promise<Map<string, string>> {
  const ids = [
    ...new Set(
      checks.flatMap((check) =>
        check.kind === 'visibility_metric' && scalarText(check.target_prompt_id)
          ? [scalarText(check.target_prompt_id)]
          : [],
      ),
    ),
  ];
  if (!ids.length) return new Map();
  const prompts = await db
    .selectFrom('prompts')
    .innerJoin('prompt_sets', 'prompt_sets.id', 'prompts.prompt_set_id')
    .select(['prompts.id', 'prompts.text'])
    .where('prompt_sets.project_id', '=', row.project_id)
    .where('prompts.id', 'in', ids)
    .execute();
  return new Map(prompts.map((prompt) => [prompt.id, prompt.text]));
}

/** Each expected check with the state the latest observation folded for it. */
function checkStates(
  checks: Record<string, unknown>[],
  result: unknown,
  prompts: ReadonlyMap<string, string>,
) {
  const outcomes = storedOutcomes(result);
  return checks.map((check, index) => {
    const promptId =
      check.kind === 'visibility_metric' ? scalarText(check.target_prompt_id) || null : null;
    const found = outcomes.get(index);
    return {
      index,
      kind: String(check.kind),
      leg: legOf[String(check.kind)],
      state: found?.state ?? ('waiting' as const),
      reason: found?.reason ?? null,
      observed_at: found?.observed_at ?? null,
      source_kind: found?.source_kind ?? null,
      source_id: found?.source_id ?? null,
      subject: subject(check, prompts),
      prompt_id: promptId && prompts.has(promptId) ? promptId : null,
    };
  });
}

export async function declarationView(
  db: Database,
  row: Selectable<OpportunityImplementationEvents>,
) {
  const observations = await db
    .selectFrom('opportunity_verification_events')
    .selectAll()
    .where('workspace_id', '=', row.workspace_id)
    .where('project_id', '=', row.project_id)
    .where('implementation_event_id', '=', row.id)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(policy.opportunity.opportunities.IMPLEMENTATION_VERIFICATION_HISTORY_MAX)
    .execute();
  observations.reverse();
  const latest = observations.at(-1);
  const timestamp = await db
    .selectFrom('opportunity_implementation_events')
    .select(utcTextOf(sql.ref('declared_implemented_at')).as('at'))
    .where('workspace_id', '=', row.workspace_id)
    .where('id', '=', row.id)
    .executeTakeFirstOrThrow();
  const checks = z.array(expectedCheckSchema).parse(row.expected_checks ?? []);
  const measuredUntil = new Date(row.declared_implemented_at);
  measuredUntil.setUTCDate(
    measuredUntil.getUTCDate() +
      Math.max(o.VERIFICATION_WINDOW_DAYS, ...checks.map((check) => checkWindowDays(check.kind))),
  );
  return {
    id: row.id,
    action_id: row.action_id,
    output_revision_id: row.output_revision_id,
    member_opportunity_ids: strings(row.member_opportunity_ids),
    opportunity_snapshot_id: row.opportunity_snapshot_id,
    target_site_url_ids: strings(row.target_site_url_ids),
    target_external_url: row.target_external_url,
    declared_implemented_at: wireUtc(timestamp.at),
    expected_checks: checks,
    state: latest ? observationKind.parse(latest.observation_kind) : ('declared' as const),
    limitations: strings(latest?.limitations),
    verification_events: observations.map((item) => ({
      id: item.id,
      observation_kind: observationKind.parse(item.observation_kind),
      observed_at: item.observed_at.toISOString(),
      crawl_id: item.crawl_id,
      audit_id: item.audit_id,
      source_analysis_ids: strings(item.source_analysis_ids),
      source_rule_evaluation_ids: strings(item.source_rule_evaluation_ids),
      source_metric_ids: strings(item.source_metric_ids),
      result: record(item.result),
      verifier_version: item.verifier_version,
      limitations: strings(item.limitations),
      created_at: item.created_at.toISOString(),
    })),
    legs: (await measurementLegs(db, row, observations)).map((leg) =>
      measurementLegSchema.parse({
        ...leg,
        due_at: leg.due_at?.toISOString() ?? null,
        last_evidence_at: leg.last_evidence_at?.toISOString() ?? null,
      }),
    ),
    checks: z
      .array(declarationCheckSchema)
      .parse(checkStates(checks, latest?.result, await checkPrompts(db, row, checks))),
    measured_until: measuredUntil.toISOString(),
    created_at: row.created_at.toISOString(),
  };
}
