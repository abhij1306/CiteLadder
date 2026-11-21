import { sql } from 'kysely';
import { describe, expect, it, vi } from 'vitest';

import { DRAIN_LOCK } from '../src/config/execution.ts';
import { createDatabase } from '../src/db/database.ts';
import { setLogSink } from '../src/logging.ts';
import { exclusiveDrain } from '../src/workers/runner.ts';
import { testConfig } from './support.ts';

const live = () => ({ signal: new AbortController().signal, deadline: Number.POSITIVE_INFINITY });

describe('exclusive drain on PostgreSQL', () => {
  it('admits one drain at a time and lets a later execution take over once it ends', async () => {
    const config = testConfig();
    const holding = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    const active = exclusiveDrain(
      config,
      live(),
      0,
    )(async () => {
      started.resolve();
      await holding.promise;
      return 3;
    });
    try {
      await started.promise;
      const blocked = vi.fn(async () => 1);
      expect(await exclusiveDrain(config, live(), 300)(blocked)).toBe(0);
      expect(blocked).not.toHaveBeenCalled();
      const waiting = exclusiveDrain(config, live(), 5_000)(async () => 2);
      holding.resolve();
      expect(await active).toBe(3);
      expect(await waiting).toBe(2);
    } finally {
      holding.resolve();
      await active.catch(() => undefined);
    }
  });

  it('returns what the drain did when its lock session is lost during the drain', async () => {
    const config = testConfig();
    const db = createDatabase(config);
    const prior = setLogSink(() => {});
    const holder = sql<{ pid: number }>`select pid from pg_locks
      where locktype = 'advisory' and granted
      and database = (select oid from pg_database where datname = current_database())
      and classid = ((hashtextextended(${DRAIN_LOCK}, 0) >> 32) & 4294967295)::oid
      and objid = (hashtextextended(${DRAIN_LOCK}, 0) & 4294967295)::oid
      and objsubid = 1`;
    try {
      const drained = await exclusiveDrain(
        config,
        live(),
        0,
      )(async () => {
        const [session] = (await holder.execute(db)).rows;
        await sql`select pg_terminate_backend(${session!.pid})`.execute(db);
        await vi.waitFor(async () => expect((await holder.execute(db)).rows).toEqual([]));
        return 3;
      });
      expect(drained).toBe(3);
    } finally {
      setLogSink(prior);
      await db.destroy();
    }
  });

  it('keeps the only pooled connection free for lanes that query the database', async () => {
    const config = testConfig({ RUNNER_DB_POOL_SIZE: '1', DB_POOL_TIMEOUT_SECONDS: '2' });
    const db = createDatabase(config, { execution: true });
    try {
      const drained = await exclusiveDrain(
        config,
        live(),
        0,
      )(async () => {
        const { rows } = await sql<{ one: number }>`select 1 as one`.execute(db);
        return rows[0]!.one;
      });
      expect(drained).toBe(1);
    } finally {
      await db.destroy();
    }
  });
});
