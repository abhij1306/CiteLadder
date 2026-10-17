/**
 * Re-derive every Action of a project from its new live Opportunity set
 * (`actions.sync_actions`), inside the refresh transaction and under its
 * project lock, so members, priority and diagnosis always describe the
 * snapshot that superseded the old rows.
 *
 * The refresh derives evidence Actions and restamps every live row's members;
 * the Agent only inserts its own `agent`-origin rows under the same project
 * lock, so the locked read below sees them and the refresh adopts the row on
 * that key. Identity and origin never change here. An Action no member
 * targets any more keeps its row with its evidence cleared, written once.
 */
import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';

import { policy } from '../config.ts';
import { groupMembers, type ActionMember } from '../analysis/opportunities/actions.ts';
import type { Database } from '../db/database.ts';
import { record } from '../db/json.ts';
import type { NewOpportunity } from './refresh-compute.ts';
import type { Scope } from './sources.ts';

const a = policy.opportunity.actions;

/** One new row as the grouping reads it. */
function actionMember(
  row: Omit<NewOpportunity, 'source_analysis_ids' | 'source_issue_ids' | 'source_metric_ids'> & {
    source_analysis_ids: string[] | null;
    source_issue_ids: string[] | null;
    source_metric_ids: string[] | null;
  },
): ActionMember {
  const evidence = record(row.evidence);
  const prompt = evidence.prompt_text || evidence.prompt;
  return {
    opportunity_id: row.id,
    rule_id: row.rule_id,
    target_key: row.target_key,
    target_url: row.target_url,
    target_prompt_id: row.target_prompt_id,
    target_theme: row.target_theme,
    label_hint: typeof prompt === 'string' ? prompt : null,
    title: row.title || row.rule_id,
    priority_score: row.priority_score || 0,
    source_analysis_ids: [...(row.source_analysis_ids ?? [])],
    source_issue_ids: [...(row.source_issue_ids ?? [])],
    source_metric_ids: [...(row.source_metric_ids ?? [])],
  };
}

type Group = ReturnType<typeof groupMembers>[number];

/**
 * The columns one group writes onto its Action with their PostgreSQL types, in
 * the batched update's VALUES order.
 */
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
  ['opportunity_snapshot_id', 'uuid'],
  ['evidence_cleared_at', 'timestamptz'],
] as const;
type GroupColumn = (typeof GROUP_COLUMN_TYPES)[number][0];
const GROUP_COLUMNS = GROUP_COLUMN_TYPES.map(([column]) => column);

/** The persisted fields one group writes onto its Action. */
function groupFields(group: Group, snapshotId: string) {
  return {
    target_label: group.target.label,
    target_url: group.target.url,
    target_prompt_id: group.target.prompt_id,
    priority_score: group.priority_score,
    families: JSON.stringify(group.families),
    approach: group.approach,
    skill_id: group.skill_id,
    diagnosis: JSON.stringify(group.diagnosis),
    member_opportunity_ids: JSON.stringify(group.members.map((member) => member.opportunity_id)),
    opportunity_snapshot_id: snapshotId,
    evidence_cleared_at: null,
  } satisfies Record<GroupColumn, unknown>;
}

// PostgreSQL binds at most 65,535 parameters per statement. Each row binds its
// id plus every group column; the statement adds updated_at and workspace_id.
const MAX_BIND_PARAMETERS = 65_535;
const UPDATE_BATCH_ROWS = Math.floor((MAX_BIND_PARAMETERS - 2) / (GROUP_COLUMNS.length + 1));
// An insert row binds every group column plus ten identity and audit columns.
const INSERT_BATCH = Math.floor(MAX_BIND_PARAMETERS / (GROUP_COLUMNS.length + 10));

/** Restamp every existing Action, one bounded statement per batch in the caller's transaction. */
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

/**
 * Upsert the project's Actions for `rows` and return each row's Action id.
 * The caller inserts the rows with that id, after this runs.
 */
export async function syncActions(
  trx: Database,
  scope: Scope,
  rows: NewOpportunity[],
  snapshotId: string,
  families: string[],
): Promise<Map<string, string>> {
  const groups = groupMembers(rows.map(actionMember), families);
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
  for (const group of groups) {
    const id = existing.get(group.target.group_key)?.id;
    if (!id) created.push(group);
    else {
      updates.push({ id, fields: groupFields(group, snapshotId) });
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
          ...groupFields(group, snapshotId),
          created_by_user_id: null,
          created_at: now,
          updated_at: now,
        })),
      )
      .returning(['id', 'group_key'])
      .execute();
    const ids = new Map(inserted.map((row) => [row.group_key, row.id]));
    for (const group of batch)
      for (const member of group.members)
        actionFor.set(member.opportunity_id, ids.get(group.target.group_key)!);
  }
  await updateActions(trx, scope, updates, now);
  const seen = new Set(groups.map((group) => group.target.group_key));
  // An Action already cleared keeps its row untouched; only the transition writes.
  const cleared = [...existing.values()].filter(
    (action) => !seen.has(action.group_key) && Number(action.members) > 0,
  );
  if (cleared.length) {
    await trx
      .updateTable('actions')
      .set({
        member_opportunity_ids: '[]',
        families: '[]',
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
