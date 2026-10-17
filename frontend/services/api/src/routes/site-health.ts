/**
 * The `site-health` family: persisted crawl, page, issue, event and snapshot
 * reads, and their exports. Every lookup is filtered by the active workspace,
 * so a foreign id is a 404; nothing here fetches, scores or repairs state.
 * The TypeScript `site-health-crawls` family owns creation and crawl controls.
 */
import {
  aeoReadinessSchema,
  architectureSchema,
  changesPageSchema,
  changeSummarySchema,
  inventoryPageSchema,
  issueHistoryPageSchema,
  pageDetailSchema,
  pagesPageSchema,
  siteCrawlEventSchema,
  siteCrawlSchema,
  siteHealthDashboardSchema,
  siteHealthOverviewSchema,
  siteIssueDetailSchema,
  siteIssuesPageSchema,
  robotsHistoryPageSchema,
} from '@citeladder/contracts/site-health';
import { z } from 'zod';

import { policy } from '../config.ts';
import { ApiError } from '../errors.ts';
import { InvalidCursorError } from '../http/keyset-cursor.ts';
import { slottedEventStream } from '../http/stream-slots.ts';
import { parseUuid } from '../http/uuid.ts';
import { loadCrawl, projectCrawl, rootFailure } from '../site-health/reads/crawl.ts';
import { dashboard } from '../site-health/reads/dashboard.ts';
import { eventReplay, eventStream } from '../site-health/reads/events.ts';
import {
  architectureMarkdown,
  TABLE_VIEWS,
  tableExport,
  type TableView,
} from '../site-health/reads/exports.ts';
import { issueDetail, issueHistory, issues } from '../site-health/reads/issues.ts';
import { PAGE_SORTS } from '../site-health/reads/page-rows.ts';
import { inventory, pageDetail, pages } from '../site-health/reads/pages.ts';
import {
  aeoReadiness,
  architecture,
  changes,
  changesSummary,
  overview,
} from '../site-health/reads/projections.ts';
import { robotsHistory } from '../site-health/reads/robots-history.ts';
import { defineGetRoute } from './define.ts';

const family = 'site-health';
const crawlRoot = '/api/v1/site-crawls/{crawl_id}';
const projectRoot = '/api/v1/projects/{project_id}/site-health';
const publicCrawlRoot = `${policy.api.machine_prefix}/projects/{project_id}/site-crawls/{crawl_id}`;
const uuid = { scalar: { kind: 'uuid' }, required: true } as const;
const optionalUuid = { scalar: { kind: 'uuid' } } as const;
const text = { scalar: { kind: 'str' } } as const;
const crawlPath = { crawl_id: uuid } as const;
const projectPath = { project_id: uuid } as const;
const paging = {
  limit: {
    scalar: { kind: 'int', ge: 1, le: policy.site_health.reads.page_max_limit },
    default: policy.site_health.reads.page_default_limit,
  },
  cursor: text,
} as const;
const pageFilters = {
  status_filter: { ...text, alias: 'status' },
  monitored: { scalar: { kind: 'bool' } },
  page_kind: text,
} as const;
const download = z.unknown();
const changeLimit = policy.site_health.change_intel;

/** A cursor from another scope, filter set or tampering is a 400. */
async function withCursor<T>(read: Promise<T>): Promise<T> {
  try {
    return await read;
  } catch (error) {
    if (!(error instanceof InvalidCursorError)) throw error;
    throw new ApiError(400, error.message, { code: 'invalid_cursor' });
  }
}

function exportRoute(format: 'csv' | 'md') {
  const views = format === 'csv' ? TABLE_VIEWS : [...TABLE_VIEWS, 'architecture'];
  return defineGetRoute({
    family,
    path: `${crawlRoot}/export.${format}`,
    params: { path: crawlPath, query: { view: { ...text, default: 'inventory' } } },
    response: download,
    raw: true,
    async handle({ c, db }, { path, query }) {
      const workspaceId = c.get('workspace').workspaceId;
      if (!views.includes(query.view))
        throw new ApiError(422, `unknown export view: ${query.view}`, {
          code: 'validation_error',
        });
      const { body, truncated } =
        query.view === 'architecture'
          ? { body: await architectureMarkdown(db, workspaceId, path.crawl_id), truncated: false }
          : await tableExport(db, workspaceId, path.crawl_id, query.view as TableView, format);
      const filename = `site-health-${path.crawl_id}-${query.view}.${format}`;
      return new Response(body, {
        headers: {
          'content-type': `${format === 'csv' ? 'text/csv' : 'text/markdown'}; charset=utf-8`,
          'content-disposition': `attachment; filename="${filename}"`,
          ...(truncated ? { 'x-export-truncated': 'true' } : {}),
        },
      });
    },
  });
}

