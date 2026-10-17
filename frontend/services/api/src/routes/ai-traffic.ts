/**
 * AI Traffic persisted signal reads, with the retained referral data owner.
 *
 * `range` names a preset and
 * resolves the newest persisted snapshot of that length; `from`/`to` selects
 * one exact persisted window; neither serves the latest snapshot.
 */
import {
  aiReferralsSchema,
  aiTrafficOverviewSchema,
  botCrawlersResponseSchema,
  botActivityResponseSchema,
  crawlCoverageResponseSchema,
} from '@citeladder/contracts/ai-traffic';
import { sql } from 'kysely';
import { z } from 'zod';
import {
  crawlSummary,
  crawlWindow,
  crawlerPage,
  activityPage,
  coveragePage,
  windowBounds,
  withReportingTimezone,
  type CrawlReadOptions,
} from '../crawl-logs/reads.ts';
import { tableCsv } from '../http/table-export.ts';
import { crawlLogs } from '../config/crawl-logs.ts';

import { AiReferralsQueryError, getAiReferrals } from '../analytics/ai-referrals.ts';
import { policy } from '../config.ts';
import { ApiError } from '../errors.ts';
import { requireProject } from '../projects/access.ts';
import { defineGetRoute } from './define.ts';
import { trafficPageRoutes } from './ai-traffic-pages.ts';

const projectPath = { project_id: { scalar: { kind: 'uuid' }, required: true } } as const;
const readQuery = {
  range: { scalar: { kind: 'str' } },
  start_date: { scalar: { kind: 'date' } },
  end_date: { scalar: { kind: 'date' } },
  purpose: { scalar: { kind: 'str' } },
  verification: { scalar: { kind: 'str', maxLength: 128 } },
  bot_id: { scalar: { kind: 'str', maxLength: 64 } },
  status: { scalar: { kind: 'int', ge: 100, le: 599 } },
  folder: { scalar: { kind: 'str', maxLength: 2048 } },
  resource_class: { scalar: { kind: 'str', maxLength: 24 } },
  cursor: { scalar: { kind: 'str', maxLength: 4096 } },
  limit: { scalar: { kind: 'int', ge: 1, le: crawlLogs.max_page_size } },
} as const;
const readBase = {
  family: 'ai-traffic',
  authorize: 'project',
  params: { path: projectPath, query: readQuery },
} as const;
const root = '/api/v1/projects/{project_id}/ai-traffic';

