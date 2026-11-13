/**
 * `referral_retention_sweep`: hard-delete one workspace's referral data older
 * than the retention horizon, classifications first (foreign-key order), in
 * bounded committed batches with cooperative cancel at each boundary. A re-run
 * simply finds less to delete.
 */
import { DAY_MS } from '../calendar-days.ts';
import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { payloadString, type Executor } from '../queue/executor.ts';

const BATCH_SIZE = 500;

/** The next batch of one workspace's referral events dated before `cutoff`, oldest first. */
export function expiredBatch(db: Database, workspaceId: string, cutoff: Date) {
  return db
    .selectFrom('referral_events')
    .select('id')
    .where('workspace_id', '=', workspaceId)
    .where('occurred_at', '<', cutoff)
    .orderBy('occurred_at', 'asc')
    .orderBy('id', 'asc')
    .limit(BATCH_SIZE);
}

export const referralRetentionSweep: Executor = async (task, { db, checkCancelled }) => {
  if (payloadString(task, 'sweep_key') === null) {
    throw new Error(`${task.task_kind} payload missing sweep_key`);
  }
  // One fixed, day-aligned horizon per run: the cutoff never drifts mid-sweep,
  // and an event dated on the first day of the longest Performance window
  // (ending yesterday) is stored at midnight, so the cutoff is that day's start.
  const today = Math.floor(Date.now() / DAY_MS) * DAY_MS;
  const cutoff = new Date(today - policy.referrals.retention_days * DAY_MS);
  for (;;) {
    await checkCancelled('batch');
    const deleted = await db.transaction().execute(async (trx) => {
      const expired = await expiredBatch(trx, task.workspace_id, cutoff).execute();
      const ids = expired.map((row) => row.id);
      if (ids.length === 0) return 0;
      await trx
        .deleteFrom('referral_classifications')
        .where('referral_event_id', 'in', ids)
        .execute();
      await trx.deleteFrom('referral_events').where('id', 'in', ids).execute();
      return ids.length;
    });
    if (deleted === 0) return;
  }
};
