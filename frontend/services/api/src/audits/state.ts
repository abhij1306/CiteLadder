import { randomUUID } from 'node:crypto';
import type { Database } from '../db/database.ts';
import { ApiError, notFound } from '../errors.ts';
import { auditPolicy } from './config.ts';

/** Caller holds the audit row lock; status and its event commit together. */
export async function transitionAudit(
  db: Database,
  workspaceId: string,
  auditId: string,
  target: string,
  at: Date,
  message = '',
) {
  const audit = await db
    .selectFrom('audits')
    .select(['id', 'status'])
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', auditId)
    .forUpdate()
    .executeTakeFirst();
  if (!audit) throw notFound('Audit');
  const transitions: Record<string, readonly string[]> = auditPolicy.transitions;
  if (
    !transitions[audit.status] ||
    (audit.status !== target && !transitions[audit.status]!.includes(target))
  )
    throw new ApiError(409, `Invalid audit transition: ${audit.status} -> ${target}`);
  if (audit.status === target) return;
  await db
    .updateTable('audits')
    .set({ status: target, updated_at: at })
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', auditId)
    .execute();
  await auditEvent(
    db,
    auditId,
    auditPolicy.constants.event_audit_status,
    message || `status -> ${target}`,
    { status: target },
    at,
  );
}
export function auditEvent(
  db: Database,
  auditId: string,
  type: string,
  message: string,
  payload: Record<string, unknown>,
  at: Date,
) {
  return db
    .insertInto('audit_events')
    .values({
      id: randomUUID(),
      audit_id: auditId,
      event_type: type,
      message,
      payload: JSON.stringify(payload),
      created_at: at,
    })
    .execute();
}
