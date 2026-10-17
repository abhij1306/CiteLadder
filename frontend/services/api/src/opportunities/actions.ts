/** Persisted Action reads, target attachment and explicit workflow decisions. */
import { randomUUID } from 'node:crypto';
import {
  actionDetailSchema,
  actionItemSchema,
  actionStatusSchema,
  measurementLegSchema,
} from '@citeladder/contracts/actions';
import { sql, type Selectable } from 'kysely';

import { policy } from '../config.ts';
import { inTransaction, type Database } from '../db/database.ts';
import type { Actions } from '../generated/db-schema.ts';
import { ApiError, notFound } from '../errors.ts';
import {
  decodeKeysetCursor,
  encodeKeysetCursor,
  InvalidCursorError,
} from '../http/keyset-cursor.ts';
import { parseUuid } from '../http/uuid.ts';
import { effectiveStatus, validateStatus } from './action-status.ts';
import { OPPORTUNITY_COLUMNS, projectItem } from './projection.ts';
import { requireProject } from './reads.ts';
import type { Scope } from './sources.ts';
import { declarationView } from './declaration-view.ts';
import { memberMeasurementLeg } from './declaration-checks.ts';
import { acquireProjectLock } from '../prompts/locks.ts';
import { normalizeDomain } from '../analysis/domains.ts';
import { pageGroupKey, plannedPageKey, selectApproach } from '../analysis/opportunities/actions.ts';

const a = policy.opportunity.actions;
export class ActionTargetError extends Error {}

async function targetIdentity(db: Database, scope: Scope, kind: string, target: string) {
  const project = await db
    .selectFrom('projects')
    .select('website_url')
    .where('id', '=', scope.projectId)
    .where('workspace_id', '=', scope.workspaceId)
    .executeTakeFirst();
  if (!project) throw notFound('Project');
  if (kind === a.TARGET_PLANNED_PAGE) {
    const key = plannedPageKey(target);
    if (!key) throw new ActionTargetError('A planned page needs a topic');
    return { key, url: null };
  }
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    throw new ActionTargetError('Page target must be an absolute URL');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new ActionTargetError('Invalid page target');
  const owned = await db
    .selectFrom('owned_domains as d')
    .innerJoin('projects as p', 'p.id', 'd.project_id')
    .select('d.domain')
    .where('p.workspace_id', '=', scope.workspaceId)
    .where('p.id', '=', scope.projectId)
    .execute();
  const hosts = new Set(
    [project.website_url, ...owned.map((row) => row.domain)].map(normalizeDomain),
  );
  if (!hosts.has(normalizeDomain(url.hostname)))
    throw new ActionTargetError('Page target is outside the owned domains');
  return { key: pageGroupKey(target), url: target };
}
/** Caller owns the transaction. Refresh and attachments share its project lock. */
export async function attachOrCreateAction(
  db: Database,
  scope: Scope,
  kind: string,
  rawTarget: string,
  userId: string | null,
) {
  if (!a.AGENT_TARGET_KINDS.includes(kind)) throw new ActionTargetError('Unsupported Agent target');
  const target = rawTarget.trim();
  await acquireProjectLock(db, scope.projectId);
  const identity = await targetIdentity(db, scope, kind, target);
  const now = new Date();
  await db
    .insertInto('actions')
    .values({
      id: randomUUID(),
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      group_key: identity.key,
      target_kind: kind,
      target_label: target.slice(0, a.ACTION_LABEL_MAX_CHARS),
      target_url: identity.url,
      origin: a.ACTION_ORIGIN_AGENT,
      families: '[]',
      approach: '',
      skill_id:
        kind === a.TARGET_PAGE ? selectApproach([], kind).skill_id : a.AGENT_ORIGIN_DEFAULT_SKILL,
      diagnosis: '{}',
      member_opportunity_ids: '[]',
      created_by_user_id: userId,
      created_at: now,
      updated_at: now,
      status: a.ACTION_STATUS_OPEN,
      target_prompt_id: null,
      priority_score: null,
      opportunity_snapshot_id: null,
      evidence_cleared_at: null,
    })
    .onConflict((oc) => oc.constraint('uq_actions_project_group').doNothing())
    .execute();
  return db
    .selectFrom('actions')
    .selectAll()
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('group_key', '=', identity.key)
    .executeTakeFirstOrThrow();
}
export type ActionRow = Selectable<Actions>;
const jsonList = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const stringList = (value: unknown): string[] =>
  jsonList(value).filter((v): v is string => typeof v === 'string');

