import { z } from 'zod';
import {
  auditSchema,
  auditEstimateSchema,
  auditPerformanceSchema,
  auditMetricsSchema,
  executionSchema,
} from '@citeladder/contracts/audits';
import { auditEventSchema } from '@citeladder/contracts/audit-events';
import { configEnvironment, policy } from '../config.ts';
import { readBody } from '../http/body.ts';
import { actorOf } from '../auth/actor.ts';
import { cancelAudit, createQueuedAudit, runAudit } from '../commands/audits.ts';
import { auditInput } from '../audits/inputs.ts';
import { auditRuntime } from '../audits/config.ts';
import { estimateAudit, estimateInput } from '../audits/estimate.ts';
import {
  readAudit,
  listAudits,
  listExecutions,
  readAuditMetrics,
  auditEvents,
} from '../audits/reads.ts';
import { auditPerformance } from '../audits/performance.ts';
import { createRepairAudit, repairInput } from '../audits/repair.ts';
import { exportAudit } from '../audits/exports.ts';
import { resumeCursor, eventStreamResponse } from '../audits/events.ts';
import { defineGetRoute, definePostRoute } from './define.ts';

const family = 'audits',
  root = '/api/v1/audits',
  publicRoot = `${policy.api.machine_prefix}/projects/{project_id}/audits`;
const item = { audit_id: { scalar: { kind: 'uuid' }, required: true } } as const;
const empty = { path: {}, query: {} } as const;
const params = { path: item, query: {} } as const;
function exportRoute(format: 'csv' | 'md') {
  return defineGetRoute({
    family,
    path: `${root}/{audit_id}/export.${format}`,
    params,
    response: z.string(),
    raw: true,
    async handle({ c, db }, { path }) {
      return new Response(
        await exportAudit(db, c.get('workspace').workspaceId, path.audit_id, format),
        {
          headers: {
            'content-type': `${format === 'csv' ? 'text/csv' : 'text/markdown'}; charset=utf-8`,
            'content-disposition': `attachment; filename="audit-${path.audit_id}.${format}"`,
          },
        },
      );
    },
  });
}
export const auditRoutes = [
  definePostRoute({
    family,
    path: `${root}/{audit_id}/run`,
    params,
    capability: 'run',
    response: auditSchema,
    handle: ({ c, db, config }, { path }) => runAudit(db, config, actorOf(c), path.audit_id),
  }),
  definePostRoute({
    family,
    path: root,
    params: empty,
    status: 201,
    capability: 'run',
    body: auditInput,
    response: auditSchema.array(),
    handle: async ({ c, db, config }) =>
      createQueuedAudit(db, config, actorOf(c), await readBody(c, auditInput)),
  }),
  definePostRoute({
    family,
    path: `${root}/estimate`,
    params: empty,
    capability: 'read',
    body: estimateInput,
    response: auditEstimateSchema,
    async handle({ c, db, config }) {
      return estimateAudit(
        db,
        c.get('workspace').workspaceId,
        await readBody(c, estimateInput),
        auditRuntime(configEnvironment(config)),
      );
    },
  }),
  defineGetRoute({
    family,
    path: root,
    params: {
      path: {},
      query: {
        project_id: { scalar: { kind: 'uuid' } },
        limit: { scalar: { kind: 'int', ge: 1, le: 200 }, default: 50 },
      },
    },
    response: auditSchema.array(),
    async handle({ c, db }, { query }) {
      return listAudits(
        db,
        c.get('workspace').workspaceId,
        query.project_id ?? undefined,
        query.limit,
      );
    },
  }),
  defineGetRoute({
    family,
    exposure: 'both',
    publicPath: `${publicRoot}/{audit_id}`,
    path: `${root}/{audit_id}`,
    params,
    response: auditSchema,
    async handle({ c, db }, { path }) {
      return readAudit(db, c.get('workspace').workspaceId, path.audit_id);
    },
  }),
  defineGetRoute({
    family,
    path: `${root}/{audit_id}/performance`,
    params,
    response: auditPerformanceSchema,
    async handle({ c, db }, { path }) {
      return auditPerformance(db, c.get('workspace').workspaceId, path.audit_id);
    },
  }),
  definePostRoute({
    family,
    exposure: 'both',
    scope: 'audits:run',
    publicPath: `${publicRoot}/{audit_id}/cancel`,
    path: `${root}/{audit_id}/cancel`,
    params,
    capability: 'write',
    response: auditSchema,
    handle: ({ c, db }, { path }) => cancelAudit(db, actorOf(c), path.audit_id),
  }),
  definePostRoute({
    family,
    path: `${root}/{audit_id}/rerun-failures`,
    params,
    status: 201,
    alsoStatus: 200,
    capability: 'run',
    body: repairInput,
    response: auditSchema,
    raw: true,
    async handle({ c, db }, { path }) {
      const workspace = c.get('workspace').workspaceId,
        result = await createRepairAudit(
          db,
          workspace,
          path.audit_id,
          await readBody(c, repairInput),
        );
      return c.json(await readAudit(db, workspace, result.auditId), result.created ? 201 : 200);
    },
  }),
  defineGetRoute({
    family,
    path: `${root}/{audit_id}/executions`,
    params,
    response: executionSchema.array(),
    async handle({ c, db }, { path }) {
      return listExecutions(db, c.get('workspace').workspaceId, path.audit_id);
    },
  }),
  defineGetRoute({
    family,
    path: `${root}/{audit_id}/metrics`,
    params,
    response: auditMetricsSchema,
    async handle({ c, db }, { path }) {
      return readAuditMetrics(db, c.get('workspace').workspaceId, path.audit_id);
    },
  }),
  exportRoute('csv'),
  exportRoute('md'),
  defineGetRoute({
    family,
    path: `${root}/{audit_id}/events`,
    params: { path: item, query: { stream: { scalar: { kind: 'bool' }, default: false } } },
    headers: z.object({ 'last-event-id': z.uuid().optional() }),
    response: auditEventSchema.array(),
    raw: true,
    async handle({ c, db, config }, { path, query }) {
      const workspace = c.get('workspace').workspaceId,
        runtime = auditRuntime(configEnvironment(config));
      const after = resumeCursor(c.req.header('last-event-id'));
      const events = await auditEvents(
        db,
        workspace,
        path.audit_id,
        after,
        runtime.audits.max_event_page,
      );
      return query.stream
        ? eventStreamResponse(
            db,
            workspace,
            path.audit_id,
            after,
            runtime,
            c.req.raw.signal,
            events,
            { userId: c.get('user').id, limits: config.auth.limits },
          )
        : c.json(events);
    },
  }),
];
