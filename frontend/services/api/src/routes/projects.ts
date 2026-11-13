import { projectSchema, projectSummarySchema } from '@citeladder/contracts/project';
import { commandCenterSchema } from '@citeladder/contracts/opportunities';
import { projectMarketCreateSchema, projectMarketSchema } from '@citeladder/contracts/markets';
import { z } from 'zod';

import { budget, spendBudget } from '../abuse/usage.ts';
import { COMPETITORS_WRITE } from '../commands/competitors.ts';
import { routeActor } from '../commands/permission.ts';
import { readBody } from '../http/body.ts';
import { projectCreate, projectUpdate } from '../projects/inputs.ts';
import {
  createProject,
  readProject,
  listProjectSummaries,
  updateProject,
  deleteProject,
} from '../projects/service.ts';
import { commandCenter } from '../projects/command-center.ts';
import { addMarket, deleteMarket, listMarkets } from '../projects/markets.ts';
import { refreshLogos } from '../projects/logo-refresh.ts';
import { defineGetRoute, definePostRoute, definePatchRoute, defineDeleteRoute } from './define.ts';

const family = 'projects';
const root = '/api/v1/projects';
const uuid = { scalar: { kind: 'uuid' }, required: true } as const;
const projectPath = { project_id: uuid };
const marketPath = { project_id: uuid, market_id: uuid };
const scopeOf = (workspaceId: string, projectId: string) => ({ workspaceId, projectId });
export const projectRoutes = [
  defineGetRoute({
    family,
    path: root,
    params: { path: {}, query: {} },
    response: z.array(projectSummarySchema),
    handle: ({ c, db }) => listProjectSummaries(db, c.get('workspace').workspaceId),
  }),
  definePostRoute({
    family,
    path: root,
    capability: 'write',
    status: 201,
    params: { path: {}, query: {} },
    body: projectCreate,
    response: projectSchema,
    async handle({ c, db }) {
      return createProject(
        db,
        c.get('workspace').workspaceId,
        c.get('user').id,
        await readBody(c, projectCreate),
      );
    },
  }),
  defineGetRoute({
    family,
    exposure: 'both',
    path: `${root}/{project_id}`,
    authorize: 'project',
    params: { path: projectPath, query: {} },
    response: projectSchema,
    handle: ({ c, db }, { path }) =>
      readProject(db, { workspaceId: c.get('workspace').workspaceId, projectId: path.project_id }),
  }),
  definePatchRoute({
    family,
    path: `${root}/{project_id}`,
    authorize: 'active-project',
    permission: COMPETITORS_WRITE,
    params: { path: projectPath, query: {} },
    body: projectUpdate,
    response: projectSchema,
    async handle({ c, db }, { path }) {
      return updateProject(
        db,
        routeActor(c, COMPETITORS_WRITE),
        path.project_id,
        await readBody(c, projectUpdate),
      );
    },
  }),
  defineDeleteRoute({
    family,
    path: `${root}/{project_id}`,
    authorize: 'active-project',
    capability: 'delete_projects',
    params: { path: projectPath, query: {} },
    handle: ({ c, db }, { path }) =>
      deleteProject(db, {
        workspaceId: c.get('workspace').workspaceId,
        projectId: path.project_id,
      }),
  }),
  definePostRoute({
    family,
    path: `${root}/{project_id}/logos/refresh`,
    authorize: 'active-project',
    capability: 'write',
    params: { path: projectPath, query: {} },
    response: projectSchema,
    async handle({ c, db, config }, { path }) {
      const scope = { workspaceId: c.get('workspace').workspaceId, projectId: path.project_id };
      await readProject(db, scope);
      await spendBudget(db, budget('brand_logo_refresh', config.settings), scope.workspaceId);
      return refreshLogos(db, scope);
    },
  }),
  defineGetRoute({
    family,
    path: `${root}/{project_id}/command-center`,
    authorize: 'project',
    params: { path: projectPath, query: { audit_id: { scalar: { kind: 'uuid' } } } },
    response: commandCenterSchema,
    handle: ({ c, db }, { path, query }) =>
      commandCenter(
        db,
        { workspaceId: c.get('workspace').workspaceId, projectId: path.project_id },
        query.audit_id,
      ),
  }),
  defineGetRoute({
    family,
    exposure: 'both',
    path: `${root}/{project_id}/markets`,
    authorize: 'project',
    params: { path: projectPath, query: {} },
    response: z.array(projectMarketSchema),
    handle: ({ c, db }, { path }) =>
      listMarkets(db, scopeOf(c.get('workspace').workspaceId, path.project_id)),
  }),
  definePostRoute({
    family,
    path: `${root}/{project_id}/markets`,
    authorize: 'active-project',
    capability: 'write',
    status: 201,
    params: { path: projectPath, query: {} },
    body: projectMarketCreateSchema,
    response: z.array(projectMarketSchema),
    async handle({ c, db }, { path }) {
      return addMarket(
        db,
        scopeOf(c.get('workspace').workspaceId, path.project_id),
        await readBody(c, projectMarketCreateSchema),
      );
    },
  }),
  defineDeleteRoute({
    family,
    path: `${root}/{project_id}/markets/{market_id}`,
    authorize: 'active-project',
    capability: 'write',
    params: { path: marketPath, query: {} },
    handle: ({ c, db }, { path }) =>
      deleteMarket(db, scopeOf(c.get('workspace').workspaceId, path.project_id), path.market_id),
  }),
];
