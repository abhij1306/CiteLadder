/**
 * Workspace-authorized Action reads, workflow decisions, declarations, and
 * Analyze a page (its content-page picker and the Action plus chat it starts).
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { agentBindings } from '../agent/bindings.ts';
import { agentPolicy } from '../agent/contracts.ts';
import { runView } from '../agent/reads.ts';
import { requestProjectOf } from '../auth/actor.ts';
import { ACTIONS_WRITE, declareAction, setActionStatus } from '../commands/actions.ts';
import { routeActor } from '../commands/permission.ts';
import { policy } from '../config.ts';
import { ApiError } from '../errors.ts';
import { readBody } from '../http/body.ts';
import { getAction, listActions } from '../opportunities/actions.ts';
import { analyzePage, listAnalyzablePages } from '../page-documents/analyze.ts';
import { mapped } from './agent.ts';
import { defineGetRoute, definePatchRoute, definePostRoute } from './define.ts';
import {
  actionAnalyzeRequestSchema,
  actionAnalyzeResultSchema,
  actionDeclarationRequestSchema,
  actionDeclarationSchema,
  actionDetailSchema,
  actionItemSchema,
  actionsPageSchema,
  analyzablePagesSchema,
} from '@citeladder/contracts/actions';
import { statusPatch } from './action-contracts.ts';

const family = 'actions';
const projectPath = { project_id: { scalar: { kind: 'uuid' }, required: true } } as const;
const ANALYZE_SEARCH_MAX_CHARS = policy.content_optimization.analyze_page.search_max_chars;
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
        group: { scalar: { kind: 'str' } },
        approach: { scalar: { kind: 'str' } },
        priority: { scalar: { kind: 'str' } },
        family: { scalar: { kind: 'str' } },
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
  defineGetRoute({
    family,
    authorize: 'active-project',
    path: '/api/v1/projects/{project_id}/actions/analyze/pages',
    params: {
      path: projectPath,
      query: { q: { scalar: { kind: 'str', maxLength: ANALYZE_SEARCH_MAX_CHARS } } },
    },
    response: analyzablePagesSchema,
    handle: ({ c, db }, { path, query }) =>
      listAnalyzablePages(
        db,
        { workspaceId: c.get('workspace').workspaceId, projectId: path.project_id },
        query.q ?? null,
      ),
  }),
  definePostRoute({
    family,
    authorize: 'active-project',
    path: '/api/v1/projects/{project_id}/actions/analyze',
    // It starts an Agent chat, so it needs what starting one needs.
    capability: 'run',
    params: { path: projectPath, query: {} },
    headers: z.object({
      'Idempotency-Key': z.string().max(agentPolicy.idempotency_key_max_chars).nullish(),
    }),
    body: actionAnalyzeRequestSchema,
    response: actionAnalyzeResultSchema,
    status: 202,
    async handle({ c, db }, { path }) {
      const input = await readBody(c, actionAnalyzeRequestSchema);
      const key = c.req.header('Idempotency-Key')?.trim() || randomUUID();
      if (key.length > agentPolicy.idempotency_key_max_chars)
        throw new ApiError(422, 'Idempotency-Key is too long');
      const { store } = await agentBindings(db);
      const scope = {
        workspaceId: c.get('workspace').workspaceId,
        projectId: path.project_id,
        userId: c.get('user').id,
      };
      const started = await mapped(() => analyzePage(db, store, scope, input, key));
      return {
        action_id: started.actionId,
        chat_id: started.chatId,
        run: started.run ? runView(started.run) : null,
      };
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
