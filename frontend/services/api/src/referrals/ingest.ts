/**
 * `ingest_referrals`: one import artifact's GA4 referral rows as immutable,
 * sanitized `referral_events`, then the chain's `classify_referrals` link.
 *
 * One transaction reads the artifact's latest-revision rows, inserts the
 * events `ON CONFLICT (import_id, content_hash) DO NOTHING` (a re-run is a
 * no-op, never an overwrite) and enqueues classification. This executor is
 * the single writer of `referral_events`.
 */
import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { isoDateText } from '../db/timestamps.ts';
import { payloadArtifactId, requireProject, type Executor } from '../workers/executor.ts';
import { enqueueClassifyReferrals } from './enqueue.ts';
import { referralEventFields } from './events.ts';
import { compareText } from '../text-order.ts';
import { selectedPartition } from '../integrations/partitions.ts';

const { referrals } = policy;
const REFERRAL_DATASETS = Object.values(referrals.datasets).sort(compareText);
// Rows per INSERT, well inside PostgreSQL's bind-parameter limit.
const INSERT_CHUNK = 1000;

/** The workspace's import artifact, or an error that fails the attempt. */
export async function ownedArtifact(
  db: Database,
  workspaceId: string,
  artifactId: string,
  projectId: string,
) {
  const artifact = await db
    .selectFrom('integration_import_artifacts as artifact')
    .innerJoin('integration_sync_runs as run', (join) =>
      join
        .onRef('run.id', '=', 'artifact.sync_run_id')
        .onRef('run.workspace_id', '=', 'artifact.workspace_id'),
    )
    .select(['artifact.id', 'artifact.provider', 'artifact.sync_run_id'])
    .where('artifact.workspace_id', '=', workspaceId)
    .where('artifact.id', '=', artifactId)
    .where('run.project_id', '=', projectId)
    .executeTakeFirst();
  // Never project rows for an artifact outside the claimed task's workspace.
  if (artifact === undefined) {
    throw new Error(`unknown import artifact: ${artifactId}`);
  }
  return artifact;
}

/**
 * The artifact's rows in the selected complete partition revision.
 */
function latestReferralRows(
  db: Database,
  artifactId: string,
  workspaceId: string,
  projectId: string,
) {
  return db
    .selectFrom('integration_metric_rows as row')
    .select([
      'row.id',
      'row.dataset',
      'row.dimension_key',
      isoDateText(sql.ref('row.date')).as('date'),
    ])
    .where('row.source_artifact_id', '=', artifactId)
    .where('row.workspace_id', '=', workspaceId)
    .where('row.project_id', '=', projectId)
    .where('row.dataset', 'in', REFERRAL_DATASETS)
    .where(selectedPartition('row'))
    .orderBy('row.date', 'asc')
    .orderBy('row.id', 'asc')
    .execute();
}

export const ingestReferrals: Executor = async (task, { db, maxAttempts }) => {
  const projectId = requireProject(task);
  const artifactId = payloadArtifactId(task);
  await db.transaction().execute(async (trx) => {
    const artifact = await ownedArtifact(trx, task.workspace_id, artifactId, projectId);
    const now = new Date();
    const events = (
      await latestReferralRows(trx, artifact.id, task.workspace_id, projectId)
    ).flatMap((row) => {
      const fields = referralEventFields(row);
      if (fields === null) return [];
      return [
        {
          ...fields,
          id: randomUUID(),
          workspace_id: task.workspace_id,
          project_id: projectId,
          source: artifact.provider,
          import_id: artifact.id,
          source_metric_row_id: row.id,
          // Provider data is date-grained: the UTC instant of the row's date.
          occurred_at: `${row.date}T00:00:00Z`,
          raw: JSON.stringify(fields.raw),
          sanitize_version: referrals.sanitize_version,
          ingested_at: now,
        },
      ];
    });
    for (let start = 0; start < events.length; start += INSERT_CHUNK) {
      await trx
        .insertInto('referral_events')
        .values(events.slice(start, start + INSERT_CHUNK))
        .onConflict((conflict) => conflict.columns(['import_id', 'content_hash']).doNothing())
        .execute();
    }
    await enqueueClassifyReferrals(trx, {
      workspaceId: task.workspace_id,
      projectId,
      artifactId: artifact.id,
      maxAttempts,
    });
  });
};
