import { z } from 'zod';
import {
  aiTrafficPagesSchema,
  aiTrafficUrlSchema,
  aiTrafficInsightsSchema,
} from '@citeladder/contracts/ai-traffic';
import { defineGetRoute } from './define.ts';
import { pagesRead, urlRead } from '../crawl-logs/pages.ts';
import { insightsRead } from '../crawl-logs/insights.ts';
import { crawlLogs } from '../config/crawl-logs.ts';
import { requireProject } from '../projects/access.ts';
import { tableCsv } from '../http/table-export.ts';
import { ApiError } from '../errors.ts';

const root = '/api/v1/projects/{project_id}/ai-traffic';
const path = { project_id: { scalar: { kind: 'uuid' }, required: true } } as const;
const query = {
  range: { scalar: { kind: 'str' } },
  start_date: { scalar: { kind: 'date' } },
  end_date: { scalar: { kind: 'date' } },
  bot_id: { scalar: { kind: 'str', maxLength: 64 } },
  pattern: { scalar: { kind: 'str', maxLength: 64 } },
  folder: { scalar: { kind: 'str', maxLength: 2048 } },
  resource_class: { scalar: { kind: 'str', maxLength: 24 } },
  verification: { scalar: { kind: 'str', maxLength: 128 } },
  sort: { scalar: { kind: 'str', maxLength: 32 } },
  cursor: { scalar: { kind: 'str', maxLength: 4096 } },
  limit: { scalar: { kind: 'int', ge: 1, le: crawlLogs.max_page_size } },
} as const;
const base = { family: 'ai-traffic', authorize: 'project', params: { path, query } } as const;
export const trafficPageRoutes = [
  defineGetRoute({
    ...base,
    exposure: 'both',
    path: root + '/pages',
    response: aiTrafficPagesSchema,
    async handle({ c, db }, { path, query }) {
      await requireProject(db, c.get('workspace'), path.project_id);
      return pagesRead(
        db,
        { workspaceId: c.get('workspace').workspaceId, projectId: path.project_id },
        query,
      );
    },
  }),
  defineGetRoute({
    ...base,
    path: root + '/pages/export',
    raw: true,
    response: z.string().meta({ format: 'binary' }),
    async handle({ c, db }, { path, query }) {
      await requireProject(db, c.get('workspace'), path.project_id);
      const scope = { workspaceId: c.get('workspace').workspaceId, projectId: path.project_id };
      const items: Record<string, unknown>[] = [],
        limit = crawlLogs.max_page_size;
      let cursor: string | null = null;
      for (let i = 0; i < Math.ceil(crawlLogs.max_export_rows / limit); i++) {
        const page = await pagesRead(db, scope, { ...query, cursor, limit });
        items.push(
          ...page.items.map((r) => ({
            ...r,
            crawl_state: r.crawl.state,
            requests: r.crawl.value,
            referral_state: r.referrals.state,
            sessions: r.referrals.value,
            citation_state: r.citations.state,
            tracked_citations: r.citations.value,
            findings_state: r.findings.state,
            open_findings: r.findings.value,
          })),
        );
        cursor = page.next_cursor;
        if (!cursor) break;
      }
      if (cursor) throw new ApiError(422, 'Export exceeds configured bound; narrow the filters');
      return new Response(
        tableCsv(
          [
            'canonical_url',
            'url_hash',
            'folder',
            'resource_class',
            'crawl_state',
            'requests',
            'last_crawl',
            'errors_4xx',
            'errors_5xx',
            'referral_state',
            'sessions',
            'key_events',
            'citation_state',
            'tracked_citations',
            'findings_state',
            'open_findings',
          ],
          items,
        ),
        {
          headers: {
            'content-type': 'text/csv; charset=utf-8',
            'content-disposition': 'attachment; filename="ai-traffic-pages.csv"',
            'cache-control': 'no-store',
          },
        },
      );
    },
  }),
  defineGetRoute({
    ...base,
    path: root + '/pages/{url_hash}',
    params: {
      path: { ...path, url_hash: { scalar: { kind: 'str', maxLength: 64 }, required: true } },
      query,
    },
    response: aiTrafficUrlSchema,
    async handle({ c, db }, { path, query }) {
      await requireProject(db, c.get('workspace'), path.project_id);
      return urlRead(
        db,
        { workspaceId: c.get('workspace').workspaceId, projectId: path.project_id },
        path.url_hash,
        query,
      );
    },
  }),
  defineGetRoute({
    ...base,
    path: root + '/insights',
    response: aiTrafficInsightsSchema,
    async handle({ c, db }, { path, query }) {
      await requireProject(db, c.get('workspace'), path.project_id);
      return insightsRead(
        db,
        { workspaceId: c.get('workspace').workspaceId, projectId: path.project_id },
        query,
      );
    },
  }),
];
