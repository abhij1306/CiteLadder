import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { utcText } from '../db/timestamps.ts';
import { WorkspaceScope } from '../db/workspace-scope.ts';
import { epochMicros, parseDatetime } from '../http/datetimes.ts';
import { parseUuid } from '../http/uuid.ts';
import type { QueueTask } from '../queue/task-queue.ts';
import { record } from '../db/json.ts';
import { scalarText } from '../text-order.ts';
import { taskProject, type Executor } from '../workers/executor.ts';
import {
  MAX_WINDOW_DAYS,
  mergeOutcomes,
  observationKind,
  storedOutcomes,
  worthRecording,
} from './verification-decisions.ts';
import { evidenceFor, SOURCE_CHECK_KINDS, type Source } from './verification-evidence.ts';
import { buildVerificationResult, type Declaration } from './verification-result.ts';
const p = policy.opportunity.opportunities;
async function verificationSource(db: Database, task: QueueTask, project: string): Promise<Source> {
  const payload = record(task.payload);
  const kind = scalarText(payload.trigger_kind || '');
  const id = parseUuid(payload.trigger_id);
  if (!id) throw new Error('Implementation verification trigger is invalid');
  const scope = new WorkspaceScope(task.workspace_id);
  let observed: string | null | undefined;
  if (kind === 'site_crawl')
    observed = (
      await scope
        .selectFrom(db, 'site_crawls')
        .select(utcText(sql.ref('completed_at')).as('time'))
        .where('project_id', '=', project)
        .where('id', '=', id)
        .executeTakeFirst()
    )?.time;
  else if (kind === 'audit')
    observed = (
      await scope
        .selectFrom(db, 'audits')
        .select(utcText(sql.ref('completed_at')).as('time'))
        .where('project_id', '=', project)
        .where('id', '=', id)
        .executeTakeFirst()
    )?.time;
  else if (kind === 'traffic_snapshot')
    observed = (
      await scope
        .selectFrom(db, 'traffic_snapshots')
        .select(utcText(sql.ref('created_at')).as('time'))
        .where('project_id', '=', project)
        .where('id', '=', id)
        .executeTakeFirst()
    )?.time;
  else if (kind === 'search_intelligence_dataset')
    observed = (
      await scope
        .selectFrom(db, 'search_intelligence_datasets')
        .select(utcText(sql.ref('published_at')).as('time'))
        .where('project_id', '=', project)
        .where('id', '=', id)
        .where('status', '=', 'published')
        .executeTakeFirst()
    )?.time;
  else throw new Error('Implementation verification trigger kind is invalid');
  if (!observed) throw new Error('Implementation verification source is not terminal');
  return { kind, id, observed_at: `${observed}Z` };
}
/** Exact source timestamp used by verification idempotency. */
function sourceRevision(text: string): string {
  const parsed = parseDatetime(text);
  if (!parsed) throw new Error('Invalid verification timestamp');
  return epochMicros(parsed).toString();
}
/**
 * The declarations this source can still measure: declared before it was
 * observed, within the longest verification window, and holding a check of a
 * kind this source reads. Each check is then read only inside its own kind's
 * window. Everything else keeps its last observation untouched.
 */
async function declarations(
  db: Database,
  task: QueueTask,
  project: string,
  source: Source,
  after: Declaration | undefined,
): Promise<Declaration[]> {
  const kinds = SOURCE_CHECK_KINDS[source.kind] ?? [];
  if (!kinds.length) return [];
  let query = new WorkspaceScope(task.workspace_id)
    .selectFrom(db, 'opportunity_implementation_events')
    .selectAll()
    .select([
      utcText(sql.ref('created_at')).as('created_text'),
      utcText(sql.ref('declared_implemented_at')).as('declared_text'),
    ])
    .where('project_id', '=', project)
    .where('declared_implemented_at', '<=', sql<Date>`${source.observed_at}::timestamptz`)
    .where(
      'declared_implemented_at',
      '>=',
      sql<Date>`${source.observed_at}::timestamptz - ${MAX_WINDOW_DAYS} * interval '1 day'`,
    )
    .where((eb) =>
      eb.or(
        kinds.map((kind) => sql<boolean>`expected_checks @> ${JSON.stringify([{ kind }])}::jsonb`),
      ),
    );
  if (after)
    query = query.where((eb) =>
      eb.or([
        eb('created_at', '>', sql<Date>`${after.created_at}::timestamptz`),
        eb.and([
          eb('created_at', '=', sql<Date>`${after.created_at}::timestamptz`),
          eb('id', '>', after.id),
        ]),
      ]),
    );
  const rows = await query
    .orderBy('created_at')
    .orderBy('id')
    .limit(p.IMPLEMENTATION_VERIFICATION_BATCH_MAX)
    .execute();
  return rows.map((row) => ({
    ...row,
    created_at: `${row.created_text}Z`,
    declared_implemented_at: `${row.declared_text}Z`,
  }));
}

