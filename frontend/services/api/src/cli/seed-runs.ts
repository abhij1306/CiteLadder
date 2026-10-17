import type { Database } from '../db/database.ts';
import { sql } from 'kysely';
import { loadWorkerSettings } from '../config.ts';
import { devSeed } from '../config/dev-seed.ts';
import { seedAudit } from '../audits/seed.ts';
import { seedAnswer, seedWebsiteFetcher } from './seed-transports.ts';
import { SiteHealthWorker } from '../workers/site-health-worker.ts';
import { AnalyticsWorker } from '../workers/analytics-worker.ts';
import { drainLanes, type RunnerLane } from '../workers/runner.ts';
import { waitForPoll } from '../workers/poll.ts';
import { SitePageFetcher, siteFetchSettings } from '../site-health/page-fetch.ts';
import { siteWorkerSettings } from '../site-health/runtime.ts';
import { seedCrawl, seedSelection } from '../site-health/seed.ts';
import { enqueueOpportunityRefresh } from '../opportunities/enqueue.ts';
import { refreshOpportunities } from '../opportunities/refresh.ts';
import type { StaticSeed } from './seed-static.ts';

/** Poll a persisted terminal projection, reusing the bounded runner for execution. */
export async function drainSeed(
  lanes: RunnerLane[],
  status: () => Promise<string>,
  successful: readonly string[],
  seconds: number = devSeed.budgetSeconds,
) {
  const deadline = performance.now() + seconds * 1000,
    signal = AbortSignal.timeout(Math.max(1, seconds * 1000));
  while (!signal.aborted && performance.now() < deadline) {
    await drainLanes(lanes, { deadline, signal, firstLane: 0 });
    const current = await status();
    if (successful.includes(current)) return;
    if (['failed', 'cancelled', 'partially_completed'].includes(current))
      throw new Error('seed_terminal_failure');
    await waitForPoll(50, signal);
  }
  throw new Error('seed_drain_timeout');
}

export async function seedProjectAudit(
  db: Database,
  project: StaticSeed['primary'],
  encryptionKey: string,
  generation = 0,
  engines = ['chatgpt', 'claude', 'gemini'],
) {
  const prompts = await db
    .selectFrom('prompts')
    .innerJoin('prompt_sets', 'prompt_sets.id', 'prompts.prompt_set_id')
    .innerJoin('projects', 'projects.id', 'prompt_sets.project_id')
    .select(['prompts.id', 'prompts.text'])
    .where('projects.workspace_id', '=', project.workspaceId)
    .where('projects.id', '=', project.projectId)
    .where('prompts.status', '=', 'active')
    .execute();
  return seedAudit(
    db,
    {
      workspace_id: project.workspaceId,
      input: {
        project_id: project.projectId,
        prompt_ids: prompts.map((p) => p.id),
        engines,
        repetitions: 1,
        random_seed: String(42 + generation),
      },
      answers: Object.fromEntries(prompts.map((p) => [p.text, seedAnswer(p.text, generation)])),
    },
    encryptionKey,
    {},
  );
}

export async function seedSiteHealth(
  db: Database,
  project: StaticSeed['primary'],
  fetcher = seedWebsiteFetcher(),
) {
  const recorded = await fetcher;
  let last = '';
  for (const seed of ['99', '100', '101']) {
    last = await seedCrawl(db, project.workspaceId, project.projectId, seed);
    const worker = new SiteHealthWorker(db, {
      taskScope: { workspaceId: project.workspaceId, crawlId: last },
      settings: {
        ...siteWorkerSettings({}),
        concurrency: 1,
        retryBase: 0,
        retryMax: 0,
        retryJitter: 0,
      },
      fetcher: new SitePageFetcher(
        db,
        recorded,
        siteFetchSettings({
          SITE_HEALTH_PER_HOST_DELAY_SECONDS: '0',
          SITE_HEALTH_DEFAULT_CRAWL_DELAY_SECONDS: '0',
        }),
      ),
    });
    await drainSeed(
      [{ name: 'site-health', run: () => worker.runOnce(1) }],
      async () =>
        (
          await db
            .selectFrom('site_crawls')
            .select('status')
            .where('workspace_id', '=', project.workspaceId)
            .where('id', '=', last)
            .executeTakeFirstOrThrow()
        ).status,
      ['completed'],
    );
    if (seed === '99') await seedSelection(db, project.workspaceId, project.projectId, last);
  }
  return last;
}

export async function seedOpportunityRefresh(
  db: Database,
  project: StaticSeed['primary'],
  triggerKind: string,
  triggerId: string,
) {
  const inserted = await db.transaction().execute((trx) =>
    enqueueOpportunityRefresh(trx, {
      workspaceId: project.workspaceId,
      projectId: project.projectId,
      triggerKind,
      triggerId,
      maxAttempts: 1,
    }),
  );
  const id =
    inserted ??
    (
      await db
        .selectFrom('analytics_tasks')
        .select('id')
        .where('workspace_id', '=', project.workspaceId)
        .where('project_id', '=', project.projectId)
        .where('task_kind', '=', 'opportunity_refresh')
        .where(sql<boolean>`payload->>'trigger_id' = ${triggerId}`)
        .where(sql<boolean>`payload->>'trigger_kind' = ${triggerKind}`)
        .executeTakeFirstOrThrow()
    ).id;
  const worker = new AnalyticsWorker(db, loadWorkerSettings({}), {
    executors: { opportunity_refresh: refreshOpportunities },
    taskScope: { workspaceId: project.workspaceId, taskIds: [id] },
  });
  await drainSeed(
    [{ name: 'opportunity', run: () => worker.runOnce() }],
    async () =>
      (
        await db
          .selectFrom('analytics_tasks')
          .select('status')
          .where('workspace_id', '=', project.workspaceId)
          .where('id', '=', id)
          .executeTakeFirstOrThrow()
      ).status,
    ['succeeded'],
  );
  return id;
}
