/** Atomic crawl-control family: all writes commit before workers can claim. */
import {
  crawlScheduleSchema,
  issueFixesSchema,
  issueFixProgressSchema,
  issueRerunResponseSchema,
  monitoredUrlsResponseSchema,
  rerunPageResponseSchema,
  siteCrawlSchema,
  siteCrawlListPageSchema,
} from '@citeladder/contracts/site-health';
import { crawlScheduleUpdateRequestSchema } from '@citeladder/contracts/site-health-requests';
import { budget, spendBudget } from '../abuse/usage.ts';
import { policy } from '../config.ts';
import { SiteHealthWorker } from '../workers/site-health-worker.ts';
import { exclusiveDrain } from '../workers/runner.ts';
import { siteWorkerSettings } from '../site-health/runtime.ts';
import { SitePageFetcher, siteFetchSettings } from '../site-health/page-fetch.ts';
import { fetchWebsite } from '../safe-fetch.ts';
import { leaseSignal } from '../queue/heartbeat.ts';
import { ApiError } from '../errors.ts';
import { readBody } from '../http/body.ts';
import { InvalidCursorError } from '../http/keyset-cursor.ts';
import { cancelCrawl, listCrawls } from '../site-health/controls.ts';
import { createCrawl } from '../site-health/planner.ts';
import { crawlRequest } from '../site-health/crawl-request.ts';
import { readSchedule, updateSchedule } from '../site-health/schedules.ts';
import { createCrawlRequest } from '../site-health/planner-policy.ts';
import { loadCrawl, rootFailure } from '../site-health/reads/crawl.ts';
import { crawlProjection } from '../site-health/reads/crawl-projection.ts';
import { requireAdmitted } from '../site-health/reads/pages.ts';
import { monitoredSet, rerunPage } from '../site-health/selection.ts';
import { issueFixes, markIssueGroupFixed, rerunIssueGroup } from '../site-health/issue-fixes.ts';
import { defineGetRoute, definePostRoute, definePutRoute } from './define.ts';

const family = 'site-health-crawls';
/** Project routes act on the path project inside the active workspace (else 404). */
const projectFamily = { family, authorize: 'active-project' } as const;
const uuid = { scalar: { kind: 'uuid' }, required: true } as const;
const projectPath = { project_id: uuid };
const projectRoot = '/api/v1/projects/{project_id}/monitored-urls';
const scheduleRoot = '/api/v1/projects/{project_id}/crawl-schedule';

