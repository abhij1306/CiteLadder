import { randomUUID } from 'node:crypto';
import {
  ACTION_STATUS_ANY,
  actionDetailSchema,
  actionGoalSchema,
  actionGroupingSchema,
  actionOwnershipSchema,
  actionItemSchema,
  actionPriorityBandSchema,
  actionStatusSchema,
  measurementLegSchema,
  type ActionStatus,
} from '@citeladder/contracts/actions';
import { sql, type Selectable, type SqlBool } from 'kysely';

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { containsPattern } from '../db/like.ts';
import type { RecordScope } from '../db/workspace-scope.ts';
import type { Actions } from '../generated/db-schema.ts';
import { ApiError, notFound } from '../errors.ts';
import {
  decodeKeysetCursor,
  encodeKeysetCursor,
  InvalidCursorError,
} from '../http/keyset-cursor.ts';
import { parseUuid } from '../http/uuid.ts';
import { persistedStatuses, statusView, validateStatus } from './action-status.ts';
import { OPPORTUNITY_COLUMNS, projectItem } from './projection.ts';
import type { Scope } from './sources.ts';
import { declarationView } from './declaration-view.ts';
import { memberMeasurementLeg } from './checks/registry.ts';
import { contentGapEvidence } from './content-gap-reads.ts';
import { acquireProjectLock } from '../prompts/locks.ts';
import { priorityBand, readHandoff } from '../analysis/opportunities/actions.ts';
import { record } from '../db/json.ts';
import { ruleRemediation } from '../site-health/reads/rules.ts';
import { actionUrlsPage, writeActionUrls } from './action-urls.ts';
import {
  FALLBACK_GOAL,
  goalOf,
  groupingSql,
  impactSql,
  ownershipSql,
  topicSql,
} from './action-groupings.ts';
import {
  ActionTargetError,
  isAgentTargetKind,
  namedTarget,
  storedCohort,
  targetDetail,
} from './targets/registry.ts';

const a = policy.opportunity.actions;

export async function attachOrCreateAction(
  db: Database,
  scope: Scope,
  kind: string,
  rawTarget: string,
  userId: string | null,
) {
  if (!isAgentTargetKind(kind)) throw new ActionTargetError('Unsupported Agent target');
  await acquireProjectLock(db, scope.projectId);
  const identity = await namedTarget(db, scope, kind, rawTarget);
  const now = new Date();
  await db
    .insertInto('actions')
    .values({
      id: randomUUID(),
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      group_key: identity.key,
      target_kind: identity.kind,
      target_label: identity.text.slice(0, a.ACTION_LABEL_MAX_CHARS),
      target_url: identity.url,
      origin: a.ACTION_ORIGIN_AGENT,
      families: '[]',
      approach: '',
      skill_id: a.AGENT_ORIGIN_DEFAULT_SKILL,
      diagnosis: '{}',
      member_opportunity_ids: '[]',
      created_by_user_id: userId,
      created_at: now,
      updated_at: now,
      status: a.ACTION_STATUS_OPEN,
      effective_status: a.ACTION_STATUS_OPEN,
      target_prompt_id: null,
      priority_score: null,
      opportunity_snapshot_id: null,
      evidence_cleared_at: null,
      ...agentGrouping(identity.kind),
    })
    .onConflict((oc) => oc.constraint('uq_actions_project_group').doNothing())
    .execute();
  const action = await db
    .selectFrom('actions')
    .selectAll()
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('group_key', '=', identity.key)
    .executeTakeFirstOrThrow();
  if (action.target_kind === 'page')
    await writeActionUrls(db, scope, [
      { actionId: action.id, kind: action.target_kind, url: action.target_url, cohort: null },
    ]);
  return action;
}
function agentGrouping(kind: string) {
  const grouping = a.AGENT_KIND_GROUPING[kind] ?? a.ACTION_GROUPING_FALLBACK;
  return { goal: goalOf(grouping), goal_grouping: grouping };
}

