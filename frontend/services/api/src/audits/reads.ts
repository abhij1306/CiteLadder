import { sql } from 'kysely';
import { auditSchema, executionSchema, auditMetricsSchema } from '@citeladder/contracts/audits';
import { auditEventSchema } from '@citeladder/contracts/audit-events';
import type { Database } from '../db/database.ts';
import { record, strings } from '../db/json.ts';
import { utcText, utcTextOf, wireUtc, wireUtcOrNull } from '../db/timestamps.ts';
import { notFound } from '../errors.ts';
import { modelProvenanceFor, executionFrozenProvenance } from '../analysis/provenance.ts';
import { engineSnapshots } from '../visibility/runs.ts';
import { firstOf } from '../lists.ts';
import { scalarText } from '../text-order.ts';

function auditQuery(db: Database, workspaceId: string) {
  return db
    .selectFrom('audits')
    .selectAll()
    .select([
      utcTextOf(sql.ref('created_at')).as('created_text'),
      utcTextOf(sql.ref('updated_at')).as('updated_text'),
      utcText(sql.ref('started_at')).as('started_text'),
      utcText(sql.ref('completed_at')).as('completed_text'),
    ])
    .where('workspace_id', '=', workspaceId);
}
export async function authorizedAudit(db: Database, workspaceId: string, auditId: string) {
  const audit = await auditQuery(db, workspaceId).where('id', '=', auditId).executeTakeFirst();
  if (!audit) throw notFound('Audit');
  return audit;
}
/** The market a run measured: its row's id and the country and language it froze. */
function frozenMarket(audit: { market_id: string | null; configuration: unknown }) {
  const config = record(audit.configuration);
  return {
    id: audit.market_id,
    country_code: typeof config.country_code === 'string' ? config.country_code : '',
    language_code: typeof config.language_code === 'string' ? config.language_code : '',
  };
}
async function auditResponses(db: Database, audits: Awaited<ReturnType<typeof authorizedAudit>>[]) {
  const routes = await engineSnapshots(
    db,
    audits.map((audit) => audit.id),
  );
  return audits.map((audit) =>
    auditSchema.parse({
      ...audit,
      engine_snapshots: routes.get(audit.id) ?? [],
      market: frozenMarket(audit),
      not_applicable_engines: strings(record(audit.configuration).not_applicable_engines),
      model_provenance: modelProvenanceFor(routes.get(audit.id) ?? [], audit.configuration),
      created_at: wireUtc(audit.created_text),
      updated_at: wireUtc(audit.updated_text),
      started_at: wireUtcOrNull(audit.started_text),
      completed_at: wireUtcOrNull(audit.completed_text),
    }),
  );
}
export async function readAudit(db: Database, workspaceId: string, auditId: string) {
  return firstOf(
    await auditResponses(db, [await authorizedAudit(db, workspaceId, auditId)]),
    'the response built for the loaded audit',
  );
}
/** The named audits in the given order: one launch's per-market runs. */
export async function readAudits(db: Database, workspaceId: string, auditIds: readonly string[]) {
  const rows = await auditQuery(db, workspaceId)
    .where('id', 'in', [...auditIds])
    .execute();
  const byId = new Map(rows.map((row) => [row.id, row]));
  const ordered = auditIds.map((id) => byId.get(id)).filter((row) => row !== undefined);
  if (ordered.length !== auditIds.length) throw notFound('Audit');
  return auditResponses(db, ordered);
}
export async function listAudits(
  db: Database,
  workspaceId: string,
  projectId?: string,
  limit = 50,
  /** Keyset: only audits ordered after this audit (newest first). */
  afterId?: string,
) {
  let query = auditQuery(db, workspaceId)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(limit);
  if (projectId) query = query.where('project_id', '=', projectId);
  if (afterId)
    query = query.where(
      sql<boolean>`(audits.created_at, audits.id) < (SELECT anchor.created_at, anchor.id FROM audits AS anchor WHERE anchor.id = ${afterId} AND anchor.workspace_id = ${workspaceId} AND anchor.project_id = audits.project_id)`,
    );
  return auditResponses(db, await query.execute());
}
export async function listExecutions(db: Database, workspaceId: string, auditId: string) {
  const audit = await authorizedAudit(db, workspaceId, auditId);
  const tasks = await db
    .selectFrom('audit_tasks')
    .selectAll()
    .select([
      utcTextOf(sql.ref('created_at')).as('created_text'),
      utcText(sql.ref('completed_at')).as('completed_text'),
    ])
    .where('workspace_id', '=', workspaceId)
    .where('audit_id', '=', auditId)
    .orderBy('randomized_position')
    .execute();
  return tasks.map((task) =>
    executionSchema.parse({
      ...task,
      created_at: wireUtc(task.created_text),
      completed_at: wireUtcOrNull(task.completed_text),
      retrieval_enabled: executionFrozenProvenance({
        requestSnapshot: task.request_snapshot,
        routeSnapshot: task.provider_route_snapshot,
        auditConfiguration: audit.configuration,
      }),
      search_surface_outcome: scalarText(
        record(task.provider_metadata).search_surface_outcome ?? '',
      ),
    }),
  );
}
export async function readAuditMetrics(db: Database, workspaceId: string, auditId: string) {
  await authorizedAudit(db, workspaceId, auditId);
  const metric = await db
    .selectFrom('metric_snapshots')
    .selectAll()
    .select(utcTextOf(sql.ref('created_at')).as('created_text'))
    .where('workspace_id', '=', workspaceId)
    .where('audit_id', '=', auditId)
    .executeTakeFirst();
  if (!metric) throw notFound('Audit metrics');
  return auditMetricsSchema.parse({ ...metric, created_at: wireUtc(metric.created_text) });
}
/** Validate a cursor within its authorized audit, then page using exact PostgreSQL timestamp/UUID order. */
export async function auditEvents(
  db: Database,
  workspaceId: string,
  auditId: string,
  after: string | undefined,
  limit: number,
) {
  await authorizedAudit(db, workspaceId, auditId);
  if (
    after &&
    !(await db
      .selectFrom('audit_events')
      .select('id')
      .where('id', '=', after)
      .where('audit_id', '=', auditId)
      .executeTakeFirst())
  )
    throw notFound('Audit');
  let query = db
    .selectFrom('audit_events')
    .selectAll()
    .select(utcTextOf(sql.ref('created_at')).as('created_text'))
    .where('audit_id', '=', auditId)
    .orderBy('created_at')
    .orderBy('id')
    .limit(limit);
  if (after) {
    const anchor = db
      .selectFrom('audit_events')
      .select('created_at')
      .where('id', '=', after)
      .where('audit_id', '=', auditId);
    query = query.where((eb) =>
      eb.or([
        eb('created_at', '>', anchor),
        eb.and([eb('created_at', '=', anchor), eb('id', '>', after)]),
      ]),
    );
  }
  return (await query.execute()).map((event) =>
    auditEventSchema.parse({
      id: event.id,
      audit_id: auditId,
      occurred_at: wireUtc(event.created_text),
      event_type: event.event_type,
      payload: event.event_type === 'audit.running' ? null : record(event.payload),
    }),
  );
}
