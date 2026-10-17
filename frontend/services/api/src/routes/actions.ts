/** Workspace-authorized Action reads, workflow decisions and declarations. */
import { z } from 'zod';
import { actorOf } from '../auth/actor.ts';
import { declareAction, setActionStatus } from '../commands/actions.ts';
import { policy } from '../config.ts';
import { readBody } from '../http/body.ts';
import { getAction, listActions } from '../opportunities/actions.ts';
import { defineGetRoute, definePatchRoute, definePostRoute } from './define.ts';
import {
  actionDeclarationSchema,
  actionDetailSchema,
  actionItemSchema,
  actionsPageSchema,
} from '@citeladder/contracts/actions';
import { declarationCreate, statusPatch } from './action-contracts.ts';

const family = 'actions';
const a = policy.opportunity.actions;
const o = policy.opportunity.opportunities;
const actionPath = { action_id: { scalar: { kind: 'uuid' }, required: true } } as const;
const publicAction = `${policy.api.machine_prefix}/projects/{project_id}/actions/{action_id}`;
const publicWrite = { exposure: 'both', scope: 'actions:write' } as const;
export const actionRoutes = [
  defineGetRoute({
    family,
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
    capability: 'write',
    params: { path: actionPath, query: {} },
    body: statusPatch,
    response: actionItemSchema,
    async handle({ c, db }, { path }) {
      const body = await readBody(c, statusPatch);
      return setActionStatus(db, actorOf(c), path.action_id, body.status);
    },
  }),
  definePostRoute({
    family,
    ...publicWrite,
    publicPath: `${publicAction}/declaration`,
    path: '/api/v1/actions/{action_id}/declaration',
    capability: 'write',
    params: { path: actionPath, query: {} },
    body: declarationCreate,
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
        actorOf(c),
        path.action_id,
        await readBody(c, declarationCreate),
        { idempotencyKey: c.req.header('Idempotency-Key') ?? null },
      );
      return c.json(result.declaration, result.created ? 201 : 200);
    },
  }),
];
