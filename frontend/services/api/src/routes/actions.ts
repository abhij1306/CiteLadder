/** Workspace-authorized Action reads, workflow decisions and declarations. */
import { z } from 'zod';
import { requestProjectOf } from '../auth/actor.ts';
import { ACTIONS_WRITE, declareAction, setActionStatus } from '../commands/actions.ts';
import { routeActor } from '../commands/permission.ts';
import { policy } from '../config.ts';
import { readBody } from '../http/body.ts';
import { getAction, listActions } from '../opportunities/actions.ts';
import { defineGetRoute, definePatchRoute, definePostRoute } from './define.ts';
import {
  actionDeclarationRequestSchema,
  actionDeclarationSchema,
  actionDetailSchema,
  actionItemSchema,
  actionsPageSchema,
} from '@citeladder/contracts/actions';
import { statusPatch } from './action-contracts.ts';

const family = 'actions';
const a = policy.opportunity.actions;
const o = policy.opportunity.opportunities;
const actionPath = { action_id: { scalar: { kind: 'uuid' }, required: true } } as const;
const publicAction = `${policy.api.machine_prefix}/projects/{project_id}/actions/{action_id}`;
const publicWrite = { exposure: 'both', permission: ACTIONS_WRITE } as const;
export const actionRoutes = [
  defineGetRoute({
    family,
    authorize: 'active-project',
    exposure: 'both',
    path: '/api/v1/projects/{project_id}/actions',
    params: {
      path: { project_id: { scalar: { kind: 'uuid' }, required: true } },
      query: {
        limit: {
          scalar: { kind: 'int', ge: 1, le: a.ACTION_LIST_MAX_LIMIT },
          default: a.ACTION_LIST_DEFAULT_LIMIT,
        },
        cursor: { scalar: { kind: 'str' } },
        status_filter: { scalar: { kind: 'str' }, alias: 'status' },
        target_kind: { scalar: { kind: 'str' } },
      },
    },
    response: actionsPageSchema,
    async handle({ c, db }, { path, query }) {
      return listActions(
        db,
        { workspaceId: c.get('workspace').workspaceId, projectId: path.project_id },
        { ...query, status: query.status_filter },
      );
    },
  }),
  defineGetRoute({
    family,
    exposure: 'both',
    publicPath: publicAction,
    path: '/api/v1/actions/{action_id}',
    params: { path: actionPath, query: {} },
    response: actionDetailSchema,
    async handle({ c, db }, { path }) {
      return getAction(db, c.get('workspace').workspaceId, path.action_id);
    },
  }),
  definePatchRoute({
    family,
    ...publicWrite,
    publicPath: publicAction,
    path: '/api/v1/actions/{action_id}',
    params: { path: actionPath, query: {} },
    body: statusPatch,
    response: actionItemSchema,
    async handle({ c, db }, { path }) {
      const body = await readBody(c, statusPatch);
      return setActionStatus(
        db,
        routeActor(c, ACTIONS_WRITE),
        requestProjectOf(c),
        path.action_id,
        body.status,
      );
    },
  }),
  definePostRoute({
    family,
    ...publicWrite,
    publicPath: `${publicAction}/declaration`,
    path: '/api/v1/actions/{action_id}/declaration',
    params: { path: actionPath, query: {} },
    body: actionDeclarationRequestSchema,
    response: actionDeclarationSchema,
    status: 201,
    alsoStatus: 200,
    raw: true,
    headers: z.object({
      'Idempotency-Key': z
        .string()
        .max(o.IMPLEMENTATION_IDEMPOTENCY_KEY_MAX_LEN)
        .nullable()
        .optional(),
    }),
    async handle({ c, db }, { path }) {
      const result = await declareAction(
        db,
        routeActor(c, ACTIONS_WRITE),
        requestProjectOf(c),
        path.action_id,
        await readBody(c, actionDeclarationRequestSchema),
        { idempotencyKey: c.req.header('Idempotency-Key') ?? null },
      );
      return c.json(result.declaration, result.created ? 201 : 200);
    },
  }),
];
