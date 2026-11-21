import { randomUUID } from 'node:crypto';

import {
  parseContentGapEvidence,
  siteIssueFamilyEvidenceSchema,
} from '@citeladder/contracts/opportunity-evidence';
import type { ActionGrouping } from '@citeladder/contracts/actions';
import { sourceClassSchema } from '@citeladder/contracts/opportunities';
import { sql } from 'kysely';

import { policy } from '../config.ts';
import { ruleSection } from '../site-health/reads/rules.ts';
import {
  groupMembers,
  type ActionMember,
  type HandoffFacts,
} from '../analysis/opportunities/actions.ts';
import type { Database } from '../db/database.ts';
import { record, strings } from '../db/json.ts';
import type { NewOpportunity } from './refresh-compute.ts';
import type { TargetRef } from '../analysis/opportunities/targets.ts';
import { memberMeasurementLeg } from './checks/registry.ts';
import { writeActionUrls, type ActionUrlSource } from './action-urls.ts';
import type { Scope } from './sources.ts';

const a = policy.opportunity.actions;

type NewMember = NewOpportunity & { target: TargetRef };

export function actionMember(row: NewMember): ActionMember {
  const evidence = record(row.evidence);
  const prompt = evidence.prompt_text || evidence.prompt;
  return {
    opportunity_id: row.id,
    rule_id: row.rule_id,
    target: row.target,
    label_hint: typeof prompt === 'string' ? prompt : null,
    measured_by: memberMeasurementLeg(row),
    title: row.title || row.rule_id,
    priority_score: row.priority_score || 0,
    source_analysis_ids: [...(row.source_analysis_ids ?? [])],
    source_issue_ids: [...(row.source_issue_ids ?? [])],
    source_metric_ids: [...(row.source_metric_ids ?? [])],
    facts: handoffFacts(row.rule_id, evidence),
    ...issueFamilyCohort(row.rule_id, evidence),
    grouping: memberGrouping(row.rule_id, evidence),
  };
}

function issueFamilyCohort(rule: string, evidence: Record<string, unknown>) {
  if (rule !== policy.opportunity.opportunities.SITE_ISSUE_FAMILY.RULE_ID) return {};
  return { cohort: siteIssueFamilyEvidenceSchema.parse(evidence).cohort };
}

function memberGrouping(rule: string, evidence: Record<string, unknown>): ActionGrouping {
  const source = a.RULE_GROUPING[rule];
  switch (source?.kind) {
    case 'fixed':
      return source.grouping;
    case 'issue_section': {
      const ruleId = siteIssueFamilyEvidenceSchema.parse(evidence).issue_rule_id;
      return a.ISSUE_SECTION_GROUPING[ruleSection(ruleId) ?? 'technical'];
    }
    case 'source_class': {
      const sourceClass = sourceClassSchema.safeParse(
        record(evidence.content_handoff).source_class,
      );
      return (
        (sourceClass.success ? a.SOURCE_CLASS_GROUPING[sourceClass.data] : undefined) ??
        a.SOURCE_CLASS_GROUPING_DEFAULT
      );
    }
    case undefined:
      return a.ACTION_GROUPING_FALLBACK;
    default: {
      const unknown: never = source;
      return unknown;
    }
  }
}

function handoffFacts(rule: string, evidence: Record<string, unknown>): HandoffFacts {
  return {
    competitors: strings(record(evidence.content_handoff).observed_competitors).filter(Boolean),
    angle: parseContentGapEvidence(rule, evidence)?.evidence.angle_label ?? null,
  };
}

type Group = ReturnType<typeof groupMembers>[number];

const GROUP_COLUMN_TYPES = [
  ['target_label', 'varchar'],
  ['target_url', 'text'],
  ['target_prompt_id', 'uuid'],
  ['priority_score', 'float8'],
  ['families', 'jsonb'],
  ['approach', 'varchar'],
  ['skill_id', 'varchar'],
  ['diagnosis', 'jsonb'],
  ['member_opportunity_ids', 'jsonb'],
  ['last_member_opportunity_ids', 'jsonb'],
  ['opportunity_snapshot_id', 'uuid'],
  ['evidence_cleared_at', 'timestamptz'],
  ['cohort', 'jsonb'],
  ['goal', 'varchar'],
  ['goal_grouping', 'varchar'],
] as const;
type GroupColumn = (typeof GROUP_COLUMN_TYPES)[number][0];
const GROUP_COLUMNS = GROUP_COLUMN_TYPES.map(([column]) => column);

function groupFields(group: Group, snapshotId: string) {
  const members = JSON.stringify(group.members.map((member) => member.opportunity_id));
  return {
    target_label: group.target.label,
    target_url: group.target.url,
    target_prompt_id: group.target.prompt_id,
    priority_score: group.priority_score,
    families: JSON.stringify(group.families),
    approach: group.approach,
    skill_id: group.skill_id,
    diagnosis: JSON.stringify(group.diagnosis),
    member_opportunity_ids: members,
    last_member_opportunity_ids: members,
    opportunity_snapshot_id: snapshotId,
    evidence_cleared_at: null,
    cohort: group.cohort ? JSON.stringify(group.cohort) : null,
    goal: group.goal,
    goal_grouping: group.grouping,
  } satisfies Record<GroupColumn, unknown>;
}

