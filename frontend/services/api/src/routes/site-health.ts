import {
  aeoReadinessSchema,
  architectureSchema,
  changesPageSchema,
  changeSummarySchema,
  inventoryPageSchema,
  issueHistoryPageSchema,
  issueSectionSchema,
  issueSortSchema,
  latestCrawlIssuesPageSchema,
  latestCrawlPagesPageSchema,
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
import type { Database } from '../db/database.ts';
import { ApiError, notFound } from '../errors.ts';
import { eventStreamResponse, eventTailStream, resumeCursor } from '../http/event-stream.ts';
import { InvalidCursorError } from '../http/keyset-cursor.ts';
import type { RequestParams } from '../http/params.ts';
import { slottedEventStream, streamOwner } from '../http/stream-slots.ts';
import { revalidatable } from '../http/revalidate.ts';
import {
  currentSiteCrawl,
  isTerminal,
  loadCrawl,
  loadProjectedCrawl,
  rootFailure,
} from '../site-health/reads/crawl.ts';
import { crawlProjection } from '../site-health/reads/crawl-projection.ts';
import { dashboard } from '../site-health/reads/dashboard.ts';
import { crawlEventTail, eventReplay } from '../site-health/reads/events.ts';
import { issueExport, tableExport, VIEW_NAMES } from '../site-health/reads/exports.ts';
import { issueHistory } from '../site-health/reads/issue-history.ts';
import { issueDetail, issues, type IssueFilters } from '../site-health/reads/issues.ts';
import { PAGE_SCORE_ROLES, type PageRowFilters } from '../site-health/reads/page-filters.ts';
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
const projectFamily = { family, authorize: 'active-project' } as const;
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
const flag = { scalar: { kind: 'bool' } } as const;
const depth = { scalar: { kind: 'int', ge: 0 } } as const;
const pageFilters = {
  status_filter: { ...text, alias: 'status' },
  monitored: flag,
  page_kind: text,
  query: text,
  rule: text,
  with_issues: flag,
  indexable: flag,
  min_depth: depth,
  max_depth: depth,
  score_role: { scalar: { kind: 'literal', values: PAGE_SCORE_ROLES } },
  max_score: { scalar: { kind: 'int', ge: 0, le: 100 } },
  sort: { scalar: { kind: 'literal', values: PAGE_SORTS }, default: 'status' },
} as const;
const pagesQuery = { ...paging, ...pageFilters } as const;
const issuesQuery = {
  ...paging,
  query: text,
  severity: text,
  category: text,
  dimension: text,
  section: { scalar: { kind: 'literal', values: issueSectionSchema.options } },
  sort: { scalar: { kind: 'literal', values: issueSortSchema.options }, default: 'severity' },
  rule: text,
  site_url_id: optionalUuid,
  page_kind: text,
} as const;
const download = z.unknown();
const changeLimit = policy.site_health.change_intel;

type PageFilterQuery = RequestParams<typeof crawlPath, typeof pageFilters>['query'];
type PagesQuery = RequestParams<typeof crawlPath, typeof pagesQuery>['query'];
type IssuesQuery = RequestParams<typeof crawlPath, typeof issuesQuery>['query'];

function pageRowFilters(query: Omit<PageFilterQuery, 'sort'>): PageRowFilters {
  if ((query.score_role === null) !== (query.max_score === null))
    throw new ApiError(422, 'score_role and max_score go together', { code: 'validation_error' });
  return {
    status: query.status_filter,
    monitored: query.monitored,
    pageKind: query.page_kind,
    query: query.query,
    rule: query.rule || null,
    withIssues: query.with_issues,
    indexable: query.indexable,
    minDepth: query.min_depth,
    maxDepth: query.max_depth,
    score:
      query.score_role === null || query.max_score === null
        ? null
        : { role: query.score_role, max: query.max_score },
  };
}

const readPages = (db: Database, workspaceId: string, crawlId: string, query: PagesQuery) =>
  withCursor(pages(db, workspaceId, crawlId, pageRowFilters(query), query.sort, query));

type IssueFilterQuery = Pick<
  IssuesQuery,
  'query' | 'severity' | 'category' | 'dimension' | 'rule' | 'site_url_id' | 'page_kind'
>;

const issueFilters = (query: IssueFilterQuery): IssueFilters => ({
  query: query.query || null,
  severity: query.severity || null,
  category: query.category || null,
  dimension: query.dimension || null,
  rule: query.rule || null,
  siteUrlId: query.site_url_id,
  pageKind: query.page_kind || null,
});

const readIssues = (db: Database, workspaceId: string, crawlId: string, query: IssuesQuery) =>
  withCursor(
    issues(db, workspaceId, crawlId, issueFilters(query), query, {
      section: query.section ?? null,
      sort: query.sort,
    }),
  );

async function requireCurrentCrawl(db: Database, workspaceId: string, projectId: string) {
  const crawl = await currentSiteCrawl(db, workspaceId, projectId);
  if (crawl === null) throw notFound('Crawl');
  return crawl;
}

async function withCursor<T>(read: Promise<T>): Promise<T> {
  try {
    return await read;
  } catch (error) {
    if (!(error instanceof InvalidCursorError)) throw error;
    throw new ApiError(400, error.message, { code: 'invalid_cursor' });
  }
}

const exportQuery = {
  view: { ...text, default: 'pages' },
  ...pageFilters,
  sort: { scalar: { kind: 'literal', values: [...PAGE_SORTS, ...issueSortSchema.options] } },
  severity: text,
  category: text,
  dimension: text,
  section: issuesQuery.section,
  site_url_id: optionalUuid,
  group_id: optionalUuid,
} as const;
type ExportQuery = RequestParams<typeof crawlPath, typeof exportQuery>['query'];

function exportSort<Sort extends string>(sort: string | null, allowed: readonly Sort[]) {
  if (sort === null) return null;
  const found = allowed.find((value) => value === sort);
  if (found === undefined)
    throw new ApiError(422, `sort ${sort} does not apply to this view`, {
      code: 'validation_error',
    });
  return found;
}

async function exportBody(
  db: Database,
  { workspaceId, crawlId, format }: { workspaceId: string; crawlId: string; format: 'csv' | 'md' },
  query: ExportQuery,
) {
  if (query.view === 'issue') {
    exportSort(query.sort, []);
    if (query.group_id === null)
      throw new ApiError(422, 'group_id is required for the issue export', {
        code: 'validation_error',
      });
    return issueExport(db, { workspaceId, crawlId, groupId: query.group_id });
  }
  if (query.view === 'issues')
    return tableExport(db, {
      workspaceId,
      crawlId,
      view: 'issues',
      format,
      filters: issueFilters(query),
      issueView: {
        section: query.section ?? null,
        sort: exportSort(query.sort, issueSortSchema.options) ?? 'severity',
      },
    });
  return tableExport(db, {
    workspaceId,
    crawlId,
    view: 'pages',
    filters: pageRowFilters(query),
    sort: exportSort(query.sort, PAGE_SORTS) ?? 'status',
  });
}

function exportRoute(format: 'csv' | 'md') {
  const views: string[] = format === 'csv' ? [...VIEW_NAMES, 'issue'] : ['issues'];
  return defineGetRoute({
    family,
    path: `${crawlRoot}/export.${format}`,
    params: {
      path: crawlPath,
      query: { ...exportQuery, view: { ...text, default: format === 'csv' ? 'pages' : 'issues' } },
    },
    response: download,
    raw: true,
    async handle({ c, db }, { path, query }) {
      const workspaceId = c.get('workspace').workspaceId;
      if (!views.includes(query.view))
        throw new ApiError(422, `unknown export view: ${query.view}`, {
          code: 'validation_error',
        });
      const { body, truncated } = await exportBody(
        db,
        { workspaceId, crawlId: path.crawl_id, format },
        query,
      );
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
    ...projectFamily,
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
      const crawl = await loadProjectedCrawl(db, c.get('workspace').workspaceId, path.crawl_id);
      const root = await rootFailure(db, crawl);
      return siteCrawlSchema.parse(
        await crawlProjection(db, crawl, { failureSummary: root.summary }),
      );
    },
  }),
  defineGetRoute({
    family,
    path: `${crawlRoot}/inventory`,
    params: {
      path: crawlPath,
      query: {
        ...paging,
        status_filter: pageFilters.status_filter,
        monitored: flag,
        page_kind: text,
        query: text,
      },
    },
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
    params: { path: crawlPath, query: pagesQuery },
    response: pagesPageSchema,
    handle: ({ c, db }, { path, query }) =>
      readPages(db, c.get('workspace').workspaceId, path.crawl_id, query),
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
    params: { path: crawlPath, query: issuesQuery, closed: true },
    response: siteIssuesPageSchema,
    async handle({ c, db }, { path, query }) {
      const workspaceId = c.get('workspace').workspaceId;
      const settled = isTerminal(await loadCrawl(db, workspaceId, path.crawl_id));
      const page = await readIssues(db, workspaceId, path.crawl_id, query);
      return settled ? revalidatable(c, page) : page;
    },
  }),
  defineGetRoute({
    family,
    exposure: 'both',
    publicPath: `${publicCrawlRoot}/issues/{group_id}`,
    path: `${crawlRoot}/issues/{group_id}`,
    params: { path: { ...crawlPath, group_id: uuid }, query: { ...paging, page_kind: text } },
    response: siteIssueDetailSchema,
    handle: ({ c, db }, { path, query }) =>
      withCursor(
        issueDetail(db, {
          workspaceId: c.get('workspace').workspaceId,
          crawlId: path.crawl_id,
          groupId: path.group_id,
          paging: query,
          pageKind: query.page_kind || null,
        }),
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
      const after = resumeCursor({
        header: c.req.header('last-event-id'),
        query: query.last_event_id,
      });
      if (!query.stream) return c.json(await eventReplay(db, workspaceId, path.crawl_id, after));
      const tail = crawlEventTail(
        db,
        workspaceId,
        await loadCrawl(db, workspaceId, path.crawl_id),
        after,
      );
      return eventStreamResponse(
        slottedEventStream({
          ...streamOwner(c, db, config.auth.limits),
          signal: c.req.raw.signal,
          open: (held) => eventTailStream(tail, held),
        }),
      );
    },
  }),
  exportRoute('csv'),
  exportRoute('md'),
  defineGetRoute({
    ...projectFamily,
    exposure: 'both',
    path: projectRoot,
    params: { path: projectPath, query: { crawl_id: optionalUuid } },
    response: siteHealthDashboardSchema,
    handle: ({ c, db }, { path, query }) =>
      dashboard(db, c.get('workspace').workspaceId, path.project_id, query.crawl_id),
  }),
  defineGetRoute({
    ...projectFamily,
    path: `${projectRoot}/pages`,
    params: { path: projectPath, query: pagesQuery },
    response: latestCrawlPagesPageSchema,
    async handle({ c, db }, { path, query }) {
      const workspaceId = c.get('workspace').workspaceId;
      const crawl = await requireCurrentCrawl(db, workspaceId, path.project_id);
      const page = await readPages(db, workspaceId, crawl.id, query);
      return latestCrawlPagesPageSchema.parse({
        ...page,
        crawl_id: crawl.id,
        crawl_status: crawl.status,
      });
    },
  }),
  defineGetRoute({
    ...projectFamily,
    path: `${projectRoot}/issues`,
    params: { path: projectPath, query: issuesQuery, closed: true },
    response: latestCrawlIssuesPageSchema,
    async handle({ c, db }, { path, query }) {
      const workspaceId = c.get('workspace').workspaceId;
      const crawl = await requireCurrentCrawl(db, workspaceId, path.project_id);
      const page = { ...(await readIssues(db, workspaceId, crawl.id, query)), crawl_id: crawl.id };
      return revalidatable(c, page);
    },
  }),
  defineGetRoute({
    ...projectFamily,
    path: `${projectRoot}/overview`,
    params: { path: projectPath, query: { crawl_id: optionalUuid } },
    response: siteHealthOverviewSchema,
    handle: async ({ c, db }, { path, query }) =>
      revalidatable(
        c,
        await overview(db, c.get('workspace').workspaceId, path.project_id, query.crawl_id),
      ),
  }),
  defineGetRoute({
    ...projectFamily,
    path: `${projectRoot}/aeo-readiness`,
    params: { path: projectPath, query: { crawl_id: optionalUuid } },
    response: aeoReadinessSchema,
    async handle({ c, db }, { path, query }) {
      const readiness = await aeoReadiness(
        db,
        c.get('workspace').workspaceId,
        path.project_id,
        query.crawl_id,
      );
      return readiness.state === 'not_measured' ? readiness : revalidatable(c, readiness);
    },
  }),
  defineGetRoute({
    ...projectFamily,
    path: `${projectRoot}/architecture`,
    params: { path: projectPath, query: { crawl_id: optionalUuid } },
    response: architectureSchema,
    handle: ({ c, db }, { path, query }) =>
      architecture(db, c.get('workspace').workspaceId, path.project_id, query.crawl_id),
  }),
  defineGetRoute({
    ...projectFamily,
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
    ...projectFamily,
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
