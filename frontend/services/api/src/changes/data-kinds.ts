import { z } from 'zod';
import { enqueueManualDemand } from '../demand/admission.ts';
import { classifyProjectQueries, overrideClassification } from '../demand/classification.ts';
import { ApiError } from '../errors.ts';
import { performanceTargets, syncProjectPerformance } from '../integrations/performance-sync.ts';
import { enqueueSyncRun } from '../integrations/sync.ts';
import { overrideBody, recomputeBody } from '../routes/demand-contracts.ts';
import { requestPerformanceRange } from '../traffic/range-request.ts';
import {
  changeKind,
  MEMBER_RUN,
  MEMBER_WRITE,
  plural,
  rowsOf,
  type PreviewContext,
} from './kind.ts';

const PERFORMANCE = { label: 'Open Performance', path: '/performance' };
const day = z.iso.date();
const scopeOf = (workspaceId: string, change: { projectId: string }) => ({
  workspaceId,
  projectId: change.projectId,
});
const syncSpend = (count: number) =>
  `${plural(count, 'on-demand sync')} from the workspace's sync allowance`;

async function syncedProperty(context: PreviewContext, syncRunId: string) {
  return context.db
    .selectFrom('integration_sync_runs as run')
    .innerJoin('integration_connections as connection', 'connection.id', 'run.connection_id')
    .select(['connection.provider', 'run.property_ref', 'run.window_start', 'run.window_end'])
    .where('run.workspace_id', '=', context.workspaceId)
    .where('run.id', '=', syncRunId)
    .executeTakeFirstOrThrow();
}

const isoDay = (value: Date) => value.toISOString().slice(0, 10);

export const dataKinds = {
  recompute_demand: changeKind({
    permission: MEMBER_RUN,
    purpose: 'recompute a saved Demand window from the latest connected data',
    payload: recomputeBody,
    async execute(trx, _config, actor, change, payload) {
      const id = await enqueueManualDemand(trx, {
        ...scopeOf(actor.workspaceId, change),
        windowStart: payload.window_start,
        windowEnd: payload.window_end,
      });
      return {
        summary: id
          ? 'Queued the Demand recompute. It runs on its own.'
          : 'This Demand window is already queued to recompute.',
      };
    },
    preview(_context, payload) {
      return Promise.resolve({
        title: 'Recompute Demand',
        rows: [{ label: 'Window', value: `${payload.window_start} to ${payload.window_end}` }],
        spend: null,
        opens: PERFORMANCE,
      });
    },
  }),
  override_query_classification: changeKind({
    permission: MEMBER_WRITE,
    purpose:
      'classify a search query as branded, non_branded or ambiguous for Demand, overriding the automatic classification',
    payload: overrideBody,
    async execute(trx, _config, actor, change, payload) {
      const saved = await overrideClassification(
        trx,
        { ...scopeOf(actor.workspaceId, change), userId: actor.userId },
        payload,
      );
      return {
        summary: `“${saved.normalized_query}” now counts as ${saved.classification.replaceAll('_', ' ')}.`,
      };
    },
    async preview(context, payload) {
      const current = await classifyProjectQueries(
        context.db,
        context.workspaceId,
        context.projectId,
        [payload.query],
      );
      const [now] = current.values();
      return {
        title: 'Reclassify a search query',
        rows: [
          { label: 'Query', value: now?.normalized_query ?? payload.query },
          { label: 'Now', value: now?.classification.replaceAll('_', ' ') ?? 'not classified' },
          { label: 'After', value: payload.classification.replaceAll('_', ' ') },
        ],
        spend: null,
        opens: null,
      };
    },
  }),
  sync_performance: changeKind({
    permission: MEMBER_RUN,
    purpose:
      "sync every connected Search Console, GA4 and Bing property of the project now; uses the workspace's on-demand syncs",
    payload: z.strictObject({}),
    async execute(trx, _config, actor, change) {
      const queued = await syncProjectPerformance(trx, scopeOf(actor.workspaceId, change));
      return {
        summary: `Queued ${plural(queued.length, 'property sync', 'property syncs')}. They run on their own.`,
        queued: queued.length,
      };
    },
    async preview(context, _payload, rehearse) {
      const targets = await performanceTargets(context.db, context);
      if (!targets.length)
        throw new ApiError(
          422,
          'No connected Search Console, GA4 or Bing property is mapped to this project',
        );
      const { queued } = await rehearse();
      return {
        title: 'Sync performance data',
        rows: rowsOf(
          'Property',
          targets.map((target) => `${target.provider}: ${target.property_ref}`),
        ),
        spend: syncSpend(queued),
        opens: PERFORMANCE,
      };
    },
  }),
  sync_integration: changeKind({
    permission: MEMBER_RUN,
    purpose:
      "sync one integration connection's property for this project, optionally for a date window (window_start and window_end together)",
    payload: z.strictObject({
      connection_id: z.uuid(),
      window_start: day.optional(),
      window_end: day.optional(),
    }),
    async execute(trx, _config, actor, change, payload) {
      const run = await enqueueSyncRun(trx, {
        ...scopeOf(actor.workspaceId, change),
        connectionId: payload.connection_id,
        windowStart: payload.window_start,
        windowEnd: payload.window_end,
      });
      return { summary: 'Queued the sync. It runs on its own.', run: { id: run.sync_run_id } };
    },
    async preview(context, _payload, rehearse) {
      const property = await syncedProperty(context, (await rehearse()).run.id);
      return {
        title: `Sync ${property.provider} data`,
        rows: [
          { label: 'Property', value: property.property_ref },
          {
            label: 'Window',
            value: `${isoDay(property.window_start)} to ${isoDay(property.window_end)}`,
          },
        ],
        spend: syncSpend(1),
        opens: PERFORMANCE,
      };
    },
  }),
  request_performance_range: changeKind({
    permission: MEMBER_RUN,
    purpose: 'build Performance figures for a custom date range (from and to, YYYY-MM-DD)',
    payload: z.strictObject({ from: day, to: day }),
    async execute(trx, _config, actor, change, payload) {
      const task = await requestPerformanceRange(trx, scopeOf(actor.workspaceId, change), payload);
      return {
        summary: `Building Performance for ${task.window_start} to ${task.window_end}. It runs on its own.`,
        task,
      };
    },
    async preview(_context, _payload, rehearse) {
      const { task } = await rehearse();
      return {
        title: 'Build a Performance range',
        rows: [{ label: 'Window', value: `${task.window_start} to ${task.window_end}` }],
        spend: null,
        opens: PERFORMANCE,
      };
    },
  }),
};
