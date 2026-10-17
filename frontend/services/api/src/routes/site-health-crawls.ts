/** Atomic crawl-control family: all writes commit before workers can claim. */
import { z } from 'zod';
import {
  monitoredUrlsResponseSchema,
  rerunPageResponseSchema,
  siteCrawlSchema,
  siteCrawlListPageSchema,
  urlPreviewResponseSchema,
} from '@citeladder/contracts/site-health';
import { enforceWorkspaceRequest } from '../abuse/usage.ts';
import { configEnvironment, policy, resolveSettingSpec } from '../config.ts';
import { SiteHealthWorker } from '../workers/site-health-worker.ts';
import { exclusiveDrain } from '../workers/runner.ts';
import { siteWorkerSettings } from '../site-health/runtime.ts';
import { SitePageFetcher, siteFetchSettings } from '../site-health/page-fetch.ts';
import { fetchWebsite } from '../projects/safe-fetch.ts';
import { leaseSignal } from '../queue/heartbeat.ts';
import { ApiError } from '../errors.ts';
import { readBody } from '../http/body.ts';
import { InvalidCursorError } from '../http/keyset-cursor.ts';
import { cancelCrawl, listCrawls } from '../site-health/controls.ts';
import { createCrawl } from '../site-health/planner.ts';
import { recrawlRequest } from '../site-health/recrawl.ts';
import {
  createCrawlRequest,
  previewCrawlUrls,
  previewRequest,
} from '../site-health/planner-policy.ts';
import { loadCrawl, projectCrawl, rootFailure } from '../site-health/reads/crawl.ts';
import { requireAdmitted } from '../site-health/reads/pages.ts';
import {
  bulkMonitoredSet,
  monitoredSet,
  replaceMonitoredSet,
  rerunPage,
} from '../site-health/selection.ts';
import { defineGetRoute, definePostRoute, definePutRoute } from './define.ts';

const family = 'site-health-crawls';
const uuid = { scalar: { kind: 'uuid' }, required: true } as const;
const projectPath = { project_id: uuid };
const projectRoot = '/api/v1/projects/{project_id}/monitored-urls';
const replaceBody = z.strictObject({
  site_url_ids: z.array(z.uuid()).max(policy.site_health.crawl.monitored_url_selection_max),
  expected_selection_version: z.int(),
});
const bulkBody = z.strictObject({
  crawl_id: z.uuid(),
  mode: z.enum(['first_n', 'all', 'none']),
  count: z.int().nullable().optional(),
  query: z.string().nullable().optional(),
  expected_selection_version: z.int(),
});

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
      const env = configEnvironment(config);
      const interactive = policy.site_health.interactive;
      const signal = AbortSignal.timeout(interactive.timeout_seconds * 1000);
      const settings = siteWorkerSettings(env);
      const worker = new SiteHealthWorker(db, {
        taskScope: { workspaceId, crawlId: path.crawl_id },
        settings: {
          ...settings,
          concurrency: Math.min(
            settings.concurrency,
            config.execution.poolSize,
            interactive.concurrency,
          ),
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
      return siteCrawlSchema.parse(projectCrawl(await loadCrawl(db, workspaceId, path.crawl_id)));
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
    async handle({ c, db }) {
      const request = await readBody(c, createCrawlRequest);
      const workspaceId = c.get('workspace').workspaceId;
      await enforceWorkspaceRequest(db, workspaceId, {
        operation: 'site_health.crawl_create',
        limit: Number(resolveSettingSpec(policy.abuse.crawl_create_limit)),
        windowSeconds: Number(resolveSettingSpec(policy.abuse.crawl_create_window_seconds)),
      });
      const crawl = await db.transaction().execute((trx) => createCrawl(trx, workspaceId, request));
      return siteCrawlSchema.parse(projectCrawl(crawl));
    },
  }),
  definePostRoute({
    family,
    path: '/api/v1/site-crawls/{crawl_id}/recrawl',
    params: { path: { crawl_id: uuid }, query: {} },
    response: siteCrawlSchema,
    status: 201,
    capability: 'run',
    async handle({ c, db }, { path }) {
      const workspaceId = c.get('workspace').workspaceId;
      await enforceWorkspaceRequest(db, workspaceId, {
        operation: 'site_health.crawl_create',
        limit: Number(resolveSettingSpec(policy.abuse.crawl_create_limit)),
        windowSeconds: Number(resolveSettingSpec(policy.abuse.crawl_create_window_seconds)),
      });
      const crawl = await db
        .transaction()
        .execute(async (trx) =>
          createCrawl(trx, workspaceId, await recrawlRequest(trx, workspaceId, path.crawl_id)),
        );
      return siteCrawlSchema.parse(projectCrawl(crawl));
    },
  }),
  definePostRoute({
    family,
    path: '/api/v1/site-crawls/url-preview',
    params: { path: {}, query: {} },
    body: previewRequest,
    response: urlPreviewResponseSchema,
    capability: 'read',
    async handle({ c, db }) {
      return previewCrawlUrls(
        db,
        c.get('workspace').workspaceId,
        await readBody(c, previewRequest),
      );
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
        projectCrawl(crawl, { failureSummary: (await rootFailure(db, crawl)).summary }),
      );
    },
  }),
  defineGetRoute({
    family,
    path: projectRoot,
    params: { path: projectPath, query: {} },
    response: monitoredUrlsResponseSchema,
    handle: ({ c, db }, { path }) =>
      monitoredSet(db, c.get('workspace').workspaceId, path.project_id),
  }),
  definePutRoute({
    family,
    path: projectRoot,
    params: { path: projectPath, query: {} },
    body: replaceBody,
    response: monitoredUrlsResponseSchema,
    capability: 'write',
    async handle({ c, db }, { path }) {
      const workspaceId = c.get('workspace').workspaceId;
      const input = await readBody(c, replaceBody);
      await db
        .transaction()
        .execute((trx) =>
          replaceMonitoredSet(
            trx,
            workspaceId,
            path.project_id,
            input.site_url_ids,
            input.expected_selection_version,
          ),
        );
      return monitoredSet(db, workspaceId, path.project_id);
    },
  }),
  definePostRoute({
    family,
    path: `${projectRoot}/bulk-select`,
    params: { path: projectPath, query: {} },
    body: bulkBody,
    response: monitoredUrlsResponseSchema,
    capability: 'write',
    async handle({ c, db }, { path }) {
      const workspaceId = c.get('workspace').workspaceId;
      const input = await readBody(c, bulkBody);
      await db
        .transaction()
        .execute((trx) => bulkMonitoredSet(trx, workspaceId, path.project_id, input));
      return monitoredSet(db, workspaceId, path.project_id);
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
];
