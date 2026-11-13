import type { Database } from '../db/database.ts';
import { record } from '../db/json.ts';
import { policy } from '../config.ts';
import { auditPolicy } from '../audits/config.ts';
import type { DeriveExecution } from '../audits/result-persistence.ts';
import type { MeterableShelfResolver } from './shelf.ts';
import { frozenRevisionId, frozenVersions, prepareShelfExecution } from './shelf.ts';

/**
 * Older writers saved answers before derivation. Prepare recovery outside the
 * audit transaction for every succeeded answer that no pass covers yet under
 * the audit's frozen versions: Commerce audits, and any audit that froze a
 * catalog revision. A backfill pass counts, so recovery never spends resolver
 * quota on an answer whose derivation would be discarded.
 */
export async function prepareSavedShelf(
  db: Database,
  workspaceId: string,
  auditId: string,
  resolver?: MeterableShelfResolver | null,
) {
  const prepared = new Map<string, DeriveExecution>();
  const audit = await db
    .selectFrom('audits')
    .selectAll()
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', auditId)
    .executeTakeFirst();
  if (
    !audit ||
    (audit.audit_scope !== 'commerce' && !frozenRevisionId(audit.configuration)) ||
    auditPolicy.constants.audit_terminal_statuses.includes(audit.status)
  )
    return prepared;
  const tasks = await db
    .selectFrom('audit_tasks')
    .selectAll()
    .where('workspace_id', '=', workspaceId)
    .where('audit_id', '=', auditId)
    .execute();
  if (tasks.some((task) => !policy.task_queue.terminal.includes(task.status))) return prepared;
  const config = record(audit.configuration);
  const passes = await db
    .selectFrom('commerce_match_passes')
    .select(['task_id', 'artifact_id', 'parser_version', 'matcher_version'])
    .where('workspace_id', '=', workspaceId)
    .where('audit_id', '=', auditId)
    .execute();
  const { parser, matcher } = frozenVersions(
    record(
      audit.audit_scope === 'commerce' ? config.commerce_measurement : config.commerce_catalog,
    ),
  );
  for (const task of tasks) {
    if (
      task.status !== 'succeeded' ||
      !task.result_artifact_id ||
      passes.some(
        (row) =>
          row.task_id === task.id &&
          row.artifact_id === task.result_artifact_id &&
          row.parser_version === parser &&
          row.matcher_version === matcher,
      )
    )
      continue;
    const artifact = await db
      .selectFrom('raw_response_artifacts')
      .select('answer_text')
      .where('id', '=', task.result_artifact_id)
      .where('task_id', '=', task.id)
      .where('audit_id', '=', auditId)
      .executeTakeFirstOrThrow();
    prepared.set(task.id, await prepareShelfExecution(db, task, artifact, resolver));
  }
  return prepared;
}
