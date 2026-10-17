import type { Database } from '../db/database.ts';
import { record } from '../db/json.ts';
import { policy } from '../config.ts';
import { scalarText } from '../text-order.ts';
import { auditPolicy } from '../audits/config.ts';
import type { DeriveExecution } from '../audits/result-persistence.ts';
import type { MeterableShelfResolver } from './shelf.ts';
import { prepareShelfExecution } from './shelf.ts';

/** Older writers saved answers before derivation. Prepare recovery outside the audit transaction. */
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
    audit?.audit_scope !== 'commerce' ||
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
  const frozen = record(record(audit.configuration).commerce_measurement);
  const versions = auditPolicy.commerce_versions;
  const observations = await db
    .selectFrom('commerce_recommendation_observations')
    .select(['task_id', 'artifact_id'])
    .where('workspace_id', '=', workspaceId)
    .where('audit_id', '=', auditId)
    .where('parser_version', '=', scalarText(frozen.parser_version ?? versions.parser_version))
    .where('matcher_version', '=', scalarText(frozen.matcher_version ?? versions.matcher_version))
    .execute();
  for (const task of tasks) {
    if (
      task.status !== 'succeeded' ||
      !task.result_artifact_id ||
      observations.some(
        (row) => row.task_id === task.id && row.artifact_id === task.result_artifact_id,
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
