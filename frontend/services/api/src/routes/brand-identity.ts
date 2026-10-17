import {
  brandProfileSchema,
  businessMapSchema,
  competitorSchema,
} from '@citeladder/contracts/project';
import { brandFactListSchema, brandFactSchema } from '@citeladder/contracts/fact-checking';
import { observedCompetitorSchema } from '@citeladder/contracts/visibility';
import type { Context } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context.ts';
import type { Database } from '../db/database.ts';
import { readBody } from '../http/body.ts';
import { requireProject } from '../projects/access.ts';
import {
  brandProfileUpdate,
  readBrandProfile,
  updateBrandProfile,
} from '../projects/brand-profile.ts';
import {
  brandFactCreate,
  brandFactUpdate,
  createBrandFact,
  listBrandFacts,
  updateBrandFact,
} from '../projects/brand-facts.ts';
import { businessMapUpdate, readBusinessMap, updateBusinessMap } from '../projects/business-map.ts';
import { actorOf } from '../auth/actor.ts';
import { acceptSuggestion } from '../commands/competitors.ts';
import { listSuggestions } from '../projects/competitor-suggestions.ts';
import { logoResponse } from '../projects/logos.ts';
import { defineGetRoute, definePatchRoute, definePostRoute, definePutRoute } from './define.ts';
import { fileResponse } from './opportunity-contracts.ts';

const family = 'brand-identity';
const root = '/api/v1/projects/{project_id}';
const uuid = { scalar: { kind: 'uuid' }, required: true } as const;
const projectPath = { project_id: uuid } as const;

async function scopeOf(db: Database, c: Context<AppEnv>, projectId: string) {
  const workspace = c.get('workspace');
  await requireProject(db, workspace, projectId);
  return { workspaceId: workspace.workspaceId, projectId };
}

/** Logo reads authorize through the path: an `<img>` sends no workspace header. */
function serveLogo(
  c: Context<AppEnv>,
  db: Database,
  projectId: string,
  competitorId: string | null,
) {
  const scope = { workspaceId: c.get('workspace').workspaceId, projectId };
  return logoResponse(db, scope, competitorId, c.req.header('if-none-match'));
}

export const brandIdentityRoutes = [
  defineGetRoute({
    family,
    path: `${root}/brand-profile`,
    params: { path: projectPath, query: {} },
    response: brandProfileSchema,
    async handle({ c, db }, { path }) {
      return readBrandProfile(db, await scopeOf(db, c, path.project_id));
    },
  }),
  definePutRoute({
    family,
    path: `${root}/brand-profile`,
    capability: 'write',
    params: { path: projectPath, query: {} },
    body: brandProfileUpdate,
    response: brandProfileSchema,
    async handle({ c, db }, { path }) {
      const scope = await scopeOf(db, c, path.project_id);
      const update = await readBody(c, brandProfileUpdate);
      return updateBrandProfile(db, scope, c.get('user').id, update);
    },
  }),
  defineGetRoute({
    family,
    path: `${root}/brand-facts`,
    params: { path: projectPath, query: {} },
    response: brandFactListSchema,
    async handle({ c, db }, { path }) {
      return listBrandFacts(db, await scopeOf(db, c, path.project_id));
    },
  }),
  definePostRoute({
    family,
    path: `${root}/brand-facts`,
    capability: 'write',
    params: { path: projectPath, query: {} },
    body: brandFactCreate,
    response: brandFactSchema,
    async handle({ c, db }, { path }) {
      const scope = await scopeOf(db, c, path.project_id);
      return createBrandFact(db, scope, c.get('user').id, await readBody(c, brandFactCreate));
    },
  }),
  definePatchRoute({
    family,
    path: `${root}/brand-facts/{fact_id}`,
    capability: 'write',
    params: { path: { ...projectPath, fact_id: uuid }, query: {} },
    body: brandFactUpdate,
    response: brandFactSchema,
    async handle({ c, db }, { path }) {
      const scope = await scopeOf(db, c, path.project_id);
      const update = await readBody(c, brandFactUpdate);
      return updateBrandFact(db, scope, c.get('user').id, path.fact_id, update);
    },
  }),
  defineGetRoute({
    family,
    exposure: 'both',
    path: `${root}/business-map`,
    params: { path: projectPath, query: {} },
    response: businessMapSchema,
    async handle({ c, db }, { path }) {
      return readBusinessMap(db, await scopeOf(db, c, path.project_id));
    },
  }),
  definePutRoute({
    family,
    path: `${root}/business-map`,
    capability: 'write',
    params: { path: projectPath, query: {} },
    body: businessMapUpdate,
    response: businessMapSchema,
    async handle({ c, db }, { path }) {
      const scope = await scopeOf(db, c, path.project_id);
      const update = await readBody(c, businessMapUpdate);
      return updateBusinessMap(db, scope, c.get('user').id, update);
    },
  }),
  defineGetRoute({
    family,
    exposure: 'both',
    path: `${root}/competitor-suggestions`,
    params: { path: projectPath, query: {} },
    response: z.array(observedCompetitorSchema),
    async handle({ c, db }, { path }) {
      return listSuggestions(db, await scopeOf(db, c, path.project_id));
    },
  }),
  definePostRoute({
    family,
    exposure: 'both',
    scope: 'competitors:write',
    path: `${root}/competitor-suggestions/{candidate_id}/accept`,
    capability: 'write',
    params: { path: { ...projectPath, candidate_id: uuid }, query: {} },
    response: competitorSchema,
    handle: ({ c, db }, { path }) =>
      acceptSuggestion(db, actorOf(c), path.project_id, path.candidate_id),
  }),
  defineGetRoute({
    family,
    path: `${root}/logo`,
    authorize: 'project',
    params: { path: projectPath, query: {} },
    response: fileResponse,
    raw: true,
    handle: ({ c, db }, { path }) => serveLogo(c, db, path.project_id, null),
  }),
  defineGetRoute({
    family,
    path: `${root}/competitors/{competitor_id}/logo`,
    authorize: 'project',
    params: { path: { ...projectPath, competitor_id: uuid }, query: {} },
    response: fileResponse,
    raw: true,
    handle: ({ c, db }, { path }) => serveLogo(c, db, path.project_id, path.competitor_id),
  }),
];
