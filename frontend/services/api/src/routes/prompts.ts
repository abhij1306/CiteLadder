import {
  promptCandidateReviewResponseSchema,
  promptGenerateResponseSchema,
  promptCandidateSchema,
  promptSchema,
  promptSetListSchema,
  promptSetSchema,
  seedQueriesResponseSchema,
  topicPreviewResponseSchema,
  topicSchema,
} from '@citeladder/contracts/project';
import { z } from 'zod';

import { requestProjectOf } from '../auth/actor.ts';
import { routeActor } from '../commands/permission.ts';
import * as commands from '../commands/prompts.ts';
import { generationInput } from '../prompts/generation-input.ts';
import { policy } from '../config.ts';
import { readBody } from '../http/body.ts';
import { candidateReview, listCandidates } from '../prompts/candidates.ts';
import {
  createPromptSet,
  deletePromptSet,
  listPromptSets,
  promptFormLimits,
  promptSetCreate,
  promptSetUpdate,
  readPromptSet,
  updatePromptSet,
} from '../prompts/prompt-sets.ts';
import {
  listPrompts,
  promptBulkStatus,
  promptImport,
  promptInput,
  promptUpdate,
} from '../prompts/prompts.ts';
import { readSeedQueries } from '../prompts/seed-queries.ts';
import { listTopics, topicConfirm, topicCreate, topicUpdate } from '../prompts/topics.ts';
import { defineDeleteRoute, defineGetRoute, definePatchRoute, definePostRoute } from './define.ts';

const family = 'prompts';
const api = '/api/v1';
const uuid = { scalar: { kind: 'uuid' }, required: true } as const;
const setPath = { prompt_set_id: uuid } as const;
const setRoot = `${api}/prompt-sets/{prompt_set_id}`;
const noQuery = {} as const;
/** Public API paths nest the library under its project. */
const publicProject = `${policy.api.machine_prefix}/projects/{project_id}`;
const publicSet = `${publicProject}/prompt-sets/{prompt_set_id}`;
const write = { permission: commands.PROMPTS_WRITE } as const;
const publicWrite = { exposure: 'both', ...write } as const;
/** A route under the project path resolves the project in the session read (or the key's path guard). */
const inProject = { authorize: 'active-project' } as const;
/** A retried request with the same key replays the staged run without provider I/O. */
const generationHeaders = z.object({
  'Idempotency-Key': z.string().max(policy.prompts.generation.idempotency_key_max_chars).nullish(),
});

