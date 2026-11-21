import { createHash, randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { policy } from '../config.ts';
import { inTransaction, type Database } from '../db/database.ts';
import type { RecordScope } from '../db/workspace-scope.ts';
import { ApiError } from '../errors.ts';
import { asApiErrorCode } from '@citeladder/contracts/error-codes';
import { epochMicros, isoformat, parseDatetime, toUtc } from '../http/datetimes.ts';
import { record } from '../db/json.ts';
import { acquireProjectLock } from '../prompts/locks.ts';
import { currentSiteCrawlQuery } from '../site-health/reads/crawl.ts';
import { declarableMembers, requireAction, type ActionRow } from './actions.ts';
import { recordStatus } from './action-status.ts';
import { declarationChecks } from './declaration-checks.ts';
import { ruleCheckKind } from './checks/registry.ts';
import { declarationTargets } from './targets/registry.ts';
import { enqueueImplementationVerification } from './enqueue.ts';
import { DASHBOARD_AUDIT_STATUSES } from './sources.ts';
import type { OpportunityRow } from './projection.ts';

const o = policy.opportunity.opportunities;
const a = policy.opportunity.actions;
const declarationConflict = (message: string) =>
  new ApiError(409, message, { code: asApiErrorCode(o.CODE_IMPLEMENTATION_TARGET_CONFLICT) });
const replayConflict = () =>
  new ApiError(409, 'Idempotency key was reused', {
    code: asApiErrorCode(o.CODE_IMPLEMENTATION_IDEMPOTENCY_CONFLICT),
  });
export type DeclarationInput = {
  recommendation_ids?: string[];
  output_revision_id: string | null;
  declared_implemented_at: string;
  deployment_reference?: string | null;
};

async function replay(
  db: Database,
  action: ActionRow,
  key: string,
  input: DeclarationInput,
  declaredAt: string,
) {
  const row = await db
    .selectFrom('opportunity_implementation_events')
    .selectAll()
    .select(sql<boolean>`declared_implemented_at = ${declaredAt}::timestamptz`.as('same_time'))
    .where('workspace_id', '=', action.workspace_id)
    .where('idempotency_key', '=', key)
    .executeTakeFirst();
  if (
    row &&
    (row.project_id !== action.project_id ||
      row.action_id !== action.id ||
      row.output_revision_id !== input.output_revision_id ||
      row.deployment_reference !== (input.deployment_reference ?? null) ||
      !Array.isArray(row.expected_checks) ||
      JSON.stringify(
        row.expected_checks
          .map(record)
          .filter((check) => check.kind === 'contextual_link')
          .map((check) => check.recommendation_id)
          .toSorted((left, right) => String(left).localeCompare(String(right))),
      ) !==
        JSON.stringify(
          (input.recommendation_ids ?? []).toSorted((left, right) => left.localeCompare(right)),
        ) ||
      !row.same_time)
  )
    throw replayConflict();
  return row;
}

async function checkedRevision(db: Database, action: ActionRow, revisionId: string | null) {
  if (!revisionId) return;
  const revision = await db
    .selectFrom('agent_output_revisions as revision')
    .innerJoin('agent_outputs as output', 'output.id', 'revision.output_id')
    .select('revision.id')
    .where('revision.id', '=', revisionId)
    .where('revision.workspace_id', '=', action.workspace_id)
    .where('revision.project_id', '=', action.project_id)
    .where('output.workspace_id', '=', action.workspace_id)
    .where('output.project_id', '=', action.project_id)
    .where('output.action_id', '=', action.id)
    .executeTakeFirst();
  if (!revision) throw declarationConflict('The output revision does not belong to this Action');
}

async function targets(
  db: Database,
  action: ActionRow,
  members: OpportunityRow[],
  website: string,
) {
  const resolved = await declarationTargets(db, action, members, website);
  if (!resolved.resolved) throw declarationConflict(resolved.reason);
  return {
    target_site_url_ids: resolved.target_site_url_ids,
    target_external_url: resolved.target_external_url,
  };
}

function boundDeclaredAt(declaredAt: string, now: Date): void {
  const declared = Number(epochMicros(parseDatetime(declaredAt)!) / 1000n);
  if (declared > now.getTime() + o.DECLARATION_FUTURE_SKEW_SECONDS * 1000)
    throw new ApiError(422, 'The implementation time cannot be in the future');
  if (declared < now.getTime() - o.VERIFICATION_WINDOW_DAYS * 86_400_000)
    throw new ApiError(
      422,
      `The implementation time must be within the last ${o.VERIFICATION_WINDOW_DAYS} days`,
    );
}

async function verifyExistingEvidence(
  trx: Database,
  row: { id: string; workspace_id: string; project_id: string },
  declaredAt: string,
) {
  const after = sql<Date>`${declaredAt}::timestamptz`;
  const crawl = await currentSiteCrawlQuery(trx, row.workspace_id, row.project_id, {
    completedAfter: declaredAt,
  })
    .select('id')
    .executeTakeFirst();
  const audit = await trx
    .selectFrom('audits')
    .select('id')
    .where('workspace_id', '=', row.workspace_id)
    .where('project_id', '=', row.project_id)
    .where('market_id', 'is', null)
    .where('status', 'in', DASHBOARD_AUDIT_STATUSES)
    .where('completed_at', '>', after)
    .orderBy('completed_at', 'desc')
    .limit(1)
    .executeTakeFirst();
  const traffic = await trx
    .selectFrom('traffic_snapshots')
    .select('id')
    .where('workspace_id', '=', row.workspace_id)
    .where('project_id', '=', row.project_id)
    .where('granularity', '=', policy.traffic.TRAFFIC_DEFAULT_GRANULARITY)
    .where(sql<boolean>`window_start::date > ${declaredAt}::timestamptz::date`)
    .orderBy('window_end', 'desc')
    .orderBy('created_at', 'desc')
    .limit(1)
    .executeTakeFirst();
  const sources: [string, { id: string } | undefined][] = [
    ['site_crawl', crawl],
    ['audit', audit],
    ['traffic_snapshot', traffic],
  ];
  const triggers = sources.flatMap(([triggerKind, source]) =>
    source
      ? [
          {
            workspaceId: row.workspace_id,
            projectId: row.project_id,
            triggerKind,
            triggerId: source.id,
            revision: `declaration-${row.id}`,
          },
        ]
      : [],
  );
  for (const trigger of triggers) await enqueueImplementationVerification(trx, trigger); // NOSONAR -- The declaration transaction runs one statement at a time.
}

async function resolvedBeforeGoLive(trx: Database, action: ActionRow, declaredAt: string) {
  if (!action.opportunity_snapshot_id) return null;
  const clearing = await trx
    .selectFrom('opportunity_snapshots')
    .select('id')
    .where('workspace_id', '=', action.workspace_id)
    .where('project_id', '=', action.project_id)
    .where('id', '=', action.opportunity_snapshot_id)
    .where('created_at', '<=', sql<Date>`${declaredAt}::timestamptz`)
    .executeTakeFirst();
  return clearing?.id ?? null;
}

const isContextualLink = (member: { rule_id: string }) =>
  ruleCheckKind(member.rule_id) === 'contextual_link';

export function declareAction(
  db: Database,
  scope: RecordScope,
  actionId: string,
  userId: string,
  key: string,
  input: DeclarationInput,
) {
  const declaredAt = isoformat(toUtc(parseDatetime(input.declared_implemented_at)!));
  const now = new Date();
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify([
        actionId,
        input.output_revision_id,
        declaredAt,
        input.deployment_reference ?? null,
        (input.recommendation_ids ?? []).toSorted((left, right) => left.localeCompare(right)),
      ]),
    )
    .digest('hex');
  const { workspaceId } = scope;
  return inTransaction(db, async (trx) => {
    // Refresh takes the project lock before updating Action rows. A declaration
    // needs the same order so members, snapshot and workflow form one revision.
    const authorized = await requireAction(trx, scope, actionId);
    await acquireProjectLock(trx, authorized.project_id);
    const action = await requireAction(trx, scope, actionId, true);
    const existing = await replay(trx, action, key, input, declaredAt);
    if (existing) return { row: existing, created: false };
    boundDeclaredAt(declaredAt, now);
    if (!a.ACTION_DECLARABLE_STATUSES.includes(action.status))
      throw declarationConflict('Only a new or in-progress Action can be declared implemented');
    await checkedRevision(trx, action, input.output_revision_id);
    const { members, resolved: membersResolved } = await declarableMembers(trx, action);
    if (!members.length) throw declarationConflict('No finding targets this Action');
    const snapshot = await trx
      .selectFrom('opportunity_snapshots')
      .select(['id', 'audit_id'])
      .where('workspace_id', '=', workspaceId)
      .where('project_id', '=', action.project_id)
      .where('created_at', '<=', sql<Date>`${declaredAt}::timestamptz`)
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(1)
      .executeTakeFirst();
    const resolvedBefore = membersResolved
      ? await resolvedBeforeGoLive(trx, action, declaredAt)
      : null;
    const project = await trx
      .selectFrom('projects')
      .select('website_url')
      .where('workspace_id', '=', workspaceId)
      .where('id', '=', action.project_id)
      .executeTakeFirstOrThrow();
    if (resolvedBefore && input.recommendation_ids?.length)
      throw declarationConflict('The selected links were resolved before the change went live');
    const unselectable = membersResolved && !input.recommendation_ids?.length;
    const measured = unselectable ? members.filter((member) => !isContextualLink(member)) : members;
    const checks = resolvedBefore
      ? []
      : await declarationChecks(
          trx,
          { workspaceId, projectId: action.project_id },
          measured,
          {
            auditId: snapshot?.audit_id ?? null,
            declaredAt,
            outputRevisionId: input.output_revision_id,
          },
          input.recommendation_ids ?? [],
        );
    const linked = new Set(checks.flatMap(({ member }) => (member ? [member.id] : [])));
    const declaredMembers = unselectable
      ? members
      : members.filter((member) => !isContextualLink(member) || linked.has(member.id));
    const resolved = await targets(trx, action, declaredMembers, project.website_url);
    const row = await trx
      .insertInto('opportunity_implementation_events')
      .values({
        id: randomUUID(),
        workspace_id: workspaceId,
        project_id: action.project_id,
        action_id: action.id,
        actor_user_id: userId,
        output_revision_id: input.output_revision_id,
        opportunity_snapshot_id: snapshot?.id ?? null,
        resolved_before_snapshot_id: resolvedBefore,
        member_opportunity_ids: JSON.stringify(declaredMembers.map((member) => member.id)),
        ...resolved,
        target_site_url_ids: JSON.stringify(resolved.target_site_url_ids),
        expected_checks: JSON.stringify(checks.map(({ check }) => check)),
        declared_implemented_at: sql<Date>`${declaredAt}::timestamptz`,
        deployment_reference: input.deployment_reference ?? null,
        created_at: new Date(),
        idempotency_key: key,
        request_fingerprint: fingerprint,
      })
      .onConflict((oc) => oc.columns(['workspace_id', 'idempotency_key']).doNothing())
      .returningAll()
      .executeTakeFirst();
    // A different project can race on a workspace-wide key. No side effects
    // occur until the insert wins; conflict recovery checks identity again.
    if (!row) {
      const stored = await replay(trx, action, key, input, declaredAt);
      if (!stored) throw replayConflict();
      return { row: stored, created: false };
    }
    await recordStatus(trx, [action], a.ACTION_STATUS_IMPLEMENTED, userId);
    if (!resolvedBefore) await verifyExistingEvidence(trx, row, declaredAt);
    return { row, created: true };
  });
}
