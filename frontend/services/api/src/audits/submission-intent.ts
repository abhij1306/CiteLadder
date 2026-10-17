import type { Database } from '../db/database.ts';
import { ProviderError } from '../answer-engines/contracts.ts';
import { ownedAuditTask, type AuditTask } from '../queue/audit-queue.ts';
import { searchPolicy } from '../search-surfaces/dataforseo.ts';
import type { ExecutionContext } from './execution-context.ts';

/** A committed intent is an irreversible handoff to GET/reconciliation, including after a crash. */
export function commitSubmissionIntent(
  db: Database,
  context: ExecutionContext,
  owner: string,
  at = new Date(),
) {
  return db.transaction().execute(async (trx) => {
    const locked = await ownedAuditTask(trx, context.task, owner);
    if (!locked) return null;
    if (locked.task.provider_submission_ref) return { fresh: false, task: locked.task };
    const connection = await trx
      .selectFrom('provider_connections')
      .select([
        'id',
        'credential_revision',
        'active',
        'paused_at',
        'pause_until',
        'last_test_status',
      ])
      .where('id', '=', context.connectionId)
      .where('workspace_id', '=', context.connectionWorkspaceId)
      .where('credential_source', '=', context.route.credential_source)
      .where('credential_revision', '=', context.revision)
      .forShare()
      .executeTakeFirst();
    if (
      !connection?.active ||
      connection.last_test_status !== 'ok' ||
      (connection.paused_at && (!connection.pause_until || connection.pause_until > at))
    )
      throw new ProviderError('connection_changed');
    const task = await trx
      .updateTable('audit_tasks')
      .set({
        provider_submission_ref: locked.task.idempotency_key.slice(
          0,
          searchPolicy.constants.tag_max_chars,
        ),
        provider_task_submitted_at: at,
        provider_connection_id: context.connectionId,
        provider_credential_revision: context.revision,
        updated_at: at,
      })
      .where('id', '=', locked.task.id)
      .where('workspace_id', '=', locked.task.workspace_id)
      .returningAll()
      .executeTakeFirstOrThrow();
    return { fresh: true, task };
  });
}
/** Scraper recovery always closes before the provider's 28-day task retention expires. */
export function surfaceRecoveryDeadline(task: AuditTask, hours: number): Date | null {
  if (
    !task.provider_task_submitted_at ||
    !['chatgpt_search', 'gemini_consumer'].includes(task.logical_engine)
  )
    return null;
  if (!(hours > 0 && hours < 24 * 28)) throw new Error('Invalid frozen recovery deadline');
  return new Date(task.provider_task_submitted_at.getTime() + hours * 3600000);
}
