import { projectSchema } from '@citeladder/contracts/project';
import { commandCenterSchema } from '@citeladder/contracts/opportunities';
import { projectMarketCreateSchema, projectMarketSchema } from '@citeladder/contracts/markets';
import { z } from 'zod';

import { policy, resolveSettingSpec } from '../config.ts';
import { enforceWorkspaceRequest } from '../abuse/usage.ts';
import { readBody } from '../http/body.ts';
import { projectCreate, projectUpdate } from '../projects/inputs.ts';
import {
  createProject,
  readProject,
  listProjects,
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
    response: z.array(projectSchema),
    handle: ({ c, db }) => listProjects(db, c.get('workspace').workspaceId),
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
    authorize: 'project',
    capability: 'write',
    params: { path: projectPath, query: {} },
    body: projectUpdate,
    response: projectSchema,
    async handle({ c, db }, { path }) {
      return updateProject(
        db,
        { workspaceId: c.get('workspace').workspaceId, projectId: path.project_id },
        await readBody(c, projectUpdate),
      );
    },
  }),
  defineDeleteRoute({
    family,
    path: `${root}/{project_id}`,
    authorize: 'project',
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
    authorize: 'project',
    capability: 'write',
    params: { path: projectPath, query: {} },
    response: projectSchema,
    async handle({ c, db }, { path }) {
      const scope = { workspaceId: c.get('workspace').workspaceId, projectId: path.project_id };
      await readProject(db, scope);
      await enforceWorkspaceRequest(db, scope.workspaceId, {
        operation: 'brand_logo_refresh',
        limit: Number(resolveSettingSpec(policy.abuse.brand_logo_refresh_limit)),
        windowSeconds: Number(resolveSettingSpec(policy.abuse.brand_logo_refresh_window_seconds)),
      });
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
    authorize: 'project',
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
    authorize: 'project',
    capability: 'write',
    params: { path: marketPath, query: {} },
    handle: ({ c, db }, { path }) =>
      deleteMarket(db, scopeOf(c.get('workspace').workspaceId, path.project_id), path.market_id),
  }),
];