export type ActionRow = Selectable<Actions>;
const jsonList = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const stringList = (value: unknown): string[] =>
  jsonList(value).filter((v): v is string => typeof v === 'string');

function actionSummary(row: ActionRow, cohort: ReturnType<typeof storedCohort>): string | null {
  if (cohort) return ruleRemediation(cohort.rule_id);
  const diagnosis = actionDetailSchema.shape.diagnosis.safeParse(row.diagnosis);
  return diagnosis.data?.what_happened?.[0]?.title ?? null;
}

export function actionItem(row: ActionRow) {
  const cohort = storedCohort(row);
  return {
    id: row.id,
    project_id: row.project_id,
    target_kind: row.target_kind,
    target_label: row.target_label,
    target_url: row.target_url,
    target_prompt_id: row.target_prompt_id,
    origin: actionItemSchema.shape.origin.parse(row.origin),
    ...statusView(row.effective_status),
    priority_score: row.priority_score,
    priority_band: priorityBand(row.priority_score),
    families: stringList(row.families),
    approach: row.approach,
    goal: actionGoalSchema.parse(row.goal ?? FALLBACK_GOAL),
    grouping: actionGroupingSchema.parse(row.goal_grouping ?? a.ACTION_GROUPING_FALLBACK),
    skill_id: row.skill_id,
    member_count: jsonList(row.member_opportunity_ids).length,
    declarable_member_count: declarableIds(row).length,
    page_count: cohort?.page_count ?? null,
    finding_class: cohort ? actionItemSchema.shape.finding_class.parse(cohort.finding_class) : null,
    summary: actionSummary(row, cohort),
    handoff: readHandoff(record(row.diagnosis).handoff, row.target_label),
    evidence_cleared_at: row.evidence_cleared_at?.toISOString() ?? null,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

export const LISTED_ACTION = sql<SqlBool>`(actions.evidence_cleared_at is null or actions.origin = ${a.ACTION_ORIGIN_AGENT})`;

function listed(db: Database, scope: Scope) {
  return db
    .selectFrom('actions')
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where(LISTED_ACTION);
}

function cursorPosition(cursor: string, filters: Record<string, unknown>) {
  try {
    const values = decodeKeysetCursor(cursor, 'actions', filters);
    const score = Number(values[0]);
    const id = parseUuid(values[1] ?? '');
    if (values.length !== 2 || !values[0] || !Number.isFinite(score) || !id)
      throw new InvalidCursorError('invalid cursor');
    return { score, id };
  } catch (error) {
    if (!(error instanceof InvalidCursorError)) throw error;
    throw new ApiError(400, error.message, { code: 'invalid_cursor' });
  }
}

const KNOWN_APPROACHES = [
  ...new Set([
    ...a.APPROACH_TREE.map((branch) => branch.approach),
    a.DEFAULT_APPROACH.approach,
    '',
  ]),
];

type ActionListFilters = {
  status: string | null;
  q?: string | null;
  target_kind?: string | null;
  approach?: string | null;
  priority?: string | null;
  family?: string | null;
  grouping?: string | null;
  ownership?: string | null;
  topic?: string | null;
  limit: number;
  cursor: string | null;
};

function known<T extends string>(
  name: string,
  value: string | null | undefined,
  allowed: readonly T[],
): T | null {
  if (value === null || value === undefined) return null;
  const match = allowed.find((option) => option === value);
  if (match === undefined) throw new ApiError(422, `Unknown ${name}: ${value}`);
  return match;
}

type ActionFilterInput = Omit<ActionListFilters, 'limit' | 'cursor'>;

export function parseFilters(filters: ActionFilterInput) {
  let status: ActionStatus | typeof ACTION_STATUS_ANY | null = ACTION_STATUS_ANY;
  if (filters.status !== ACTION_STATUS_ANY)
    status = filters.status === null ? null : validateStatus(filters.status);
  return {
    grouping: known('grouping', filters.grouping, actionGroupingSchema.options),
    ownership: known('ownership', filters.ownership, actionOwnershipSchema.options),
    topic: filters.topic ?? null,
    status,
    q: filters.q?.trim() || null,
    target_kind: known('target kind', filters.target_kind, a.ACTION_TARGET_KINDS),
    approach: known('approach', filters.approach, KNOWN_APPROACHES),
    priority: known('priority', filters.priority, actionPriorityBandSchema.options),
    family: known('source', filters.family, a.EVIDENCE_FAMILIES),
  };
}

function filteredActions(db: Database, scope: Scope, filters: ReturnType<typeof parseFilters>) {
  let filtered = listed(db, scope);
  if (filters.grouping) filtered = filtered.where(groupingSql, '=', filters.grouping);
  if (filters.ownership) filtered = filtered.where(ownershipSql, '=', filters.ownership);
  if (filters.topic !== null) filtered = filtered.where(topicSql, '=', filters.topic);
  if (filters.status !== ACTION_STATUS_ANY)
    filtered = filtered.where(
      'effective_status',
      'in',
      filters.status ? persistedStatuses([filters.status]) : a.ACTION_ACTIVE_STATUSES,
    );
  if (filters.q) filtered = filtered.where('target_label', 'ilike', containsPattern(filters.q));
  if (filters.target_kind) filtered = filtered.where('target_kind', '=', filters.target_kind);
  if (filters.approach !== null) filtered = filtered.where('approach', '=', filters.approach);
  if (filters.family)
    filtered = filtered.where(
      sql<SqlBool>`actions.families @> ${JSON.stringify([filters.family])}::jsonb`,
    );
  if (filters.priority) filtered = filtered.where(impactSql, '=', filters.priority);
  return filtered;
}

export function matchingActions(db: Database, scope: Scope, raw: ActionFilterInput) {
  return filteredActions(db, scope, parseFilters(raw));
}

export function listCursor(
  scope: Scope,
  filters: ReturnType<typeof parseFilters>,
  last: Pick<ActionRow, 'priority_score' | 'id'>,
) {
  return encodeKeysetCursor('actions', { project_id: scope.projectId, ...filters }, [
    String(last.priority_score ?? -1),
    last.id,
  ]);
}

export async function listActions(db: Database, scope: Scope, raw: ActionListFilters) {
  const filters = parseFilters(raw);
  const priority = sql<number>`coalesce(actions.priority_score, -1)`;
  const fingerprint = { project_id: scope.projectId, ...filters };
  let query = filteredActions(db, scope, filters).selectAll();
  if (raw.cursor) {
    const { score, id } = cursorPosition(raw.cursor, fingerprint);
    query = query.where((eb) =>
      eb.or([eb(priority, '<', score), eb.and([eb(priority, '=', score), eb('id', '>', id)])]),
    );
  }
  const [rows, counts] = await Promise.all([
    query
      .orderBy(priority, 'desc')
      .orderBy('id')
      .limit(raw.limit + 1)
      .execute(),
    listed(db, scope)
      .select(['effective_status as status', sql<number>`count(*)::int`.as('count')])
      .groupBy('effective_status')
      .execute(),
  ]);
  const page = rows.slice(0, raw.limit);
  const last = page.at(-1);
  return {
    items: page.map(actionItem),
    next_cursor: rows.length > raw.limit && last ? listCursor(scope, filters, last) : null,
    status_counts: Object.fromEntries(
      actionStatusSchema.options.map((status) => [
        status,
        counts
          .filter((row) => statusView(row.status).status === status)
          .reduce((sum, row) => sum + row.count, 0),
      ]),
    ),
  };
}

export async function requireAction(
  db: Database,
  scope: RecordScope,
  actionId: string,
  lock = false,
) {
  let query = db
    .selectFrom('actions')
    .selectAll()
    .where('workspace_id', '=', scope.workspaceId)
    .where('id', '=', actionId);
  if (scope.projectId !== null) query = query.where('project_id', '=', scope.projectId);
  if (lock) query = query.forUpdate();
  const row = await query.executeTakeFirst();
  if (!row) throw notFound('Action');
  return row;
}

function inMemberOrder<T extends { id: string }>(ids: readonly string[], rows: readonly T[]) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.flatMap((id) => {
    const row = byId.get(id);
    return row ? [row] : [];
  });
}

async function findingsOf(db: Database, action: ActionRow, ids: string[], superseded: boolean) {
  let query = db
    .selectFrom('opportunities')
    .select(OPPORTUNITY_COLUMNS)
    .where('workspace_id', '=', action.workspace_id)
    .where('project_id', '=', action.project_id)
    .where('id', 'in', ids);
  if (!superseded) query = query.where('superseded_at', 'is', null);
  return inMemberOrder(ids, await query.execute());
}

function declarableIds(action: ActionRow): string[] {
  const current = stringList(action.member_opportunity_ids);
  return current.length ? current : stringList(action.last_member_opportunity_ids);
}

export async function declarableMembers(db: Database, action: ActionRow) {
  const ids = declarableIds(action);
  if (!ids.length) return { members: [], resolved: false };
  const resolved = stringList(action.member_opportunity_ids).length === 0;
  return { members: await findingsOf(db, action, ids, resolved), resolved };
}

function memberRows(db: Database, workspaceId: string, actionId: string) {
  return db
    .selectFrom('opportunities')
    .select(OPPORTUNITY_COLUMNS)
    .where('opportunities.workspace_id', '=', workspaceId)
    .where(
      sql<SqlBool>`(opportunities.project_id, opportunities.id) in (
        select actions.project_id, member.id::uuid
        from actions cross join jsonb_array_elements_text(actions.member_opportunity_ids) member(id)
        where actions.workspace_id = ${workspaceId} and actions.id = ${actionId})`,
    )
    .where('opportunities.superseded_at', 'is', null)
    .execute();
}

const measuredBy = measurementLegSchema.shape.leg.nullable();

export async function getAction(db: Database, workspaceId: string, actionId: string) {
  const [action, declaration, rows] = await Promise.all([
    requireAction(db, { workspaceId, projectId: null }, actionId),
    db
      .selectFrom('opportunity_implementation_events')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .where('action_id', '=', actionId)
      .executeTakeFirst(),
    memberRows(db, workspaceId, actionId),
  ]);
  const members = inMemberOrder(stringList(action.member_opportunity_ids), rows);
  const [{ editable_page, cohort: shown }, urls] = await Promise.all([
    targetDetail(db, action, stringList(declaration?.member_opportunity_ids)),
    readActionUrls(db, action, null),
  ]);
  const cohort = shown ? actionDetailSchema.shape.cohort.parse(shown) : null;
  return {
    ...actionItem(action),
    editable_page,
    diagnosis: actionDetailSchema.shape.diagnosis.parse(action.diagnosis),
    members: members.map((row) => ({
      ...projectItem(row),
      remediation: row.remediation || '',
      content_gap_evidence: contentGapEvidence(row),
    })),
    declarable_since: new Date(
      Date.now() - policy.opportunity.opportunities.VERIFICATION_WINDOW_DAYS * 86_400_000,
    ).toISOString(),
    member_measurement: Object.fromEntries(
      members.map((row) => [row.id, measuredBy.parse(memberMeasurementLeg(row))]),
    ),
    declaration: declaration ? await declarationView(db, declaration) : null,
    cohort,
    urls,
  };
}

const OPEN_LISTED_ACTION = sql<SqlBool>`${LISTED_ACTION} and actions.effective_status = any(${persistedStatuses(['open', 'in_progress'])}::text[])`;

function readActionUrls(db: Database, action: ActionRow, cursor: string | null) {
  return actionUrlsPage(db, action, {
    cursor,
    wholeSite: storedCohort(action)?.whole_site ?? false,
    counted: OPEN_LISTED_ACTION,
  });
}

export async function getActionUrls(
  db: Database,
  workspaceId: string,
  actionId: string,
  cursor: string | null,
) {
  const action = await requireAction(db, { workspaceId, projectId: null }, actionId);
  return readActionUrls(db, action, cursor);
}
