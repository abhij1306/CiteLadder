import {
  performanceDashboardSchema,
  performanceRangeTaskSchema,
  performanceTablePageSchema,
  projectReadinessSchema,
} from '@citeladder/contracts/performance';
import { sql } from 'kysely';
import { z } from 'zod';

import { configEnvironment, loadWorkerSettings, policy } from '../config.ts';
import { AnalyticsWorker } from '../workers/analytics-worker.ts';
import { projectPerformanceRange } from '../traffic/snapshot.ts';
import { ApiError, notFound } from '../errors.ts';
import { requireProject } from '../projects/access.ts';
import { enqueueTask, taskKey } from '../referrals/enqueue.ts';
import {
  clampedCustomWindow,
  getPerformance,
  getPerformanceTable,
} from '../traffic/performance.ts';
import { record } from '../db/json.ts';
import { scalarText } from '../text-order.ts';
import { defineGetRoute, definePostRoute } from './define.ts';
import { readProjectReadiness } from '../integrations/readiness.ts';

const root = '/api/v1/projects/{project_id}/performance';
const projectPath = { project_id: { scalar: { kind: 'uuid' }, required: true } } as const;
const date = { scalar: { kind: 'date' } } as const;
const string = { scalar: { kind: 'str' } } as const;
const uuid = { scalar: { kind: 'uuid' } } as const;
const family = 'performance';
const { statuses } = policy.task_queue;
/** Terminal range tasks that a new request may replace. */
const retryable = new Set<string>([statuses.failed, statuses.cancelled]);
function taskResponse(task: { id: string; status: string; payload: unknown }) {
  const payload = record(task.payload);
  return {
    task_id: task.id,
    status: task.status,
    window_start: scalarText(payload.window_start ?? ''),
    window_end: scalarText(payload.window_end ?? ''),
  };
}

export const performanceRoutes = [
  definePostRoute({
    family,
    path: `${root}/range/{task_id}/run`,
    capability: 'run',
    params: { path: { ...projectPath, task_id: { ...uuid, required: true } }, query: {} },
    response: performanceRangeTaskSchema,
    async handle({ c, db, config }, { path }) {
      const workspace = c.get('workspace');
      await requireProject(db, workspace, path.project_id);
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
      const worker = new AnalyticsWorker(db, loadWorkerSettings(configEnvironment(config)), {
        taskScope: { workspaceId: workspace.workspaceId, taskIds: [path.task_id] },
        executors: { performance_range_projection: projectPerformanceRange },
      });
      await worker.runOnce();
      const row = await read();
      if (!row) throw notFound('Performance range task');
      return taskResponse(row);
    },
  }),
  defineGetRoute({
    family: 'readiness',
    path: '/api/v1/projects/{project_id}/readiness',
    params: { path: projectPath, query: {} },
    response: projectReadinessSchema,
    async handle({ db, c }, { path }) {
      const scope = { workspaceId: c.get('workspace').workspaceId, projectId: path.project_id };
      await requireProject(db, c.get('workspace'), scope.projectId);
      return projectReadinessSchema.parse(await readProjectReadiness(db, scope));
    },
  }),
  defineGetRoute({
    family,
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
      await requireProject(db, workspace, path.project_id);
      return getPerformance(db, {
        workspaceId: workspace.workspaceId,
        projectId: path.project_id,
        ...query,
      });
    },
  }),
  defineGetRoute({
    family,
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
      await requireProject(db, workspace, path.project_id);
      return getPerformanceTable(db, {
        workspaceId: workspace.workspaceId,
        projectId: path.project_id,
        ...query,
      });
    },
  }),
  definePostRoute({
    family,
    path: `${root}/range`,
    status: 202,
    params: {
      path: projectPath,
      query: { from: { ...date, required: true }, to: { ...date, required: true } },
    },
    response: performanceRangeTaskSchema,
    async handle({ c, db }, { path, query }) {
      const workspace = c.get('workspace');
      await requireProject(db, workspace, path.project_id);
      const scope = { workspaceId: workspace.workspaceId, projectId: path.project_id };
      const { window, latest } = await clampedCustomWindow(db, scope, query.from, query.to);
      if (!window) throw new ApiError(422, "'from' and 'to' must be supplied together");
      const [from, to] = window;
      if (latest !== null && from > latest)
        throw new ApiError(422, `'from' is after the latest imported date (${latest})`);
      const kind = 'performance_range_projection';
      const tasks = () =>
        workspace.scope
          .selectFrom(db, 'analytics_tasks')
          .select(['id', 'status', 'payload'])
          .where('project_id', '=', path.project_id)
          .where('task_kind', '=', kind);
      // A repeat of the same range dedupes to its latest task. After that task
      // failed or was cancelled, the next request keys on it, so the range can
      // be projected again while concurrent retries still dedupe.
      const previous = await tasks()
        .where(sql<boolean>`payload->>'window_start' = ${from} and payload->>'window_end' = ${to}`)
        .orderBy('created_at', 'desc')
        .orderBy('id', 'desc')
        .executeTakeFirst();
      if (previous && !retryable.has(previous.status)) return taskResponse(previous);
      const keyParts = previous
        ? [path.project_id, from, to, 'after', previous.id]
        : [path.project_id, from, to];
      await enqueueTask(db, {
        workspaceId: workspace.workspaceId,
        projectId: path.project_id,
        kind,
        payload: { window_start: from, window_end: to },
        keyParts,
        maxAttempts: loadWorkerSettings().taskMaxAttempts,
      });
      const row = await tasks()
        .where('idempotency_key', '=', taskKey(kind, keyParts))
        .executeTakeFirst();
      if (!row) throw notFound('Performance range task');
      return taskResponse(row);
    },
  }),
  defineGetRoute({
    family,
    path: `${root}/range/{task_id}`,
    params: { path: { ...projectPath, task_id: { ...uuid, required: true } }, query: {} },
    response: performanceRangeTaskSchema,
    async handle({ c, db }, { path }) {
      const workspace = c.get('workspace');
      await requireProject(db, workspace, path.project_id);
      const row = await workspace.scope
        .selectFrom(db, 'analytics_tasks')
        .select(['id', 'status', 'payload'])
        .where('project_id', '=', path.project_id)
        .where('task_kind', '=', 'performance_range_projection')
        .where('id', '=', path.task_id)
        .executeTakeFirst();
      if (!row) throw notFound('Performance range task');
      return taskResponse(row);
    },
  }),
];
