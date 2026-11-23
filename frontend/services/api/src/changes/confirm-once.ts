import { sql } from 'kysely';
import { policy } from '../config.ts';
import { subjectTryXactLock, subjectXactLock } from '../db/advisory-lock.ts';
import type { Database } from '../db/database.ts';
import { getLogger } from '../logging.ts';
import { maintainLease } from '../queue/heartbeat.ts';

type Steps<O, R> = Readonly<{
  open: (trx: Database) => Promise<O>;
  run: (db: Database, opened: O) => Promise<R>;
  record: (trx: Database, opened: O) => Promise<void>;
}>;

export type ConfirmOnce<O, R> =
  | (Steps<O, R> & Readonly<{ live: false }>)
  | (Steps<O, R> &
      Readonly<{
        live: true;
        subject: string;
        busy: () => Error;
        claimedAt: (trx: Database, opened: O) => Promise<Date | null>;
        claim: (trx: Database, opened: O) => Promise<Date>;
        release: (
          trx: Database,
          opened: O,
          failure: Readonly<{ error: unknown; owned: boolean }>,
        ) => Promise<void>;
      }>);

export const claimSeconds = () => policy.agent.live_change_claim_seconds;

async function databaseNow(trx: Database): Promise<Date> {
  const { rows } = await sql<{ now: Date }>`select clock_timestamp() as now`.execute(trx);
  const now = rows[0]?.now;
  if (!now) throw new Error('PostgreSQL returned no clock_timestamp()');
  return now;
}

const sameClaim = (current: Date | null, held: Date) => current?.getTime() === held.getTime();

export async function confirmOnce<O, R>(db: Database, steps: ConfirmOnce<O, R>): Promise<R> {
  if (!steps.live)
    return db.transaction().execute(async (trx) => {
      const opened = await steps.open(trx);
      const result = await steps.run(trx, opened);
      await steps.record(trx, opened);
      return result;
    });
  const claimed = await db.transaction().execute(async (trx) => {
    if (!(await subjectTryXactLock(trx, steps.subject))) throw steps.busy();
    const found = await steps.open(trx);
    const now = await databaseNow(trx);
    const standing = await steps.claimedAt(trx, found);
    if (standing && standing.getTime() > now.getTime() - claimSeconds() * 1000) throw steps.busy();
    return { opened: found, held: await steps.claim(trx, found) };
  });
  const { opened } = claimed;
  const lease = maintainLease(
    () =>
      db.transaction().execute(async (trx) => {
        await subjectXactLock(trx, steps.subject);
        if (!sameClaim(await steps.claimedAt(trx, opened), claimed.held)) return false;
        claimed.held = await steps.claim(trx, opened);
        return true;
      }),
    (claimSeconds() * 1000) / 3,
    (error) => getLogger('changes.confirm_once').exception('live_claim_renew_failed', error),
  );
  try {
    let result: R;
    try {
      result = await steps.run(db, opened);
    } finally {
      await lease.stop();
    }
    await db.transaction().execute((trx) => steps.record(trx, opened));
    return result;
  } catch (error) {
    await db.transaction().execute(async (trx) => {
      await subjectXactLock(trx, steps.subject);
      const owned = sameClaim(await steps.claimedAt(trx, opened), claimed.held);
      await steps.release(trx, opened, { error, owned });
    });
    throw error;
  }
}
