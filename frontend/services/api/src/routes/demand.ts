import { randomUUID } from 'node:crypto';
import { policy } from '../config.ts';
import { enqueueManualDemand } from '../demand/admission.ts';
import { normalizeQuery } from '../demand/classification.ts';
import { latestDemand, queryEvidencePage, queryEvidenceSummary } from '../demand/reads.ts';
import { readBody } from '../http/body.ts';
import { RequestValidationError } from '../http/params.ts';
import { requireProject } from '../projects/access.ts';
import { defineGetRoute, definePostRoute } from './define.ts';
import {
  classificationResponse,
  demandSnapshot,
  overrideBody,
  queryPageResponse,
  querySummaryResponse,
  recomputeBody,
  recomputeResponse,
} from './demand-contracts.ts';

const family = 'demand';
const root = '/api/v1/projects/{project_id}/demand';
const projectPath = { project_id: { scalar: { kind: 'uuid' }, required: true } } as const;
const windowQuery = {
  window_start: { scalar: { kind: 'date' }, required: true },
  window_end: { scalar: { kind: 'date' }, required: true },
} as const;
export const demandRoutes = [
  defineGetRoute({
    family,
    path: `${root}/latest`,
    params: { path: projectPath, query: {} },
    response: demandSnapshot,
    async handle({ c, db }, { path }) {
      const w = c.get('workspace');
      await requireProject(db, w, path.project_id);
      return latestDemand(db, w.workspaceId, path.project_id);
    },
  }),
  definePostRoute({
    family,
    path: `${root}/recompute`,
    status: 202,
    params: { path: projectPath, query: {} },
    response: recomputeResponse,
    body: recomputeBody,
    async handle({ c, db }, { path }) {
      const body = await readBody(c, recomputeBody),
        w = c.get('workspace');
      await requireProject(db, w, path.project_id);
      const id = await db.transaction().execute((trx) =>
        enqueueManualDemand(trx, {
          workspaceId: w.workspaceId,
          projectId: path.project_id,
          windowStart: body.window_start,
          windowEnd: body.window_end,
        }),
      );
      return { task_id: id, status: id ? 'queued' : 'already_queued' };
    },
  }),
  defineGetRoute({
    family,
    path: `${root}/query-evidence`,
    params: {
      path: projectPath,
      query: {
        ...windowQuery,
        cursor: { scalar: { kind: 'str', maxLength: 512 } },
        limit: {
          scalar: { kind: 'int', ge: 1, le: policy.demand.QUERY_EVIDENCE_MAX_LIMIT },
          default: policy.demand.QUERY_EVIDENCE_DEFAULT_LIMIT,
        },
        query: { scalar: { kind: 'str', maxLength: 512 } },
        site_url_id: { scalar: { kind: 'uuid' } },
        resolution_outcome: {
          scalar: { kind: 'literal', values: ['exact', 'resolved', 'ambiguous', 'unresolved'] },
        },
      },
    },
    response: queryPageResponse,
    async handle({ c, db }, { path, query }) {
      const w = c.get('workspace');
      await requireProject(db, w, path.project_id);
      return queryEvidencePage(
        db,
        {
          workspaceId: w.workspaceId,
          projectId: path.project_id,
          windowStart: query.window_start,
          windowEnd: query.window_end,
        },
        query,
      );
    },
  }),
  defineGetRoute({
    family,
    path: `${root}/query-evidence/summary`,
    params: { path: projectPath, query: windowQuery },
    response: querySummaryResponse,
    async handle({ c, db }, { path, query }) {
      const w = c.get('workspace');
      await requireProject(db, w, path.project_id);
      return queryEvidenceSummary(db, {
        workspaceId: w.workspaceId,
        projectId: path.project_id,
        windowStart: query.window_start,
        windowEnd: query.window_end,
      });
    },
  }),
  definePostRoute({
    family,
    path: `${root}/query-classification-overrides`,
    status: 201,
    capability: 'write',
    params: { path: projectPath, query: {} },
    body: overrideBody,
    response: classificationResponse,
    async handle({ c, db }, { path }) {
      const body = await readBody(c, overrideBody),
        w = c.get('workspace');
      await requireProject(db, w, path.project_id);
      const normalized = normalizeQuery(body.query);
      // Text with no searchable characters is a validation error, never a 500.
      if (!normalized)
        throw new RequestValidationError([
          {
            loc: ['query'],
            type: 'value_error',
            message: 'Query must contain searchable characters',
          },
        ]);
      const id = randomUUID();
      await db.transaction().execute((trx) =>
        trx
          .insertInto('branded_query_overrides')
          .values({
            id,
            workspace_id: w.workspaceId,
            project_id: path.project_id,
            actor_user_id: c.get('user').id,
            normalized_query: normalized,
            classification: body.classification,
            classifier_version: policy.demand.BRANDED_QUERY_CLASSIFIER_VERSION,
            created_at: new Date(),
          })
          .execute(),
      );
      return {
        normalized_query: normalized,
        classification: body.classification,
        matched_terms: [],
        classifier_version: policy.demand.BRANDED_QUERY_CLASSIFIER_VERSION,
        override_id: id,
      };
    },
  }),
];