export const siteHealthCrawlRoutes = [
  definePostRoute({
    family,
    path: '/api/v1/site-crawls/{crawl_id}/run',
    params: { path: { crawl_id: uuid }, query: {} },
    response: siteCrawlSchema,
    capability: 'run',
    async handle({ c, db, config }, { path }) {
      const workspaceId = c.get('workspace').workspaceId;
      await loadCrawl(db, workspaceId, path.crawl_id);
      const env = config.settings;
      const interactive = policy.site_health.interactive;
      const signal = AbortSignal.timeout(interactive.timeout_seconds * 1000);
      const settings = siteWorkerSettings(env);
      const worker = new SiteHealthWorker(db, {
        taskScope: { workspaceId, crawlId: path.crawl_id },
        settings: {
          ...settings,
          concurrency: Math.min(settings.concurrency, interactive.concurrency),
        },
        // Include robots.txt and redirect probes in the request's acquisition deadline.
        fetcher: new SitePageFetcher(
          db,
          (url, options) =>
            fetchWebsite(url, {
              ...options,
              signal: leaseSignal(signal, options?.signal),
            }),
          siteFetchSettings(env),
        ),
        signal,
      });
      // Observe committed successors: a runner may have drained before this request finishes.
      // Keep publisher pacing under one crawler, including API requests and background jobs.
      await exclusiveDrain(
        config,
        {
          signal,
          deadline: performance.now() + interactive.admission_seconds * 1000,
        },
        0,
      )(() => worker.runUntilIdle(signal, interactive.admission_seconds));
      return siteCrawlSchema.parse(
        await crawlProjection(db, await loadCrawl(db, workspaceId, path.crawl_id)),
      );
    },
  }),
  definePostRoute({
    family,
    path: '/api/v1/site-crawls',
    params: { path: {}, query: {} },
    body: createCrawlRequest,
    response: siteCrawlSchema,
    status: 201,
    capability: 'run',
    async handle({ c, db, config }) {
      const request = await readBody(c, createCrawlRequest);
      const workspaceId = c.get('workspace').workspaceId;
      const user = c.get('user');
      // Ignoring robots.txt is the signed-in person's confirmation, recorded on the crawl;
      // a request naming no choice keeps the newest site crawl's (SH-B7: one crawl action).
      let choice: Parameters<typeof crawlRequest>[3] = null;
      if (request.robots === 'respect') choice = { robots: 'respect' };
      if (request.robots === 'ignore') {
        const { email } = await db
          .selectFrom('users')
          .select('email')
          .where('id', '=', user.id)
          .executeTakeFirstOrThrow();
        choice = {
          robots: 'ignore',
          decision: {
            user_id: user.id,
            email,
            decided_at: new Date().toISOString(),
          },
        };
      }
      await spendBudget(db, budget('crawl_create', config.settings), workspaceId);
      const crawl = await db
        .transaction()
        .execute(async (trx) =>
          createCrawl(
            trx,
            workspaceId,
            await crawlRequest(trx, workspaceId, request.project_id, choice),
          ),
        );
      return siteCrawlSchema.parse(await crawlProjection(db, crawl));
    },
  }),
  defineGetRoute({
    family,
    path: '/api/v1/site-crawls',
    params: {
      path: {},
      query: {
        project_id: { scalar: { kind: 'uuid' } },
        limit: { scalar: { kind: 'int', ge: 1, le: 200 }, default: 50 },
        cursor: { scalar: { kind: 'str' } },
      },
    },
    response: siteCrawlListPageSchema,
    async handle({ c, db }, { query }) {
      try {
        return siteCrawlListPageSchema.parse(
          await listCrawls(db, c.get('workspace').workspaceId, query),
        );
      } catch (error) {
        if (!(error instanceof InvalidCursorError)) throw error;
        throw new ApiError(400, error.message, { code: 'invalid_cursor' });
      }
    },
  }),
  definePostRoute({
    family,
    path: '/api/v1/site-crawls/{crawl_id}/cancel',
    params: { path: { crawl_id: uuid }, query: {} },
    response: siteCrawlSchema,
    capability: 'write',
    async handle({ c, db }, { path }) {
      const workspaceId = c.get('workspace').workspaceId;
      await cancelCrawl(db, workspaceId, path.crawl_id);
      const crawl = await loadCrawl(db, workspaceId, path.crawl_id);
      return siteCrawlSchema.parse(
        await crawlProjection(db, crawl, {
          failureSummary: (await rootFailure(db, crawl)).summary,
        }),
      );
    },
  }),
  defineGetRoute({
    ...projectFamily,
    path: projectRoot,
    params: { path: projectPath, query: {} },
    response: monitoredUrlsResponseSchema,
    handle: ({ c, db }, { path }) =>
      monitoredSet(db, c.get('workspace').workspaceId, path.project_id),
  }),
  defineGetRoute({
    ...projectFamily,
    path: scheduleRoot,
    params: { path: projectPath, query: {} },
    response: crawlScheduleSchema,
    handle: ({ c, db }, { path }) =>
      readSchedule(db, c.get('workspace').workspaceId, path.project_id),
  }),
  definePutRoute({
    ...projectFamily,
    path: scheduleRoot,
    params: { path: projectPath, query: {} },
    body: crawlScheduleUpdateRequestSchema,
    response: crawlScheduleSchema,
    capability: 'write',
    async handle({ c, db }, { path }) {
      const workspaceId = c.get('workspace').workspaceId;
      const input = await readBody(c, crawlScheduleUpdateRequestSchema);
      return db
        .transaction()
        .execute((trx) => updateSchedule(trx, workspaceId, path.project_id, input));
    },
  }),
  definePostRoute({
    family,
    path: '/api/v1/site-crawls/{crawl_id}/pages/{site_url_id}/rerun',
    params: { path: { crawl_id: uuid, site_url_id: uuid }, query: {} },
    response: rerunPageResponseSchema,
    status: 202,
    capability: 'run',
    async handle({ c, db }, { path }) {
      const workspaceId = c.get('workspace').workspaceId;
      const crawl = await loadCrawl(db, workspaceId, path.crawl_id);
      await requireAdmitted(db, crawl, path.site_url_id);
      return rerunPageResponseSchema.parse(
        await db
          .transaction()
          .execute((trx) => rerunPage(trx, workspaceId, crawl.project_id, path.site_url_id)),
      );
    },
  }),
  defineGetRoute({
    family,
    path: '/api/v1/site-crawls/{crawl_id}/issue-fixes',
    params: { path: { crawl_id: uuid }, query: {} },
    response: issueFixesSchema,
    handle: ({ c, db }, { path }) => issueFixes(db, c.get('workspace').workspaceId, path.crawl_id),
  }),
  definePostRoute({
    family,
    path: '/api/v1/site-crawls/{crawl_id}/issues/{group_id}/mark-fixed',
    params: { path: { crawl_id: uuid, group_id: uuid }, query: {} },
    response: issueFixProgressSchema,
    capability: 'write',
    handle: ({ c, db }, { path }) =>
      db
        .transaction()
        .execute((trx) =>
          markIssueGroupFixed(trx, c.get('workspace').workspaceId, path.crawl_id, path.group_id),
        ),
  }),
  definePostRoute({
    family,
    path: '/api/v1/site-crawls/{crawl_id}/issues/{group_id}/rerun',
    params: { path: { crawl_id: uuid, group_id: uuid }, query: {} },
    response: issueRerunResponseSchema,
    status: 202,
    capability: 'run',
    handle: ({ c, db }, { path }) =>
      db
        .transaction()
        .execute((trx) =>
          rerunIssueGroup(trx, c.get('workspace').workspaceId, path.crawl_id, path.group_id),
        ),
  }),
];