/**
 * Append one observation for a declaration, idempotently per source revision.
 * The declaration row is locked so two sources fold their states in order.
 */
async function recordVerification(
  db: Database,
  task: QueueTask,
  project: string,
  source: Source,
  declaration: Declaration,
) {
  await db.transaction().execute(async (trx) => {
    await trx
      .selectFrom('opportunity_implementation_events')
      .select('id')
      .where('workspace_id', '=', task.workspace_id)
      .where('id', '=', declaration.id)
      .forUpdate()
      .execute();
    const key = `verification:${declaration.id}:${source.kind}:${source.id}:${sourceRevision(source.observed_at)}:${p.IMPLEMENTATION_VERIFIER_VERSION}`;
    const latest = await trx
      .selectFrom('opportunity_verification_events')
      .select(['result', 'idempotency_key'])
      .where('workspace_id', '=', task.workspace_id)
      .where('implementation_event_id', '=', declaration.id)
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(1)
      .executeTakeFirst();
    if (latest?.idempotency_key === key) return;
    const result = await evidenceFor(trx, declaration, source);
    const previous = storedOutcomes(latest?.result);
    const merged = mergeOutcomes(previous, result.outcomes);
    if (!worthRecording(previous, result.outcomes, merged)) return;
    const total = Array.isArray(declaration.expected_checks)
      ? declaration.expected_checks.length
      : 0;
    const audit = source.kind === 'audit' ? source.id : null;
    const comparison = await buildVerificationResult(trx, declaration, audit);
    const checks = [...merged]
      .sort(([left], [right]) => left - right)
      .map(([index, item]) => ({ index, ...item }));
    const limitations = checks.flatMap((item) =>
      item.state === 'unavailable' && item.reason ? [item.reason] : [],
    );
    await trx
      .insertInto('opportunity_verification_events')
      .values({
        id: randomUUID(),
        workspace_id: task.workspace_id,
        project_id: project,
        implementation_event_id: declaration.id,
        observation_kind: observationKind(merged, total),
        observed_at: source.observed_at,
        // Wall-clock, not transaction start: the row lock above orders appends.
        created_at: sql`clock_timestamp()`,
        crawl_id: source.kind === 'site_crawl' ? source.id : null,
        audit_id: audit,
        source_analysis_ids: sql`${JSON.stringify([...result.analysis_ids])}::jsonb`,
        source_rule_evaluation_ids: sql`${JSON.stringify([...result.rule_evaluation_ids])}::jsonb`,
        source_metric_ids: sql`${JSON.stringify([...result.metric_ids])}::jsonb`,
        result: sql`${JSON.stringify({ ...comparison, checks })}::jsonb`,
        verifier_version: p.IMPLEMENTATION_VERIFIER_VERSION,
        limitations: sql`${JSON.stringify([...new Set(limitations)])}::jsonb`,
        idempotency_key: key,
      })
      .onConflict((oc) => oc.columns(['workspace_id', 'idempotency_key']).doNothing())
      .execute();
  });
}

/**
 * The queue claim is already committed. Each declaration folds in its own
 * short transaction; a retry repeats only what had not been appended.
 */
export const verifyImplementationEvents: Executor = async (task, context) => {
  const project = await taskProject(context.db, task);
  const source = await verificationSource(context.db, task, project);
  let after: Declaration | undefined;
  for (;;) {
    const rows = await declarations(context.db, task, project, source, after);
    for (const declaration of rows)
      await recordVerification(context.db, task, project, source, declaration); // NOSONAR -- One declaration at a time bounds the pool.
    if (rows.length < p.IMPLEMENTATION_VERIFICATION_BATCH_MAX) break;
    after = rows.at(-1);
    await context.checkCancelled('implementation verification'); // NOSONAR -- Between pages, in order.
  }
};
