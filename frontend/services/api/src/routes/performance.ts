import {
  performanceDashboardSchema,
  performanceRangeTaskSchema,
  performanceTablePageSchema,
  projectReadinessSchema,
} from '@citeladder/contracts/performance';
import { z } from 'zod';

import { loadWorkerSettings } from '../config/analytics.ts';
import { AnalyticsWorker } from '../workers/analytics-worker.ts';
import { projectPerformanceRange } from '../traffic/snapshot.ts';
import { notFound } from '../errors.ts';
import { revalidatable } from '../http/revalidate.ts';
import { performanceRangeTask, requestPerformanceRange } from '../traffic/range-request.ts';
import { getPerformance, getPerformanceTable } from '../traffic/performance.ts';
import { defineGetRoute, definePostRoute } from './define.ts';
import { readProjectReadiness } from '../integrations/readiness.ts';

const root = '/api/v1/projects/{project_id}/performance';
const projectPath = { project_id: { scalar: { kind: 'uuid' }, required: true } } as const;
const date = { scalar: { kind: 'date' } } as const;
const string = { scalar: { kind: 'str' } } as const;
const uuid = { scalar: { kind: 'uuid' } } as const;
const family = { family: 'performance', authorize: 'active-project' } as const;
export const performanceRoutes = [
  definePostRoute({
    ...family,
    path: `${root}/range/{task_id}/run`,
    capability: 'run',
    params: { path: { ...projectPath, task_id: { ...uuid, required: true } }, query: {} },
    response: performanceRangeTaskSchema,
    async handle({ c, db, config }, { path }) {
      const workspace = c.get('workspace');
      const read = () =>
        db
          .selectFrom('analytics_tasks')
          .select(['id', 'status', 'payload'])
          .where('workspace_id', '=', workspace.workspaceId)
          .where('project_id', '=', path.project_id)
          .where('task_kind', '=', 'performance_range_projection')
          .where('id', '=', path.task_id)
          .executeTakeFirst();
      if (!(await read())) throw notFound('Performance range task');
      const worker = new AnalyticsWorker(db, loadWorkerSettings(config.settings), {
        taskScope: { workspaceId: workspace.workspaceId, taskIds: [path.task_id] },
        executors: { performance_range_projection: projectPerformanceRange },
      });
      await worker.runOnce();
      const row = await read();
      if (!row) throw notFound('Performance range task');
      return performanceRangeTask(row);
    },
  }),
  defineGetRoute({
    family: 'readiness',
    authorize: 'active-project',
    path: '/api/v1/projects/{project_id}/readiness',
    params: { path: projectPath, query: {} },
    response: projectReadinessSchema,
    async handle({ db, c }, { path }) {
      const scope = { workspaceId: c.get('workspace').workspaceId, projectId: path.project_id };
      return projectReadinessSchema.parse(await readProjectReadiness(db, scope));
    },
  }),
  defineGetRoute({
    ...family,
    exposure: 'both',
    path: root,
    params: {
      path: projectPath,
      query: {
        range: string,
        from: date,
        to: date,
        compare: string,
        compare_from: date,
        compare_to: date,
        granularity: string,
      },
    },
    response: performanceDashboardSchema.extend({
      range: z.string(),
      granularity: z.string(),
      compare: z.string(),
      unavailable_dimensions: z.array(z.string()),
    }),
    async handle({ c, db }, { path, query }) {
      const workspace = c.get('workspace');
      return getPerformance(db, {
        workspaceId: workspace.workspaceId,
        projectId: path.project_id,
        ...query,
      });
    },
  }),
  defineGetRoute({
    ...family,
    exposure: 'both',
    path: `${root}/table`,
    params: {
      path: projectPath,
      query: {
        snapshot_id: { ...uuid, required: true },
        dimension: string,
        sort: string,
        cursor: string,
        page_size: { scalar: { kind: 'int' } },
        compare_snapshot_id: uuid,
      },
    },
    response: performanceTablePageSchema.extend({ dimension: z.string() }),
    async handle({ c, db }, { path, query }) {
      const workspace = c.get('workspace');
      return revalidatable(
        c,
        await getPerformanceTable(db, {
          workspaceId: workspace.workspaceId,
          projectId: path.project_id,
          ...query,
        }),
      );
    },
  }),
  definePostRoute({
    ...family,
    path: `${root}/range`,
    status: 202,
    params: {
      path: projectPath,
      query: { from: { ...date, required: true }, to: { ...date, required: true } },
    },
    response: performanceRangeTaskSchema,
    async handle({ c, db }, { path, query }) {
      return requestPerformanceRange(
        db,
        { workspaceId: c.get('workspace').workspaceId, projectId: path.project_id },
        query,
      );
    },
  }),
  defineGetRoute({
    ...family,
    path: `${root}/range/{task_id}`,
    params: { path: { ...projectPath, task_id: { ...uuid, required: true } }, query: {} },
    response: performanceRangeTaskSchema,
    async handle({ c, db }, { path }) {
      const workspace = c.get('workspace');
      const row = await workspace.scope
        .selectFrom(db, 'analytics_tasks')
        .select(['id', 'status', 'payload'])
        .where('project_id', '=', path.project_id)
        .where('task_kind', '=', 'performance_range_projection')
        .where('id', '=', path.task_id)
        .executeTakeFirst();
      if (!row) throw notFound('Performance range task');
      return performanceRangeTask(row);
    },
  }),
];
