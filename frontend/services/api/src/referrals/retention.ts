/**
 * `referral_retention_sweep`: hard-delete one workspace's referral data older
 * than the retention horizon, classifications first (foreign-key order), in
 * bounded committed batches with cooperative cancel at each boundary. A re-run
 * simply finds less to delete.
 */
import { policy } from '../config.ts';
import { payloadString, type Executor } from '../workers/executor.ts';

const BATCH_SIZE = 500;
const DAY_MS = 86_400_000;

export const referralRetentionSweep: Executor = async (task, { db, checkCancelled }) => {
  if (payloadString(task, 'sweep_key') === null) {
    throw new Error(`${task.task_kind} payload missing sweep_key`);
  }
  // One fixed horizon per run: the cutoff never drifts mid-sweep.
  const cutoff = new Date(Date.now() - policy.referrals.retention_days * DAY_MS);
  for (;;) {
    await checkCancelled('batch');
    const deleted = await db.transaction().execute(async (trx) => {
      const expired = await trx
        .selectFrom('referral_events')
        .select('id')
        .where('workspace_id', '=', task.workspace_id)
        .where('occurred_at', '<', cutoff)
        .orderBy('occurred_at', 'asc')
        .orderBy('id', 'asc')
        .limit(BATCH_SIZE)
        .execute();
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
