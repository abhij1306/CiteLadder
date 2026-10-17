/**
 * `classify_referrals`: one provenance-stamped classification per event an
 * artifact ingested, then the chain's `ai_referrals_snapshot_refresh` link.
 *
 * Committed batches insert `ON CONFLICT (referral_event_id) DO NOTHING`, so a
 * re-run or a concurrent duplicate attempt never mutates a classification.
 * Cooperative cancel is honored at every batch boundary; committed batches
 * stay, and a later attempt resumes where the last one stopped.
 */
import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';

import { policy } from '../config.ts';
import { isoDateText } from '../db/timestamps.ts';
import { payloadArtifactId, requireProject, type Executor } from '../workers/executor.ts';
import { classifyReferralSignals } from './classification.ts';
import { enqueueAiReferralsSnapshotRefresh } from './enqueue.ts';
import { ownedArtifact } from './ingest.ts';

const { referrals } = policy;
const BATCH_SIZE = 500;

export const classifyReferrals: Executor = async (task, { db, checkCancelled, maxAttempts }) => {
  const projectId = requireProject(task);
  const artifact = await ownedArtifact(db, task.workspace_id, payloadArtifactId(task), projectId);
  // The refresh window comes from the artifact's sync run.
  const run = await db
    .selectFrom('integration_sync_runs')
    .select([
      'id',
      'resync_seq',
      isoDateText(sql.ref('window_start')).as('window_start'),
      isoDateText(sql.ref('window_end')).as('window_end'),
    ])
    .where('workspace_id', '=', task.workspace_id)
    .where('project_id', '=', projectId)
    .where('id', '=', artifact.sync_run_id)
    .executeTakeFirst();
  if (run === undefined) throw new Error(`unknown sync run: ${artifact.sync_run_id}`);

  for (;;) {
    await checkCancelled('batch');
    const events = await db
      .selectFrom('referral_events as event')
      .select([
        'event.id',
        'event.project_id',
        'event.referrer_host',
        'event.utm_source',
        'event.utm_medium',
        'event.user_agent',
      ])
      .where('event.workspace_id', '=', task.workspace_id)
      .where('event.project_id', '=', projectId)
      .where('event.import_id', '=', artifact.id)
      .where(({ not, exists, selectFrom }) =>
        not(
          exists(
            selectFrom('referral_classifications as classified')
              .select('classified.id')
              .whereRef('classified.referral_event_id', '=', 'event.id'),
          ),
        ),
      )
      .orderBy('event.occurred_at', 'asc')
      .orderBy('event.id', 'asc')
      .limit(BATCH_SIZE)
      .execute();
    if (events.length === 0) break;
    const now = new Date();
    await db
      .insertInto('referral_classifications')
      .values(
        events.map((event) => {
          // An unmatched event is `other` with empty match fields: never a guess.
          const match = classifyReferralSignals(event);
          return {
            id: randomUUID(),
            // The composite (workspace, event) key requires the event's workspace.
            workspace_id: task.workspace_id,
            project_id: event.project_id,
            referral_event_id: event.id,
            is_ai_referral: match !== null,
            ai_source: match?.ai_source ?? referrals.other_source,
            logical_engine: match?.logical_engine ?? null,
            matched_rule_id: match?.matched_rule_id ?? '',
            match_signal: match?.match_signal ?? '',
            confidence: match?.confidence ?? '',
            rule_version: referrals.rule_version,
            analyzer_version: referrals.analyzer_version,
            created_at: now,
          };
        }),
      )
      .onConflict((conflict) => conflict.column('referral_event_id').doNothing())
      .execute();
  }

  await enqueueAiReferralsSnapshotRefresh(db, {
    workspaceId: task.workspace_id,
    projectId,
    windowStart: run.window_start,
    windowEnd: run.window_end,
    resyncSeq: run.resync_seq,
    sourceRevision: run.id,
    maxAttempts,
  });
};