export const aiTrafficRoutes = [
  ...trafficPageRoutes,
  defineGetRoute({
    ...readBase,
    exposure: 'both',
    path: root + '/overview',
    response: aiTrafficOverviewSchema,
    async handle({ c, db }, { path, query }) {
      const workspace = c.get('workspace');
      await requireProject(db, workspace, path.project_id);
      const scope = { workspaceId: workspace.workspaceId, projectId: path.project_id };
      const options = await withReportingTimezone(db, scope, query);
      const crawl = await crawlSummary(db, scope, options);
      const referrals = await getAiReferrals(db, {
        ...scope,
        rangeToken: query.range,
        fromDate: query.start_date,
        toDate: query.end_date,
        granularity: 'day',
      }).catch((error: unknown) => {
        if (error instanceof AiReferralsQueryError) throw new ApiError(422, error.message);
        throw error;
      });
      let audits = db
        .selectFrom('audits')
        .select('id')
        .distinctOn('audit_scope')
        .where('workspace_id', '=', scope.workspaceId)
        .where('project_id', '=', scope.projectId)
        .where('status', '=', 'completed')
        .orderBy('audit_scope')
        .orderBy('created_at', 'desc')
        .orderBy('id', 'desc');
      const bounds = windowBounds(crawlWindow(options), options);
      audits = audits.where('created_at', '>=', bounds.from).where('created_at', '<', bounds.to);
      const ids = (await audits.execute()).map((a) => a.id);
      const citations = ids.length
        ? await db
            .selectFrom('citations')
            .select(sql<number>`count(*)::integer`.as('count'))
            .where('workspace_id', '=', scope.workspaceId)
            .where('audit_id', 'in', ids)
            .where('is_owned', '=', true)
            .executeTakeFirstOrThrow()
        : null;
      return {
        crawl,
        referrals,
        citations: {
          unit: 'tracked_citations' as const,
          count: citations?.count ?? null,
          label: "Observed in CiteLadder's tracked answers",
        },
      };
    },
  }),
  defineGetRoute({
    ...readBase,
    path: root + '/crawlers',
    response: botCrawlersResponseSchema,
    async handle({ c, db }, { path, query }) {
      await requireProject(db, c.get('workspace'), path.project_id);
      return crawlerPage(
        db,
        { workspaceId: c.get('workspace').workspaceId, projectId: path.project_id },
        query,
      );
    },
  }),
  defineGetRoute({
    ...readBase,
    path: root + '/activity',
    response: botActivityResponseSchema,
    async handle({ c, db }, { path, query }) {
      await requireProject(db, c.get('workspace'), path.project_id);
      return activityPage(
        db,
        { workspaceId: c.get('workspace').workspaceId, projectId: path.project_id },
        query,
      );
    },
  }),
  defineGetRoute({
    ...readBase,
    exposure: 'both',
    path: root + '/coverage',
    response: crawlCoverageResponseSchema,
    async handle({ c, db }, { path, query }) {
      await requireProject(db, c.get('workspace'), path.project_id);
      return coveragePage(
        db,
        { workspaceId: c.get('workspace').workspaceId, projectId: path.project_id },
        query,
      );
    },
  }),
  ...(['crawlers', 'activity'] as const).map((view) =>
    defineGetRoute({
      ...readBase,
      path: root + '/' + view + '/export',
      raw: true,
      response: z.string().meta({ format: 'binary' }),
      async handle({ c, db }, { path, query }) {
        await requireProject(db, c.get('workspace'), path.project_id);
        const scope = { workspaceId: c.get('workspace').workspaceId, projectId: path.project_id };
        const items: Record<string, unknown>[] = [];
        let cursor: string | null = null;
        const options: CrawlReadOptions = {
          ...query,
          limit: crawlLogs.max_page_size,
          cursor: null,
        };
        const pages = Math.ceil(crawlLogs.max_export_rows / crawlLogs.max_page_size);
        for (let i = 0; i < pages; i++) {
          const page:
            | Awaited<ReturnType<typeof activityPage>>
            | Awaited<ReturnType<typeof crawlerPage>> =
            view === 'activity'
              ? await activityPage(db, scope, { ...options, cursor })
              : await crawlerPage(db, scope, { ...options, cursor });
          items.push(...page.items);
          cursor = page.next_cursor;
          if (!cursor) break;
        }
        if (cursor) throw new ApiError(422, 'Export exceeds configured bound; narrow the filters');
        const columns =
          view === 'activity'
            ? [
                'occurred_at',
                'bot_id',
                'host',
                'display_path',
                'identity',
                'folder',
                'resource_class',
                'status_code',
                'verification',
                'verification_reason',
                'verification_basis',
                'batch_id',
              ]
            : [
                'bot_id',
                'label',
                'purpose',
                'requests',
                'pages',
                'last_seen',
                'status_codes',
                'verification',
                'folders',
                'resources',
              ];
        return new Response(tableCsv(columns, items), {
          headers: {
            'content-type': 'text/csv; charset=utf-8',
            'content-disposition': 'attachment; filename="ai-traffic-' + view + '.csv"',
            'cache-control': 'no-store',
          },
        });
      },
    }),
  ),
  defineGetRoute({
    family: 'ai-traffic',
    path: '/api/v1/projects/{project_id}/ai-traffic/referrals',
    params: {
      path: { project_id: { scalar: { kind: 'uuid' }, required: true } },
      query: {
        from_date: { scalar: { kind: 'date' }, alias: 'from' },
        to_date: { scalar: { kind: 'date' }, alias: 'to' },
        range_token: { scalar: { kind: 'str' }, alias: 'range' },
        granularity: {
          scalar: { kind: 'str' },
          default: policy.analytics.default_granularity,
        },
      },
    },
    response: aiReferralsSchema,
    async handle({ c, db }, { path, query }) {
      const workspace = c.get('workspace');
      await requireProject(db, workspace, path.project_id);
      try {
        return await getAiReferrals(db, {
          workspaceId: workspace.workspaceId,
          projectId: path.project_id,
          fromDate: query.from_date,
          toDate: query.to_date,
          rangeToken: query.range_token,
          granularity: query.granularity,
        });
      } catch (error) {
        // A bad granularity, window or range is a 422, never a 404 or a 500.
        if (error instanceof AiReferralsQueryError) throw new ApiError(422, error.message);
        throw error;
      }
    },
  }),
];
