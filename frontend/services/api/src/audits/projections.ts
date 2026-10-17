import type { Database } from '../db/database.ts';
import { analyzeExecution } from '../analysis/execution.ts';
import { finalizeAudit } from '../analysis/finalization.ts';
import { prepareShelfExecution } from '../commerce/shelf.ts';
import { finalizeCommerceShelf } from '../commerce/shelf-metrics.ts';
import type { MeterableShelfResolver } from '../commerce/shelf.ts';
import type { ExecutionContext } from './execution-context.ts';
import type { ExecutionResult } from './result-persistence.ts';
import { enqueueTask } from '../referrals/enqueue.ts';
import { policy, resolveSettingSpec } from '../config.ts';
import { getLogger } from '../logging.ts';
import { prepareSavedShelf } from '../commerce/shelf-recovery.ts';

/** Compose existing deterministic analysis, bounded shelf preparation and persisted downstream work. */
export function auditProjections(
  db: Database,
  resolver?: MeterableShelfResolver | null,
  env: Record<string, string | undefined> = process.env,
) {
  return {
    execution: analyzeExecution,
    prepare: (context: ExecutionContext, result: ExecutionResult) =>
      prepareShelfExecution(db, context.task, result, resolver),
    finalize: async (workspaceId: string, auditId: string) => {
      const prepared = await prepareSavedShelf(db, workspaceId, auditId, resolver);
      const result = await finalizeAudit(
        db,
        workspaceId,
        auditId,
        finalizeCommerceShelf,
        new Date(),
        (trx, task, audit, artifactId) =>
          (prepared.get(task.id) ?? analyzeExecution)(trx, task, audit, artifactId),
      );
      await enqueueSourcePageInspection(db, workspaceId, auditId, env);
      return result;
    },
  };
}

/** A finished audit queues its source-page inspection; an enqueue failure never fails finalize. */
async function enqueueSourcePageInspection(
  db: Database,
  workspaceId: string,
  auditId: string,
  env: Record<string, string | undefined>,
) {
  const audit = await db
    .selectFrom('audits')
    .select(['project_id', 'status'])
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', auditId)
    .executeTakeFirst();
  if (!audit || !['completed', 'partially_completed'].includes(audit.status)) return;
  try {
    await enqueueTask(db, {
      workspaceId,
      projectId: audit.project_id,
      kind: 'source_page_inspection',
      payload: { audit_id: auditId },
      keyParts: [audit.project_id, auditId],
      maxAttempts: Number(
        resolveSettingSpec(policy.analytics.worker_settings.task_max_attempts, env),
      ),
    });
  } catch {
    getLogger('workers.audit').info('source_page_inspection_enqueue_failed', {
      audit_id: auditId,
    });
  }
}
