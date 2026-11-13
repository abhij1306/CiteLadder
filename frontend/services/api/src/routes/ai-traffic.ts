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
import { z } from 'zod';
import { aiTrafficOverview } from '../ai-traffic/overview.ts';
import {
  crawlerPage,
  crawlerExport,
  activityPage,
  activityExport,
  coveragePage,
} from '../crawl-logs/reads.ts';
import { csvDownload } from '../http/table-export.ts';
import { crawlLogs } from '../config/crawl-logs.ts';

import { AiReferralsQueryError, getAiReferrals } from '../analytics/ai-referrals.ts';
import { policy } from '../config.ts';
import { ApiError } from '../errors.ts';
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
      return aiTrafficOverview(
        db,
        { workspaceId: workspace.workspaceId, projectId: path.project_id },
        query,
      );
    },
  }),
  defineGetRoute({
    ...readBase,
    path: root + '/crawlers',
    response: botCrawlersResponseSchema,
    async handle({ c, db }, { path, query }) {
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
        const scope = { workspaceId: c.get('workspace').workspaceId, projectId: path.project_id };
        const batches: AsyncIterable<Record<string, unknown>[]> =
          view === 'activity'
            ? await activityExport(db, scope, query)
            : await crawlerExport(db, scope, query);
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
        return csvDownload('ai-traffic-' + view + '.csv', columns, batches);
      },
    }),
  ),
  defineGetRoute({
    family: 'ai-traffic',
    authorize: 'active-project',
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