// PostgreSQL binds at most 65,535 parameters per statement. Each row binds its
// id plus every group column; the statement adds updated_at and workspace_id.
const MAX_BIND_PARAMETERS = 65_535;
const UPDATE_BATCH_ROWS = Math.floor((MAX_BIND_PARAMETERS - 2) / (GROUP_COLUMNS.length + 1));
const INSERT_BATCH = Math.floor(MAX_BIND_PARAMETERS / (GROUP_COLUMNS.length + 10));

async function updateActions(
  trx: Database,
  scope: Scope,
  updates: { id: string; fields: ReturnType<typeof groupFields> }[],
  now: Date,
) {
  for (let start = 0; start < updates.length; start += UPDATE_BATCH_ROWS) {
    await updateActionBatch(trx, scope, updates.slice(start, start + UPDATE_BATCH_ROWS), now);
  }
}

async function updateActionBatch(
  trx: Database,
  scope: Scope,
  updates: { id: string; fields: ReturnType<typeof groupFields> }[],
  now: Date,
) {
  const values = updates.map(
    ({ id, fields }) =>
      sql`(${sql.join([
        sql`${id}::uuid`,
        ...GROUP_COLUMN_TYPES.map(([column, type]) => sql`${fields[column]}::${sql.raw(type)}`),
      ])})`,
  );
  await sql`update actions
    set ${sql.join(GROUP_COLUMNS.map((column) => sql`${sql.ref(column)} = v.${sql.ref(column)}`))},
      updated_at = ${now}::timestamptz
    from (values ${sql.join(values)}) as v(id, ${sql.join(GROUP_COLUMNS.map((column) => sql.ref(column)))})
    where actions.id = v.id and actions.workspace_id = ${scope.workspaceId}::uuid`.execute(trx);
}

export async function syncActions(
  trx: Database,
  scope: Scope,
  rows: NewMember[],
  snapshotId: string,
): Promise<Map<string, string>> {
  const groups = groupMembers(rows.map(actionMember));
  const existing = new Map(
    (
      await trx
        .selectFrom('actions')
        .select([
          'id',
          'group_key',
          sql<number>`jsonb_array_length(member_opportunity_ids)`.as('members'),
        ])
        .where('workspace_id', '=', scope.workspaceId)
        .where('project_id', '=', scope.projectId)
        .forUpdate()
        .execute()
    ).map((action) => [action.group_key, action]),
  );
  const now = new Date();
  const actionFor = new Map<string, string>();
  const updates: { id: string; fields: ReturnType<typeof groupFields> }[] = [];
  const created: typeof groups = [];
  const urls: ActionUrlSource[] = [];
  const urlSource = (actionId: string, group: Group): ActionUrlSource => ({
    actionId,
    kind: group.target.kind,
    url: group.target.url,
    cohort: group.cohort,
  });
  for (const group of groups) {
    const id = existing.get(group.target.group_key)?.id;
    if (!id) created.push(group);
    else {
      updates.push({ id, fields: groupFields(group, snapshotId) });
      urls.push(urlSource(id, group));
      for (const member of group.members) actionFor.set(member.opportunity_id, id);
    }
  }
  for (let start = 0; start < created.length; start += INSERT_BATCH) {
    const batch = created.slice(start, start + INSERT_BATCH);
    // One transaction connection runs one statement at a time.
    const inserted = await trx // NOSONAR -- Batches share the refresh transaction.
      .insertInto('actions')
      .values(
        batch.map((group) => ({
          id: randomUUID(),
          workspace_id: scope.workspaceId,
          project_id: scope.projectId,
          group_key: group.target.group_key,
          target_kind: group.target.kind,
          origin: a.ACTION_ORIGIN_EVIDENCE,
          status: a.ACTION_STATUS_OPEN,
          effective_status: a.ACTION_STATUS_OPEN,
          ...groupFields(group, snapshotId),
          created_by_user_id: null,
          created_at: now,
          updated_at: now,
        })),
      )
      .returning(['id', 'group_key'])
      .execute();
    const ids = new Map(inserted.map((row) => [row.group_key, row.id]));
    for (const group of batch) {
      const id = ids.get(group.target.group_key)!;
      urls.push(urlSource(id, group));
      for (const member of group.members) actionFor.set(member.opportunity_id, id);
    }
  }
  await updateActions(trx, scope, updates, now);
  await writeActionUrls(trx, scope, urls);
  const seen = new Set(groups.map((group) => group.target.group_key));
  const cleared = [...existing.values()].filter(
    (action) => !seen.has(action.group_key) && Number(action.members) > 0,
  );
  if (cleared.length) {
    await trx
      .updateTable('actions')
      .set({
        member_opportunity_ids: '[]',
        families: '[]',
        diagnosis: '{}',
        priority_score: null,
        opportunity_snapshot_id: snapshotId,
        evidence_cleared_at: sql<Date>`case
          when evidence_cleared_at is null and origin = ${a.ACTION_ORIGIN_EVIDENCE} then ${now}::timestamptz
          else evidence_cleared_at end`,
        updated_at: now,
      })
      .where(
        'id',
        'in',
        cleared.map((action) => action.id),
      )
      .execute();
  }
  return actionFor;
}