export const siteHealthRoutes = [
  defineGetRoute({
    family,
    path: `${projectRoot}/robots-history`,
    params: {
      path: projectPath,
      query: {
        cursor: text,
        limit: {
          scalar: { kind: 'int', ge: 1, le: policy.site_health.reads.robots_history_max_limit },
          default: policy.site_health.reads.robots_history_default_limit,
        },
      },
    },
    response: robotsHistoryPageSchema,
    handle: ({ c, db }, { path, query }) =>
      withCursor(
        robotsHistory(db, c.get('workspace').workspaceId, path.project_id, {
          limit: query.limit,
          cursor: query.cursor,
        }),
      ),
  }),
  defineGetRoute({
    family,
    path: crawlRoot,
    params: { path: crawlPath, query: {} },
    response: siteCrawlSchema,
    async handle({ c, db }, { path }) {
      const crawl = await loadCrawl(db, c.get('workspace').workspaceId, path.crawl_id);
      const root = await rootFailure(db, crawl);
      return siteCrawlSchema.parse(projectCrawl(crawl, { failureSummary: root.summary }));
    },
  }),
  defineGetRoute({
    family,
    path: `${crawlRoot}/inventory`,
    params: { path: crawlPath, query: { ...paging, ...pageFilters, query: text } },
    response: inventoryPageSchema,
    handle: ({ c, db }, { path, query }) =>
      withCursor(
        inventory(
          db,
          c.get('workspace').workspaceId,
          path.crawl_id,
          {
            status: query.status_filter,
            monitored: query.monitored,
            pageKind: query.page_kind,
            query: query.query,
          },
          query,
        ),
      ),
  }),
  defineGetRoute({
    family,
    exposure: 'both',
    publicPath: `${publicCrawlRoot}/pages`,
    path: `${crawlRoot}/pages`,
    params: {
      path: crawlPath,
      query: {
        ...paging,
        ...pageFilters,
        sort: { scalar: { kind: 'literal', values: PAGE_SORTS }, default: 'status' },
      },
    },
    response: pagesPageSchema,
    handle: ({ c, db }, { path, query }) =>
      withCursor(
        pages(
          db,
          c.get('workspace').workspaceId,
          path.crawl_id,
          { status: query.status_filter, monitored: query.monitored, pageKind: query.page_kind },
          query.sort,
          query,
        ),
      ),
  }),
  defineGetRoute({
    family,
    path: `${crawlRoot}/pages/{site_url_id}`,
    params: { path: { ...crawlPath, site_url_id: uuid }, query: {} },
    response: pageDetailSchema,
    handle: ({ c, db }, { path }) =>
      pageDetail(db, c.get('workspace').workspaceId, path.crawl_id, path.site_url_id),
  }),
  defineGetRoute({
    family,
    path: `${crawlRoot}/pages/{site_url_id}/issue-history`,
    params: { path: { ...crawlPath, site_url_id: uuid }, query: paging },
    response: issueHistoryPageSchema,
    handle: ({ c, db }, { path, query }) =>
      withCursor(
        issueHistory(db, c.get('workspace').workspaceId, path.crawl_id, path.site_url_id, query),
      ),
  }),
  defineGetRoute({
    family,
    exposure: 'both',
    publicPath: `${publicCrawlRoot}/issues`,
    path: `${crawlRoot}/issues`,
    params: {
      path: crawlPath,
      query: {
        ...paging,
        query: text,
        severity: text,
        category: text,
        dimension: text,
        rule: text,
        site_url_id: optionalUuid,
        page_kind: text,
        finding_class: {
          scalar: { kind: 'literal', values: ['defect', 'advisory'] },
          default: 'defect',
        },
      },
    },
    response: siteIssuesPageSchema,
    handle: ({ c, db }, { path, query }) =>
      withCursor(
        issues(
          db,
          c.get('workspace').workspaceId,
          path.crawl_id,
          {
            query: query.query || null,
            severity: query.severity || null,
            category: query.category || null,
            dimension: query.dimension || null,
            rule: query.rule || null,
            siteUrlId: query.site_url_id,
            pageKind: query.page_kind || null,
            findingClass: query.finding_class,
          },
          query,
        ),
      ),
  }),
  defineGetRoute({
    family,
    path: `${crawlRoot}/issues/{group_id}`,
    params: { path: { ...crawlPath, group_id: uuid }, query: paging },
    response: siteIssueDetailSchema,
    handle: ({ c, db }, { path, query }) =>
      withCursor(
        issueDetail(db, c.get('workspace').workspaceId, path.crawl_id, path.group_id, query),
      ),
  }),
  defineGetRoute({
    family,
    path: `${crawlRoot}/events`,
    params: {
      path: crawlPath,
      query: {
        stream: { scalar: { kind: 'bool' }, default: false },
        last_event_id: text,
      },
    },
    response: z.array(siteCrawlEventSchema),
    raw: true,
    async handle({ c, db, config }, { path, query }) {
      const workspaceId = c.get('workspace').workspaceId;
      // Resume after the client's last event, from the SSE header or the query.
      const after = parseUuid(c.req.header('last-event-id') ?? query.last_event_id);
      if (!query.stream) return c.json(await eventReplay(db, workspaceId, path.crawl_id, after));
      const crawl = await loadCrawl(db, workspaceId, path.crawl_id);
      const signal = c.req.raw.signal;
      const body = slottedEventStream({
        userId: c.get('user').id,
        limits: config.auth.limits,
        signal,
        open: () => eventStream(db, workspaceId, crawl, after, signal),
      });
      return new Response(body, {
        headers: {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          'x-accel-buffering': 'no',
        },
      });
    },
  }),
  exportRoute('csv'),
  exportRoute('md'),
  defineGetRoute({
    family,
    exposure: 'both',
    path: projectRoot,
    params: { path: projectPath, query: { crawl_id: optionalUuid } },
    response: siteHealthDashboardSchema,
    handle: ({ c, db }, { path, query }) =>
      dashboard(db, c.get('workspace').workspaceId, path.project_id, query.crawl_id),
  }),
  defineGetRoute({
    family,
    path: `${projectRoot}/overview`,
    params: { path: projectPath, query: { crawl_id: optionalUuid } },
    response: siteHealthOverviewSchema,
    handle: ({ c, db }, { path, query }) =>
      overview(db, c.get('workspace').workspaceId, path.project_id, query.crawl_id),
  }),
  defineGetRoute({
    family,
    path: `${projectRoot}/aeo-readiness`,
    params: { path: projectPath, query: { crawl_id: optionalUuid } },
    response: aeoReadinessSchema,
    handle: ({ c, db }, { path, query }) =>
      aeoReadiness(db, c.get('workspace').workspaceId, path.project_id, query.crawl_id),
  }),
  defineGetRoute({
    family,
    path: `${projectRoot}/architecture`,
    params: { path: projectPath, query: { crawl_id: optionalUuid } },
    response: architectureSchema,
    handle: ({ c, db }, { path, query }) =>
      architecture(db, c.get('workspace').workspaceId, path.project_id, query.crawl_id),
  }),
  defineGetRoute({
    family,
    path: `${projectRoot}/changes/summary`,
    params: { path: projectPath, query: { crawl_a_id: optionalUuid, crawl_b_id: optionalUuid } },
    response: changeSummarySchema,
    handle: ({ c, db }, { path, query }) =>
      changesSummary(db, c.get('workspace').workspaceId, path.project_id, {
        a: query.crawl_a_id,
        b: query.crawl_b_id,
      }),
  }),
  defineGetRoute({
    family,
    path: `${projectRoot}/changes`,
    params: {
      path: projectPath,
      query: {
        crawl_a_id: optionalUuid,
        crawl_b_id: optionalUuid,
        limit: {
          scalar: { kind: 'int', ge: 1, le: changeLimit.max_limit },
          default: changeLimit.default_limit,
        },
        cursor: text,
      },
    },
    response: changesPageSchema,
    handle: ({ c, db }, { path, query }) =>
      withCursor(
        changes(
          db,
          c.get('workspace').workspaceId,
          path.project_id,
          { a: query.crawl_a_id, b: query.crawl_b_id },
          query,
        ),
      ),
  }),
];
