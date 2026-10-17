/** Freeze server-owned expectations from the live findings and their snapshot. */
import { sql } from 'kysely';
import { round } from '../demand/projection.ts';
import type { Database } from '../db/database.ts';
import { WorkspaceScope } from '../db/workspace-scope.ts';
import { policy } from '../config.ts';
import { record } from '../db/json.ts';
import { scalarText } from '../text-order.ts';
import type { OpportunityRow } from './projection.ts';
import type { Scope } from './sources.ts';
import { internalLinkDeclarationChecks } from './internal-link-declaration.ts';
import { promptScore } from './verification-decisions.ts';
import { scopedDailyRate, windowDays } from './traffic-scope.ts';
import {
  keywordGapEvidenceSchema,
  type KeywordPresenceCheck,
} from '@citeladder/contracts/opportunities';

const o = policy.opportunity.opportunities;
type ExpectedCheck = Record<string, unknown>;
export type MemberCheck = { check: ExpectedCheck; member: OpportunityRow };

/** The tracked prompts an earned brief says cited the page. */
function earnedPromptIds(member: OpportunityRow): string[] {
  const prompts = record(record(member.evidence).content_handoff).affected_prompts;
  if (!Array.isArray(prompts)) return [];
  return [...new Set(prompts.map((item) => scalarText(record(item).prompt_id)).filter(Boolean))];
}

/**
 * A prompt's score, frozen from the snapshot's audit. Members with no prompt
 * get no visibility check: the project-wide score moves for reasons the
 * Action never touched, so it cannot verify one.
 */
async function visibilityCheck(
  db: Database,
  scope: Scope,
  promptId: string,
  auditId: string | null,
): Promise<ExpectedCheck> {
  const check: ExpectedCheck = {
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

/**
 * Search Console clicks on the member's query or page, with the baseline
 * frozen from the latest daily window that ended before the declaration day.
 */
async function trafficCheck(
  db: Database,
  scope: Scope,
  member: OpportunityRow,
  declaredDay: string,
): Promise<ExpectedCheck | null> {
  const [kind, key] = member.target_theme
    ? (['query', member.target_theme] as const)
    : (['page', member.target_url] as const);
  if (!key) return null;
  const check: ExpectedCheck = {
    kind: 'traffic_metric',
    metric: o.TRAFFIC_METRIC_CLICKS,
    direction: 'increase',
    scope: kind,
    scope_key: key,
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
    scope: kind,
    key,
    metric: o.TRAFFIC_METRIC_CLICKS,
  });
  if (rate !== null) check.baseline_value = round(rate, 4);
  return check;
}

const legs = policy.opportunity.actions;
const KEYWORD_GAP_RULE = o.SEARCH_GAP.RULE_ID;

/**
 * A keyword gap is measured by appearing for the search, not by clicks: a
 * query with no Search Console row has no baseline to compare a rate with.
 */
function keywordCheck(member: OpportunityRow): KeywordPresenceCheck | null {
  // Evidence that does not parse cannot name the search or site to check: no check.
  const parsed = keywordGapEvidenceSchema.safeParse(member.evidence);
  if (!parsed.success) return null;
  const { keyword, query_key, owned_origin, market } = parsed.data;
  return { kind: 'keyword_presence', keyword, query_key, owned_origin, ...market };
}

/**
 * The reading that would measure a member once declared, or null when nothing
 * can: the same branching `memberCheck` freezes, without its baselines.
 */
export function memberMeasurementLeg(
  member: Pick<
    OpportunityRow,
    'rule_id' | 'opportunity_type' | 'target_prompt_id' | 'target_theme' | 'target_url'
  >,
): string | null {
  if (o.EARNED_RULE_IDS.includes(member.rule_id)) return legs.LEG_VISIBILITY_RUN;
  if (member.rule_id === KEYWORD_GAP_RULE) return legs.CHECK_KIND_MEASUREMENT_LEG.keyword_presence;
  if (member.opportunity_type === o.OPPORTUNITY_TYPE_SITE) return legs.LEG_CRAWL;
  if (member.opportunity_type === o.OPPORTUNITY_TYPE_TRAFFIC)
    return member.target_theme || member.target_url ? legs.LEG_SEARCH_CONSOLE_WINDOW : null;
  return member.target_prompt_id === null ? null : legs.LEG_VISIBILITY_RUN;
}

type CheckContext = {
  auditId: string | null;
  declaredDay: string;
  /** One baseline read per prompt, however many members name it. */
  prompts: Map<string, Promise<ExpectedCheck>>;
};

function promptCheck(db: Database, scope: Scope, promptId: string, context: CheckContext) {
  let check = context.prompts.get(promptId);
  if (!check) {
    check = visibilityCheck(db, scope, promptId, context.auditId);
    context.prompts.set(promptId, check);
  }
  return check;
}

/**
 * The checks one member freezes. An earned listing has no reading of its own:
 * it is measured on every tracked prompt whose answers cited the page.
 */
async function memberChecks(
  db: Database,
  scope: Scope,
  member: OpportunityRow,
  context: CheckContext,
): Promise<ExpectedCheck[]> {
  if (o.EARNED_RULE_IDS.includes(member.rule_id)) {
    const checks = [];
    for (const promptId of earnedPromptIds(member))
      checks.push(await promptCheck(db, scope, promptId, context)); // NOSONAR -- One transaction connection.
    return checks;
  }
  if (member.rule_id === KEYWORD_GAP_RULE) {
    const check = keywordCheck(member);
    return check ? [check] : [];
  }
  const evidence = record(member.evidence);
  if (member.opportunity_type === o.OPPORTUNITY_TYPE_SITE) {
    const siteUrlId = scalarText(evidence.site_url_id);
    return [
      {
        kind: 'site_rule',
        rule_id: scalarText(evidence.issue_rule_id) || member.rule_id,
        expected_outcome: 'pass',
        ...(siteUrlId ? { target_site_url_id: siteUrlId } : {}),
      },
    ];
  }
  if (member.opportunity_type === o.OPPORTUNITY_TYPE_TRAFFIC) {
    const check = await trafficCheck(db, scope, member, context.declaredDay);
    return check ? [check] : [];
  }
  return member.target_prompt_id === null
    ? []
    : [await promptCheck(db, scope, member.target_prompt_id, context)];
}

/**
 * The checks a declaration freezes, one per distinct expectation. A member
 * nothing can measure contributes none; the Action still records the work.
 */
export async function declarationChecks(
  db: Database,
  scope: Scope,
  members: OpportunityRow[],
  context: { auditId: string | null; declaredDay: string },
  recommendationIds: string[] = [],
): Promise<MemberCheck[]> {
  // Contextual links are declared per selected link; the page's other
  // findings keep their own checks in the same declaration.
  const contextual = members.filter((member) => member.rule_id === 'site_contextual_links');
  const checks = new Map<string, MemberCheck>();
  const shared: CheckContext = { ...context, prompts: new Map() };
  for (const member of members) {
    if (member.rule_id === 'site_contextual_links') continue;
    const found = await memberChecks(db, scope, member, shared); // NOSONAR -- One transaction connection.
    for (const check of found) {
      const key = JSON.stringify(check);
      if (!checks.has(key)) checks.set(key, { check, member });
    }
  }
  const links =
    contextual.length || recommendationIds.length
      ? await internalLinkDeclarationChecks(db, scope, contextual, recommendationIds)
      : [];
  return [...checks.values(), ...links];
}