function actionItem(row: ActionRow, status: string) {
  return {
    id: row.id,
    project_id: row.project_id,
    target_kind: row.target_kind,
    target_label: row.target_label,
    target_url: row.target_url,
    target_prompt_id: row.target_prompt_id,
    origin: actionItemSchema.shape.origin.parse(row.origin),
    status: actionStatusSchema.parse(status),
    priority_score: row.priority_score,
    families: stringList(row.families),
    approach: row.approach,
    skill_id: row.skill_id,
    member_count: jsonList(row.member_opportunity_ids).length,
    evidence_cleared_at: row.evidence_cleared_at?.toISOString() ?? null,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

function listed(db: Database, scope: Scope) {
  return db
    .selectFrom('actions')
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where((eb) =>
      eb.or([eb('evidence_cleared_at', 'is', null), eb('origin', '=', a.ACTION_ORIGIN_AGENT)]),
    );
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

export async function listActions(
  db: Database,
  scope: Scope,
  filters: {
    status: string | null;
    target_kind: string | null;
    limit: number;
    cursor: string | null;
  },
) {
  await requireProject(db, scope);
  if (filters.status !== null) validateStatus(filters.status);
  if (filters.target_kind !== null && !a.ACTION_TARGET_KINDS.includes(filters.target_kind))
    throw new ApiError(422, `Unknown target kind: ${filters.target_kind}`);
  const priority = sql<number>`coalesce(actions.priority_score, -1)`;
  const fingerprint = {
    project_id: scope.projectId,
    status: filters.status,
    target_kind: filters.target_kind,
  };
  let query = listed(db, scope)
    .selectAll()
    .select(effectiveStatus().as('current'))
    .where(effectiveStatus(), 'in', filters.status ? [filters.status] : a.ACTION_ACTIVE_STATUSES);
  if (filters.target_kind) query = query.where('target_kind', '=', filters.target_kind);
  if (filters.cursor) {
    const { score, id } = cursorPosition(filters.cursor, fingerprint);
    query = query.where((eb) =>
      eb.or([eb(priority, '<', score), eb.and([eb(priority, '=', score), eb('id', '>', id)])]),
    );
  }
  const rows = await query
    .orderBy(priority, 'desc')
    .orderBy('id')
    .limit(filters.limit + 1)
    .execute();
  const page = rows.slice(0, filters.limit);
  const last = page.at(-1);
  const statuses = listed(db, scope).select(effectiveStatus().as('status')).as('listed');
  const counts = await db
    .selectFrom(statuses)
    .select(['status', sql<number>`count(*)::int`.as('count')])
    .groupBy('status')
    .execute();
  return {
    items: page.map((row) => actionItem(row, row.current)),
    next_cursor:
      rows.length > filters.limit && last
        ? encodeKeysetCursor('actions', fingerprint, [String(last.priority_score ?? -1), last.id])
        : null,
    status_counts: {
      ...Object.fromEntries(a.ACTION_STATUSES.map((status) => [status, 0])),
      ...Object.fromEntries(counts.map((row) => [row.status, row.count])),
    },
  };
}

export async function requireAction(
  db: Database,
  workspaceId: string,
  actionId: string,
  lock = false,
) {
  let query = db
    .selectFrom('actions')
    .selectAll()
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', actionId);
  if (lock) query = query.forUpdate();
  const row = await query.executeTakeFirst();
  if (!row) throw notFound('Action');
  return row;
}

/** The workspace's Action row with the effective status its readers see. */
async function readAction(db: Database, workspaceId: string, actionId: string) {
  const row = await db
    .selectFrom('actions')
    .selectAll()
    .select(effectiveStatus().as('current'))
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', actionId)
    .executeTakeFirst();
  if (!row) throw notFound('Action');
  return row;
}

export async function actionMembers(db: Database, action: ActionRow) {
  const ids = stringList(action.member_opportunity_ids);
  if (!ids.length) return [];
  const rows = await db
    .selectFrom('opportunities')
    .select(OPPORTUNITY_COLUMNS)
    .where('workspace_id', '=', action.workspace_id)
    .where('project_id', '=', action.project_id)
    .where('id', 'in', ids)
    .where('superseded_at', 'is', null)
    .execute();
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
}

const measuredBy = measurementLegSchema.shape.leg.nullable();

export async function getAction(db: Database, workspaceId: string, actionId: string) {
  const action = await readAction(db, workspaceId, actionId);
  const declaration = await db
    .selectFrom('opportunity_implementation_events')
    .selectAll()
    .where('workspace_id', '=', workspaceId)
    .where('project_id', '=', action.project_id)
    .where('action_id', '=', actionId)
    .executeTakeFirst();
  const members = await actionMembers(db, action);
  return {
    ...actionItem(action, action.current),
    diagnosis: actionDetailSchema.shape.diagnosis.parse(action.diagnosis),
    members: members.map((row) => ({ ...projectItem(row), remediation: row.remediation || '' })),
    // The earliest go-live a declaration accepts; new evidence measures it from there.
    declarable_since: new Date(
      Date.now() - policy.opportunity.opportunities.VERIFICATION_WINDOW_DAYS * 86_400_000,
    ).toISOString(),
    // Before a declaration: which reading would measure each finding.
    member_measurement: Object.fromEntries(
      members.map((row) => [row.id, measuredBy.parse(memberMeasurementLeg(row))]),
    ),
    declaration: declaration ? await declarationView(db, declaration) : null,
  };
}

export async function recordStatus(
  db: Database,
  action: ActionRow,
  status: string,
  userId: string,
) {
  if (action.status === status) return;
  const now = new Date();
  await db
    .updateTable('actions')
    .set({ status, updated_at: now })
    .where('workspace_id', '=', action.workspace_id)
    .where('id', '=', action.id)
    .execute();
  await db
    .insertInto('action_status_events')
    .values({
      id: randomUUID(),
      workspace_id: action.workspace_id,
      project_id: action.project_id,
      action_id: action.id,
      previous_status: action.status,
      next_status: status,
      changed_by_user_id: userId,
      created_at: now,
    })
    .execute();
}

export async function updateActionStatus(
  db: Database,
  workspaceId: string,
  actionId: string,
  status: string,
  userId: string,
) {
  await inTransaction(db, async (trx) => {
    const action = await requireAction(trx, workspaceId, actionId, true);
    if (!a.ACTION_USER_STATUSES.includes(action.status))
      throw new ApiError(422, 'A declared Action cannot be changed');
    await recordStatus(trx, action, status, userId);
  });
  const row = await readAction(db, workspaceId, actionId);
  return actionItem(row, row.current);
}
