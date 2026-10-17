/**
 * Search Intelligence: readiness, run confirmation and cancellation, saved
 * preferences, published dataset rows and citation matches.
 * Authorized by the project in the path; review creation resolves
 * competitor websites before freezing the bounded acquisition plan.
 */
import {
  searchDatasetPageSchema,
  searchDatasetSchema,
  searchPreferencesSchema,
  searchReadinessSchema,
  searchRunSchema,
} from '@citeladder/contracts/search-intelligence';
import type { Context } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context.ts';
import { readBody } from '../http/body.ts';
import { configEnvironment, policy, resolveSettingSpec } from '../config.ts';
import { ApiError } from '../errors.ts';
import { createReview } from '../search-intelligence/reviews.ts';
import { deriveCitationMatches } from '../search-intelligence/citations.ts';
import {
  datasetPage,
  getRun,
  listRuns,
  readiness,
  type Scope,
} from '../search-intelligence/reads.ts';
import { cancelRun, confirmRun, savePreferences } from '../search-intelligence/runs.ts';
import { defineGetRoute, definePostRoute, definePutRoute } from './define.ts';
import { citationMatchBody, preferencesBody, reviewBody } from './search-intelligence-contracts.ts';

const family = 'search-intelligence';
const authorize = 'project';
const root = '/api/v1/projects/{project_id}/search-intelligence';
const uuid = { scalar: { kind: 'uuid' }, required: true } as const;
const projectPath = { project_id: uuid } as const;
const runPath = { project_id: uuid, run_id: uuid } as const;

const RUN_PAGE_DEFAULT = 25;
const RUN_PAGE_MAX = 100;
const ROW_PAGE_DEFAULT = 50;
const ROW_PAGE_MAX = 200;

const scopeOf = (c: Context<AppEnv>, projectId: string): Scope => ({
  workspace: c.get('workspace').scope,
  projectId,
});

export const searchIntelligenceRoutes = [
  definePostRoute({
    family: 'search-intelligence-reviews',
    authorize,
    path: `${root}/reviews`,
    capability: 'run',
    status: 201,
    params: { path: projectPath, query: {} },
    body: reviewBody,
    headers: z.object({ 'Idempotency-Key': z.string().min(1).max(160) }),
    response: searchRunSchema,
    async handle({ c, db, config }, { path }) {
      const key = c.req.header('Idempotency-Key');
      if (!key || key.length > 160)
        throw new ApiError(422, 'A bounded Idempotency-Key is required');
      return createReview(
        db,
        scopeOf(c, path.project_id),
        c.get('user').id,
        key,
        await readBody(c, reviewBody),
        String(resolveSettingSpec(policy.settings.encryption_key, configEnvironment(config))),
      );
    },
  }),
  defineGetRoute({
    family,
    authorize,
    path: root,
    params: { path: projectPath, query: {} },
    response: searchReadinessSchema,
    async handle({ c, db }, { path }) {
      return readiness(db, scopeOf(c, path.project_id));
    },
  }),
  definePutRoute({
    family,
    authorize,
    path: `${root}/preferences`,
    capability: 'write',
    params: { path: projectPath, query: {} },
    body: preferencesBody,
    response: searchPreferencesSchema,
    async handle({ c, db }, { path }) {
      const preferences = await readBody(c, preferencesBody);
      return savePreferences(db, scopeOf(c, path.project_id), preferences);
    },
  }),
  definePostRoute({
    family,
    authorize,
    path: `${root}/runs/{run_id}/confirm`,
    capability: 'run',
    status: 202,
    params: { path: runPath, query: {} },
    response: searchRunSchema,
    async handle({ c, db }, { path }) {
      return confirmRun(db, scopeOf(c, path.project_id), path.run_id);
    },
  }),
  definePostRoute({
    family,
    authorize,
    path: `${root}/runs/{run_id}/cancel`,
    capability: 'run',
    params: { path: runPath, query: {} },
    response: searchRunSchema,
    async handle({ c, db }, { path }) {
      return cancelRun(db, scopeOf(c, path.project_id), path.run_id);
    },
  }),
  defineGetRoute({
    family,
    authorize,
    exposure: 'both',
    path: `${root}/runs`,
    params: {
      path: projectPath,
      query: {
        offset: { scalar: { kind: 'int', ge: 0 }, default: 0 },
        limit: { scalar: { kind: 'int', ge: 1, le: RUN_PAGE_MAX }, default: RUN_PAGE_DEFAULT },
      },
    },
    response: z.array(searchRunSchema),
    async handle({ c, db }, { path, query }) {
      return listRuns(db, scopeOf(c, path.project_id), query.offset, query.limit);
    },
  }),
  defineGetRoute({
    family,
    authorize,
    path: `${root}/runs/{run_id}`,
    params: { path: runPath, query: {} },
    response: searchRunSchema,
    async handle({ c, db }, { path }) {
      return getRun(db, scopeOf(c, path.project_id), path.run_id);
    },
  }),
  defineGetRoute({
    family,
    authorize,
    exposure: 'both',
    path: `${root}/datasets/{dataset_id}/rows`,
    params: {
      path: { project_id: uuid, dataset_id: uuid },
      query: {
        cursor: { scalar: { kind: 'str', maxLength: 2048 } },
        limit: { scalar: { kind: 'int', ge: 1, le: ROW_PAGE_MAX }, default: ROW_PAGE_DEFAULT },
        sort: { scalar: { kind: 'str' }, default: 'id' },
        direction: { scalar: { kind: 'literal', values: ['asc', 'desc'] }, default: 'asc' },
        search: { scalar: { kind: 'str', maxLength: 200 }, default: '' },
        min_volume: { scalar: { kind: 'int', ge: 0 } },
        intent: { scalar: { kind: 'str', maxLength: 100 }, default: '' },
      },
    },
    response: searchDatasetPageSchema,
    async handle({ c, db }, { path, query }) {
      return datasetPage(db, scopeOf(c, path.project_id), path.dataset_id, {
        cursor: query.cursor,
        limit: query.limit,
        sort: query.sort,
        direction: query.direction,
        search: query.search.trim(),
        minVolume: query.min_volume,
        intent: query.intent.trim(),
      });
    },
  }),
  definePostRoute({
    family,
    authorize,
    path: `${root}/citation-matches`,
    capability: 'write',
    status: 201,
    params: { path: projectPath, query: {} },
    body: citationMatchBody,
    response: searchDatasetSchema,
    async handle({ c, db }, { path }) {
      const body = await readBody(c, citationMatchBody);
      return deriveCitationMatches(
        db,
        scopeOf(c, path.project_id),
        body.backlink_dataset_id,
        body.audit_ids,
      );
    },
  }),
];