export const promptRoutes = [
  definePostRoute({
    family: 'prompt-generation',
    exposure: 'both',
    permission: commands.PROMPTS_RUN,
    publicPath: `${publicSet}/generate`,
    path: `${setRoot}/generate`,
    status: 201,
    params: { path: setPath, query: noQuery },
    body: generationInput,
    headers: generationHeaders,
    response: promptGenerateResponseSchema,
    async handle({ c, db }, { path }) {
      return commands.startGeneration(
        db,
        routeActor(c, commands.PROMPTS_RUN),
        requestProjectOf(c),
        path.prompt_set_id,
        await readBody(c, generationInput),
        { idempotencyKey: c.req.header('Idempotency-Key') ?? null },
      );
    },
  }),
  defineGetRoute({
    family,
    path: `${api}/prompt-sets`,
    params: { path: {}, query: { project_id: { scalar: { kind: 'uuid' } } } },
    response: promptSetListSchema,
    handle: async ({ c, db }, { query }) => ({
      prompt_sets: await listPromptSets(
        db,
        c.get('workspace').workspaceId,
        query.project_id ?? null,
      ),
      limits: promptFormLimits(),
    }),
  }),
  definePostRoute({
    family,
    path: `${api}/prompt-sets`,
    capability: 'write',
    status: 201,
    params: { path: {}, query: noQuery },
    body: promptSetCreate,
    response: promptSetSchema,
    async handle({ c, db }) {
      const input = await readBody(c, promptSetCreate);
      return createPromptSet(db, c.get('workspace').workspaceId, input);
    },
  }),
  defineGetRoute({
    family,
    exposure: 'both',
    publicPath: publicSet,
    path: setRoot,
    params: { path: setPath, query: noQuery },
    response: promptSetSchema,
    handle: ({ c, db }, { path }) =>
      readPromptSet(db, c.get('workspace').workspaceId, path.prompt_set_id),
  }),
  definePatchRoute({
    family,
    path: setRoot,
    capability: 'write',
    params: { path: setPath, query: noQuery },
    body: promptSetUpdate,
    response: promptSetSchema,
    async handle({ c, db }, { path }) {
      const input = await readBody(c, promptSetUpdate);
      return updatePromptSet(db, c.get('workspace').workspaceId, path.prompt_set_id, input);
    },
  }),
  defineDeleteRoute({
    family,
    path: setRoot,
    capability: 'write',
    params: { path: setPath, query: noQuery },
    handle: ({ c, db }, { path }) =>
      deletePromptSet(db, c.get('workspace').workspaceId, path.prompt_set_id),
  }),
  defineGetRoute({
    family,
    path: `${setRoot}/prompts`,
    params: { path: setPath, query: noQuery },
    response: z.array(promptSchema),
    handle: ({ c, db }, { path }) =>
      listPrompts(db, c.get('workspace').workspaceId, path.prompt_set_id),
  }),
  definePostRoute({
    family,
    path: `${setRoot}/prompts`,
    ...write,
    status: 201,
    params: { path: setPath, query: noQuery },
    body: promptInput,
    response: promptSchema,
    async handle({ c, db }, { path }) {
      const input = await readBody(c, promptInput);
      return commands.createPrompt(
        db,
        routeActor(c, commands.PROMPTS_WRITE),
        requestProjectOf(c),
        path.prompt_set_id,
        input,
      );
    },
  }),
  definePostRoute({
    family,
    path: `${setRoot}/prompts/bulk-status`,
    ...write,
    params: { path: setPath, query: noQuery },
    body: promptBulkStatus,
    response: promptSetSchema,
    async handle({ c, db }, { path }) {
      const input = await readBody(c, promptBulkStatus);
      return commands.setPromptStatuses(
        db,
        routeActor(c, commands.PROMPTS_WRITE),
        requestProjectOf(c),
        path.prompt_set_id,
        input,
      );
    },
  }),
  definePostRoute({
    family,
    ...publicWrite,
    publicPath: `${publicSet}/import`,
    path: `${setRoot}/import`,
    status: 201,
    params: { path: setPath, query: noQuery },
    body: promptImport,
    response: promptSetSchema,
    async handle({ c, db }, { path }) {
      return commands.importPrompts(
        db,
        routeActor(c, commands.PROMPTS_WRITE),
        requestProjectOf(c),
        path.prompt_set_id,
        {
          bytes: Buffer.byteLength(await c.req.text(), 'utf8'),
          read: () => readBody(c, promptImport),
        },
      );
    },
  }),
  defineGetRoute({
    family,
    exposure: 'both',
    publicPath: `${publicSet}/candidates`,
    path: `${setRoot}/candidates`,
    params: { path: setPath, query: noQuery },
    response: z.array(promptCandidateSchema),
    handle: ({ c, db }, { path }) =>
      listCandidates(db, c.get('workspace').workspaceId, path.prompt_set_id),
  }),
  definePostRoute({
    family,
    ...publicWrite,
    publicPath: `${publicSet}/candidates/review`,
    path: `${setRoot}/candidates/review`,
    params: { path: setPath, query: noQuery },
    body: candidateReview,
    response: promptCandidateReviewResponseSchema,
    async handle({ c, db }, { path }) {
      const input = await readBody(c, candidateReview);
      return commands.reviewCandidates(
        db,
        routeActor(c, commands.PROMPTS_WRITE),
        requestProjectOf(c),
        path.prompt_set_id,
        input,
      );
    },
  }),
  definePatchRoute({
    family,
    ...publicWrite,
    publicPath: `${publicProject}/prompts/{prompt_id}`,
    path: `${api}/prompts/{prompt_id}`,
    params: { path: { prompt_id: uuid }, query: noQuery },
    body: promptUpdate,
    response: promptSchema,
    async handle({ c, db }, { path }) {
      const input = await readBody(c, promptUpdate);
      return commands.updatePrompt(
        db,
        routeActor(c, commands.PROMPTS_WRITE),
        requestProjectOf(c),
        path.prompt_id,
        input,
      );
    },
  }),
  defineDeleteRoute({
    family,
    ...publicWrite,
    publicPath: `${publicProject}/prompts/{prompt_id}`,
    path: `${api}/prompts/{prompt_id}`,
    params: { path: { prompt_id: uuid }, query: noQuery },
    handle: ({ c, db }, { path }) =>
      commands.deletePrompt(
        db,
        routeActor(c, commands.PROMPTS_WRITE),
        requestProjectOf(c),
        path.prompt_id,
      ),
  }),
  defineGetRoute({
    family,
    ...inProject,
    exposure: 'both',
    path: `${api}/projects/{project_id}/topics`,
    params: { path: { project_id: uuid }, query: noQuery },
    response: z.array(topicSchema),
    handle: ({ db }, { path }) => listTopics(db, path.project_id),
  }),
  definePostRoute({
    family,
    ...inProject,
    ...publicWrite,
    path: `${api}/projects/{project_id}/topics`,
    status: 201,
    params: { path: { project_id: uuid }, query: noQuery },
    body: topicCreate,
    response: topicSchema,
    async handle({ c, db }, { path }) {
      const input = await readBody(c, topicCreate);
      return commands.createTopic(
        db,
        routeActor(c, commands.PROMPTS_WRITE),
        path.project_id,
        input,
      );
    },
  }),
  definePostRoute({
    family: 'prompt-generation',
    ...inProject,
    path: `${api}/projects/{project_id}/topics/preview`,
    permission: commands.PROMPTS_RUN,
    params: { path: { project_id: uuid }, query: noQuery },
    response: topicPreviewResponseSchema,
    handle: ({ c, db }, { path }) =>
      commands.previewTopics(db, routeActor(c, commands.PROMPTS_RUN), path.project_id),
  }),
  definePostRoute({
    family,
    ...inProject,
    path: `${api}/projects/{project_id}/topics/confirm`,
    ...write,
    params: { path: { project_id: uuid }, query: noQuery },
    body: topicConfirm,
    response: z.array(topicSchema),
    async handle({ c, db }, { path }) {
      const input = await readBody(c, topicConfirm);
      return commands.confirmTopics(
        db,
        routeActor(c, commands.PROMPTS_WRITE),
        path.project_id,
        input,
      );
    },
  }),
  defineGetRoute({
    family,
    ...inProject,
    path: `${api}/projects/{project_id}/seed-queries`,
    params: { path: { project_id: uuid }, query: noQuery },
    response: seedQueriesResponseSchema,
    handle: ({ c, db }, { path }) =>
      readSeedQueries(db, c.get('workspace').workspaceId, path.project_id),
  }),
  definePatchRoute({
    family,
    ...publicWrite,
    publicPath: `${publicProject}/topics/{topic_id}`,
    path: `${api}/topics/{topic_id}`,
    params: { path: { topic_id: uuid }, query: noQuery },
    body: topicUpdate,
    response: topicSchema,
    async handle({ c, db }, { path }) {
      const input = await readBody(c, topicUpdate);
      return commands.updateTopic(
        db,
        routeActor(c, commands.PROMPTS_WRITE),
        requestProjectOf(c),
        path.topic_id,
        input,
      );
    },
  }),
  defineDeleteRoute({
    family,
    ...publicWrite,
    publicPath: `${publicProject}/topics/{topic_id}`,
    path: `${api}/topics/{topic_id}`,
    params: { path: { topic_id: uuid }, query: noQuery },
    handle: ({ c, db }, { path }) =>
      commands.deleteTopic(
        db,
        routeActor(c, commands.PROMPTS_WRITE),
        requestProjectOf(c),
        path.topic_id,
      ),
  }),
];
