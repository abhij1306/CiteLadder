/** One atomic declaration per Action. Replays never resolve evidence again. */
import { createHash, randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { loadWorkerSettings, policy } from '../config.ts';
import { inTransaction, type Database } from '../db/database.ts';
import { resolveOwnedPages } from '../demand/page-equivalence.ts';
import { ApiError } from '../errors.ts';
import { asApiErrorCode } from '@citeladder/contracts/error-codes';
import { epochMicros, isoformat, parseDatetime, toUtc } from '../http/datetimes.ts';
import { parseUuid } from '../http/uuid.ts';
import { record } from '../db/json.ts';
import { acquireProjectLock } from '../prompts/locks.ts';
import { actionMembers, recordStatus, requireAction, type ActionRow } from './actions.ts';
import { declarationChecks } from './declaration-checks.ts';
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
  // These are the immutable original request fields, including the revision's
  // non-nullifying FK. Compare their meaning, not a serialization hash.
  if (
    row &&
    (row.project_id !== action.project_id ||
      row.action_id !== action.id ||
      row.output_revision_id !== input.output_revision_id ||
      // Unreadable stored checks are unknown, never an empty selection.
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
    .select('revision.phase')
    .where('revision.id', '=', revisionId)
    .where('revision.workspace_id', '=', action.workspace_id)
    .where('revision.project_id', '=', action.project_id)
    .where('output.workspace_id', '=', action.workspace_id)
    .where('output.project_id', '=', action.project_id)
    .where('output.action_id', '=', action.id)
    .executeTakeFirst();
  if (!revision) throw declarationConflict('The output revision does not belong to this Action');
  if (revision.phase === policy.opportunity.declaration.output_phase_outline)
    throw declarationConflict('An outline cannot be declared implemented');
}

async function targets(
  db: Database,
  action: ActionRow,
  members: OpportunityRow[],
  website: string,
) {
  if (
    action.target_kind === a.TARGET_EARNED_PAGE ||
    members.some((member) => o.EARNED_RULE_IDS.includes(member.rule_id))
  ) {
    if (!action.target_url) throw declarationConflict('Implementation target is unresolved');
    return { target_site_url_ids: [], target_external_url: action.target_url };
  }
  const ids = [
    ...new Set(
      members.flatMap((member) => {
        const raw = record(member.evidence).site_url_id;
        const id = typeof raw === 'string' ? parseUuid(raw) : null;
        return id ? [id] : [];
      }),
    ),
  ];
  const owned = ids.length
    ? await db
        .selectFrom('site_urls')
        .select('id')
        .where('workspace_id', '=', action.workspace_id)
        .where('project_id', '=', action.project_id)
        .where('id', 'in', ids)
        .execute()
    : [];
  const allowed = new Set(owned.map((row) => row.id));
  const selected = ids.filter((id) => allowed.has(id));
  if (action.target_kind === a.TARGET_PAGE && !selected.length && action.target_url) {
    const pages = await resolveOwnedPages(
      db,
      action.workspace_id,
      action.project_id,
      [action.target_url],
      website,
    );
    const resolved = pages.get(action.target_url);
    if (!resolved?.site_url_id || !['exact', 'resolved'].includes(resolved.outcome))
      throw declarationConflict('Implementation target is ambiguous or unresolved');
    selected.push(resolved.site_url_id);
  }
  if (selected.length > o.IMPLEMENTATION_TARGETS_MAX)
    throw declarationConflict('Too many implementation targets');
  return { target_site_url_ids: selected, target_external_url: null };
}

/**
 * When the work went live: not in the future beyond clock skew, and not
 * earlier than new evidence would still measure it.
 */
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

/**
 * Evidence already observed after a backdated go-live: the latest crawl,
 * audit and Search Console window are read for this declaration now rather
 * than at their next settlement.
 */
async function verifyExistingEvidence(
  trx: Database,
  row: { id: string; workspace_id: string; project_id: string },
  declaredAt: string,
) {
  const after = sql<Date>`${declaredAt}::timestamptz`;
  const crawl = await trx
    .selectFrom('site_crawls')
    .select('id')
    .where('workspace_id', '=', row.workspace_id)
    .where('project_id', '=', row.project_id)
    .where('status', '=', policy.opportunity.refresh.crawl_status_completed)
    .where('completed_at', '>', after)
    .orderBy('completed_at', 'desc')
    .limit(1)
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
            maxAttempts: loadWorkerSettings().taskMaxAttempts,
          },
        ]
      : [],
  );
  // The declaration transaction runs one statement at a time.
  for (const trigger of triggers) await enqueueImplementationVerification(trx, trigger); // NOSONAR
}

export function declareAction(
  db: Database,
  workspaceId: string,
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
        (input.recommendation_ids ?? []).toSorted((left, right) => left.localeCompare(right)),
      ]),
    )
    .digest('hex');
  return inTransaction(db, async (trx) => {
    // Refresh takes the project lock before updating Action rows. A declaration
    // needs the same order so members, snapshot and workflow form one revision.
    const authorized = await requireAction(trx, workspaceId, actionId);
    await acquireProjectLock(trx, authorized.project_id);
    const action = await requireAction(trx, workspaceId, actionId, true);
    const existing = await replay(trx, action, key, input, declaredAt);
    if (existing) return { row: existing, created: false };
    boundDeclaredAt(declaredAt, now);
    if (action.status !== a.ACTION_STATUS_OPEN)
      throw declarationConflict('Only an open Action can be declared implemented');
    await checkedRevision(trx, action, input.output_revision_id);
    const members = await actionMembers(trx, action);
    if (!members.length) throw declarationConflict('No current finding targets this Action');
    const snapshot = await trx
      .selectFrom('opportunity_snapshots')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .where('project_id', '=', action.project_id)
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(1)
      .executeTakeFirst();
    if (!snapshot) throw declarationConflict('No current opportunity snapshot');
    const project = await trx
      .selectFrom('projects')
      .select('website_url')
      .where('workspace_id', '=', workspaceId)
      .where('id', '=', action.project_id)
      .executeTakeFirstOrThrow();
    const scope = { workspaceId, projectId: action.project_id };
    const checks = await declarationChecks(
      trx,
      scope,
      members,
      {
        auditId: snapshot.audit_id,
        declaredDay: declaredAt.slice(0, 10),
      },
      input.recommendation_ids ?? [],
    );
    // Every finding is declared; contextual links only as far as selected.
    const linked = new Set(checks.map(({ member }) => member.id));
    const declaredMembers = members.filter(
      (member) => member.rule_id !== 'site_contextual_links' || linked.has(member.id),
    );
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
        opportunity_snapshot_id: snapshot.id,
        member_opportunity_ids: JSON.stringify(declaredMembers.map((member) => member.id)),
        ...resolved,
        target_site_url_ids: JSON.stringify(resolved.target_site_url_ids),
        expected_checks: JSON.stringify(checks.map(({ check }) => check)),
        declared_implemented_at: sql<Date>`${declaredAt}::timestamptz`,
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
    await recordStatus(trx, action, a.ACTION_STATUS_IMPLEMENTED, userId);
    await verifyExistingEvidence(trx, row, declaredAt);
    return { row, created: true };
  });
}
