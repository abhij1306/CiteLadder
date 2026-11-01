import { setTimeout as sleep } from 'node:timers/promises';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import {
  drainLanes,
  exclusiveDrain,
  idlePause,
  LaneFailures,
  tickAndDrain,
  runnerOwners,
} from '../src/workers/runner.ts';
import { SiteHealthWorker } from '../src/workers/site-health-worker.ts';
import { AnalyticsWorker } from '../src/workers/analytics-worker.ts';
import { AuditWorker } from '../src/workers/audit-worker.ts';
import { AuditMaintenance } from '../src/audits/maintenance.ts';
import { SiteFixtures } from './site-health-fixtures.ts';
import { siteWorkerSettings } from '../src/site-health/runtime.ts';
import { sql } from 'kysely';
import { createDatabase } from '../src/db/database.ts';
import { testConfig } from './support.ts';
import { executionSettings } from '../src/config/execution.ts';
import { setLogSink } from '../src/logging.ts';

const options = () => ({
  signal: new AbortController().signal,
  deadline: 100,
  now: () => 0,
  firstLane: 0,
});

describe('bounded runner', () => {
  it('settles a Site Health batch with queued heartbeats under the real runner pool bound', async () => {
    const config = testConfig({ RUNNER_DB_POOL_SIZE: '4' });
    const db = createDatabase(config, { execution: true });
    const fixtures = new SiteFixtures(db);
    try {
      const ids = [];
      for (let index = 0; index < config.execution.poolSize; index++) {
        const seed = await fixtures.crawl('running');
        ids.push(await fixtures.task(seed));
      }
      const worker = new SiteHealthWorker(db, {
        settings: { ...siteWorkerSettings({}), concurrency: 4, heartbeat: 0.01 },
        executors: {
          link_metrics: async (trx) => {
            await sql`select pg_sleep(0.2)`.execute(trx);
          },
        },
      });
      const heartbeat = vi.spyOn(worker.queue, 'heartbeat');
      expect(await worker.runOnce(config.execution.poolSize)).toBe(4);
      const rows = await db
        .selectFrom('site_crawl_tasks')
        .select(['id', 'status', 'attempt_count', 'lease_owner'])
        .where('id', 'in', ids)
        .execute();
      expect(rows).toHaveLength(4);
      expect(
        rows.every(
          (row) =>
            row.status === 'succeeded' && row.attempt_count === 1 && row.lease_owner === null,
        ),
      ).toBe(true);
      expect(heartbeat).toHaveBeenCalled();
    } finally {
      await fixtures.cleanup();
      await db.destroy();
    }
  });
  it.each([1, 8])(
    'bounds Site Health batches by its policy and the pool (worker limit %i)',
    async (concurrency) => {
      const config = testConfig({ SITE_HEALTH_WORKER_CONCURRENCY: String(concurrency) });
      const db = createDatabase(config, { execution: true });
      const run = vi.spyOn(SiteHealthWorker.prototype, 'drain').mockResolvedValue(0);
      try {
        const owners = await runnerOwners(db, config);
        await owners.lanes.find((lane) => lane.name === 'site-health')!.run(() => true);
        expect(run).toHaveBeenCalledWith(
          Math.min(concurrency, config.execution.poolSize),
          expect.any(Function),
        );
      } finally {
        run.mockRestore();
        await db.destroy();
      }
    },
  );
  it('claims audits while the Site Health lane holds the runner, but never overlaps crawlers', async () => {
    const config = testConfig({});
    const db = createDatabase(config, { execution: true });
    const audited = Promise.withResolvers<void>();
    const seen: string[] = [];
    let crawling = 0;
    const crawl = (name: string) => async () => {
      if (seen.includes(name)) return 0;
      crawling++;
      seen.push(crawling > 1 ? `${name} overlapped` : name);
      if (name === 'site-health') await Promise.race([audited.promise, sleep(1000)]);
      crawling--;
      return 1;
    };
    const spies = [
      vi.spyOn(SiteHealthWorker.prototype, 'drain').mockImplementation(crawl('site-health')),
      vi.spyOn(AnalyticsWorker.prototype, 'runOnce').mockImplementation(crawl('analytics')),
      vi.spyOn(AuditMaintenance.prototype, 'recoverLeases').mockResolvedValue(0),
      vi.spyOn(AuditWorker.prototype, 'drain').mockImplementation(async () => {
        if (seen.some((step) => step.startsWith('audits'))) return 0;
        seen.push(crawling ? 'audits while crawling' : 'audits');
        audited.resolve();
        return 1;
      }),
    ];
    try {
      const owners = await runnerOwners(db, config);
      const lanes = owners.lanes.filter((lane) =>
        ['site-health', 'audits', 'analytics'].includes(lane.name),
      );
      const site = lanes.findIndex((lane) => lane.name === 'site-health');
      expect(await drainLanes(lanes, { ...options(), firstLane: site })).toBe(3);
      expect(seen).toEqual(['site-health', 'audits while crawling', 'analytics']);
    } finally {
      for (const spy of spies) spy.mockRestore();
      await db.destroy();
    }
  });
  it('passes the same live budget to periodic work and stops within a phase', async () => {
    let clock = 0;
    let processed = 0;
    const drain = vi.fn(async () => 0);
    await tickAndDrain(
      {
        periodic: [
          {
            name: 'batch',
            run: async (canAdmit) => {
              while (canAdmit()) {
                processed++;
                clock = 101;
              }
            },
          },
        ],
        lanes: [{ name: 'tasks', run: drain }],
      },
      { ...options(), now: () => clock },
    );
    expect(processed).toBe(1);
    expect(drain).not.toHaveBeenCalled();
  });
  it('keeps an idle drain until deferred work is due within the budget', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-07T00:00:00Z') });
    onTestFinished(() => {
      vi.useRealTimers();
    });
    let due: Date | null = new Date(Date.now() + 2000);
    let deferred = 1;
    const pauses: number[] = [];
    const tasks = await drainLanes(
      [
        {
          name: 'site-health',
          run: async () => {
            if (!deferred || pauses.length === 0) return 0;
            deferred = 0;
            due = null;
            return 1;
          },
          nextDue: async () => due,
        },
      ],
      { ...options(), deadline: 10_000, pause: async (ms) => pauses.push(ms) },
    );
    expect(tasks).toBe(1);
    expect(pauses).toEqual([2000]);
  });

  it('leaves work due after the deadline instead of pausing past it', async () => {
    const pause = vi.fn(async () => undefined);
    const tasks = await drainLanes(
      [
        {
          name: 'site-health',
          run: async () => 0,
          nextDue: async () => new Date(Date.now() + 60_000),
        },
      ],
      { ...options(), deadline: 10_000, pause },
    );
    expect(tasks).toBe(0);
    expect(pause).not.toHaveBeenCalled();
  });

  it('pauses only within the remaining budget and backs off on due-but-unclaimed work', () => {
    expect(idlePause(null, 10_000, 5000)).toBeNull();
    expect(idlePause(40, 300, 5000)).toBe(40);
    // A due row another claimer holds must not spin, nor pause past the deadline.
    expect(idlePause(0, 10_000, 5000)).toBe(250);
    expect(idlePause(0, 200, 5000)).toBeNull();
    expect(idlePause(60_000, 300_000, 5000)).toBe(5000);
    expect(idlePause(9000, 8000, 5000)).toBeNull();
  });

  it('reports the earlier of deferred Site Health work and a lease that will expire', async () => {
    const db = createDatabase(testConfig({}), { execution: true });
    const fixtures = new SiteFixtures(db);
    try {
      const seed = await fixtures.crawl('running');
      const worker = new SiteHealthWorker(db, {
        taskScope: { workspaceId: seed.workspaceId, crawlId: seed.crawlId },
      });
      expect(await worker.nextDue()).toBeNull();
      const later = new Date(Date.now() + 30_000);
      const expiry = new Date(Date.now() + 5000);
      const [deferred, running] = [await fixtures.task(seed), await fixtures.task(seed)];
      await db
        .updateTable('site_crawl_tasks')
        .set({ available_at: later })
        .where('id', '=', deferred)
        .execute();
      await db
        .updateTable('site_crawl_tasks')
        .set({ status: 'running', lease_owner: 'dead-worker', lease_expires_at: expiry })
        .where('id', '=', running)
        .execute();
      // A killed holder's lease is recovered at expiry, so the runner must stay for it.
      expect((await worker.nextDue())?.getTime()).toBe(expiry.getTime());
      await db
        .updateTable('site_crawl_tasks')
        .set({ status: 'succeeded', lease_owner: null, lease_expires_at: null })
        .where('id', '=', running)
        .execute();
      expect((await worker.nextDue())?.getTime()).toBe(later.getTime());
    } finally {
      await fixtures.cleanup();
      await db.destroy();
    }
  });

  it('releases a contended Site Health task without failing the lane or charging an attempt', async () => {
    const db = createDatabase(testConfig({}), { execution: true });
    const fixtures = new SiteFixtures(db);
    const restore = setLogSink(() => {});
    try {
      const seed = await fixtures.crawl('running');
      const id = await fixtures.task(seed);
      const lockTimeout = () => Object.assign(new Error('lock timeout'), { code: '55P03' });
      const worker = new SiteHealthWorker(db, {
        taskScope: { workspaceId: seed.workspaceId, crawlId: seed.crawlId },
        executors: {
          link_metrics: async () => {
            throw lockTimeout();
          },
        },
      });
      // A sibling still holds the crawl lock when the failure is settled.
      vi.spyOn(worker, 'fail').mockRejectedValueOnce(lockTimeout());
      expect(await worker.runOnce(1)).toBe(1);
      expect(
        await db
          .selectFrom('site_crawl_tasks')
          .select(['status', 'attempt_count', 'conflict_count', 'lease_owner', 'error_code'])
          .where('id', '=', id)
          .executeTakeFirstOrThrow(),
      ).toEqual({
        status: 'retry_wait',
        attempt_count: 0,
        conflict_count: 1,
        lease_owner: null,
        error_code: 'db_conflict',
      });
    } finally {
      setLogSink(restore);
      await fixtures.cleanup();
      await db.destroy();
    }
  });

  it('names the failed lanes so the others can still get a successor', async () => {
    const restore = setLogSink(() => {});
    try {
      const error = await drainLanes(
        [
          {
            name: 'bad',
            run: async () => {
              throw new Error('database unavailable');
            },
          },
          { name: 'good', run: vi.fn().mockResolvedValueOnce(1).mockResolvedValue(0) },
        ],
        options(),
      ).catch((caught: unknown) => caught);
      if (!(error instanceof LaneFailures)) throw new Error('expected lane failures');
      expect([...error.lanes]).toEqual(['bad']);
      expect(error.tasks).toBe(1);
    } finally {
      setLogSink(restore);
    }
  });

  it('drains successors into earlier lanes before declaring idle', async () => {
    let earlier = 0,
      later = 1;
    const seen: string[] = [];
    const tasks = await drainLanes(
      [
        {
          name: 'earlier',
          run: async () => {
            seen.push('earlier');
            const count = earlier;
            earlier = 0;
            return count;
          },
        },
        {
          name: 'later',
          run: async () => {
            seen.push('later');
            if (!later) return 0;
            later--;
            earlier++;
            return 1;
          },
        },
      ],
      options(),
    );
    expect(tasks).toBe(2);
    expect(seen).toEqual(['earlier', 'later', 'earlier', 'later', 'earlier', 'later']);
  });

  it("runs one lane's queued work while another lane holds its claim window", async () => {
    const released = Promise.withResolvers<void>();
    const order: string[] = [];
    let queued = 3;
    const tasks = await drainLanes(
      [
        {
          name: 'site-health',
          run: async () => {
            if (order.includes('site claimed')) return 0;
            order.push('site claimed');
            // The pre-fix sequential drain reaches the audits only after this window.
            await Promise.race([released.promise, sleep(1000)]);
            order.push('site settled');
            return 1;
          },
        },
        {
          name: 'audits',
          run: async () => {
            if (!queued) {
              released.resolve();
              return 0;
            }
            queued--;
            order.push('audit');
            return 1;
          },
        },
      ],
      { ...options(), deadline: Number.POSITIVE_INFINITY },
    );
    expect(tasks).toBe(4);
    expect(order).toEqual(['site claimed', 'audit', 'audit', 'audit', 'site settled']);
  });

  it('lets grouped lanes take turns while an ungrouped lane runs alongside', async () => {
    const order: string[] = [];
    let crawling = 0;
    let overlapped = false;
    const crawler = (name: string) => {
      let left = 2;
      return {
        name,
        group: 'web-fetch',
        run: async () => {
          if (!left) return 0;
          left--;
          crawling++;
          overlapped ||= crawling > 1;
          order.push(name);
          await sleep(10);
          crawling--;
          return 1;
        },
      };
    };
    let auditsAlongside = false;
    let audited = false;
    await drainLanes(
      [
        crawler('analytics'),
        crawler('site-health'),
        {
          name: 'audits',
          run: async () => {
            if (audited) return 0;
            audited = true;
            auditsAlongside = crawling === 1;
            return 1;
          },
        },
      ],
      { ...options(), deadline: Number.POSITIVE_INFINITY },
    );
    expect(order).toEqual(['analytics', 'site-health', 'analytics', 'site-health']);
    expect(overlapped).toBe(false);
    expect(auditsAlongside).toBe(true);
  });

  it('polls an idle lane for new work while another lane stays busy', async () => {
    let busy = true;
    let picked = 0;
    let queued = 0;
    await drainLanes(
      [
        {
          name: 'site-health',
          run: async () => {
            if (!busy) return 0;
            // New audit work is committed after the audits lane went idle.
            setTimeout(() => (queued = 1), 20);
            await sleep(200);
            busy = false;
            return 1;
          },
        },
        {
          name: 'audits',
          run: async () => {
            if (!queued) return 0;
            queued = 0;
            picked = Number(busy);
            return 1;
          },
        },
      ],
      { ...options(), deadline: Number.POSITIVE_INFINITY, idlePollMs: 50 },
    );
    // Picked up within the poll interval, before the busy lane returned.
    expect(picked).toBe(1);
  });

  it.each(['deadline', 'signal'])(
    'finishes claimed work but admits nothing after %s',
    async (reason) => {
      let clock = 0;
      const stop = new AbortController();
      const second = vi.fn(async () => 1);
      const completed: string[] = [];
      await drainLanes(
        [
          {
            name: 'first',
            run: async () => {
              if (reason === 'signal') stop.abort();
              else clock = 101;
              await Promise.resolve();
              completed.push('settled');
              return 1;
            },
          },
          { name: 'second', run: second },
        ],
        { ...options(), signal: stop.signal, now: () => clock },
      );
      expect(completed).toEqual(['settled']);
      expect(second).not.toHaveBeenCalled();
    },
  );

  it('tries independent owners once after a lane failure and reports failure', async () => {
    const bad = vi.fn(async () => {
      throw new Error('database unavailable');
    });
    const good = vi.fn().mockResolvedValueOnce(1).mockResolvedValue(0);
    const restore = setLogSink(() => {});
    try {
      await expect(
        drainLanes(
          [
            { name: 'bad', run: bad },
            { name: 'good', run: good },
          ],
          options(),
        ),
      ).rejects.toThrow('Runner lanes failed');
      expect(bad).toHaveBeenCalledTimes(1);
      expect(good).toHaveBeenCalledTimes(2);
    } finally {
      setLogSink(restore);
    }
  });

  it('runs periodic work once before draining, and preserves remaining budget', async () => {
    let clock = 0;
    const seen: string[] = [];
    await tickAndDrain(
      {
        periodic: [
          {
            name: 'schedules',
            run: async () => {
              seen.push('scheduled');
              clock = 60;
            },
          },
        ],
        lanes: [
          {
            name: 'tasks',
            run: async () => {
              seen.push('settled');
              clock = 101;
              return 1;
            },
          },
        ],
      },
      { ...options(), now: () => clock },
    );
    expect(seen).toEqual(['scheduled', 'settled']);
  });

  it('still drains and runs other phases after one periodic owner fails', async () => {
    const completed = vi.fn(async () => 0);
    const restore = setLogSink(() => {});
    try {
      await expect(
        tickAndDrain(
          {
            periodic: [
              {
                name: 'failed',
                run: async () => {
                  throw new Error('failed');
                },
              },
              { name: 'other', run: completed },
            ],
            lanes: [{ name: 'drain', run: completed }],
          },
          options(),
        ),
      ).rejects.toThrow('Tick failed');
      expect(completed).toHaveBeenCalledTimes(2);
    } finally {
      setLogSink(restore);
    }
  });
});

it('refuses unbounded pools and budgets', () => {
  expect(() => executionSettings({ RUNNER_DB_POOL_SIZE: '5' })).toThrow();
  expect(() => executionSettings({ RUNNER_BUDGET_SECONDS: '0' })).toThrow();
  expect(executionSettings({})).toMatchObject({ budgetSeconds: 300, poolSize: 4 });
});

describe('exclusive drain on PostgreSQL', () => {
  const live = () => ({ signal: new AbortController().signal, deadline: Number.POSITIVE_INFINITY });

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
      // A concurrent execution gives up without draining while the lock is held.
      expect(await exclusiveDrain(config, live(), 300)(blocked)).toBe(0);
      expect(blocked).not.toHaveBeenCalled();
      // A waiting execution proceeds as soon as the active drain releases.
      const waiting = exclusiveDrain(config, live(), 5_000)(async () => 2);
      holding.resolve();
      expect(await active).toBe(3);
      expect(await waiting).toBe(2);
    } finally {
      // A failed assertion must not leave the lock session open.
      holding.resolve();
      await active.catch(() => undefined);
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
