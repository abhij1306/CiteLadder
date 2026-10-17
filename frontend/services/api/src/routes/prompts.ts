import {
  promptCandidateReviewResponseSchema,
  promptGenerateResponseSchema,
  promptCandidateSchema,
  promptSchema,
  promptSetSchema,
  topicSchema,
} from '@citeladder/contracts/project';
import { z } from 'zod';

import { actorOf } from '../auth/actor.ts';
import * as commands from '../commands/prompts.ts';
import { generationInput } from '../prompts/generation-input.ts';
import { policy } from '../config.ts';
import { readBody } from '../http/body.ts';
import { candidateReview, listCandidates } from '../prompts/candidates.ts';
import {
  createPromptSet,
  deletePromptSet,
  listPromptSets,
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
import { listTopics, topicCreate, topicUpdate } from '../prompts/topics.ts';
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
const publicWrite = { exposure: 'both', scope: 'prompts:write' } as const;
/** A retried request with the same key replays the staged run without provider I/O. */
const generationHeaders = z.object({
  'Idempotency-Key': z.string().max(policy.prompts.generation.idempotency_key_max_chars).nullish(),
});

export const promptRoutes = [
  definePostRoute({
    family: 'prompt-generation',
    ...publicWrite,
    publicPath: `${publicSet}/generate`,
    path: `${setRoot}/generate`,
    capability: 'run',
    status: 201,
    params: { path: setPath, query: noQuery },
    body: generationInput,
    headers: generationHeaders,
    response: promptGenerateResponseSchema,
    async handle({ c, db }, { path }) {
      return commands.startGeneration(
        db,
        actorOf(c),
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
    response: z.array(promptSetSchema),
    handle: ({ c, db }, { query }) =>
      listPromptSets(db, c.get('workspace').workspaceId, query.project_id ?? null),
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
    capability: 'write',
    status: 201,
    params: { path: setPath, query: noQuery },
    body: promptInput,
    response: promptSchema,
    async handle({ c, db }, { path }) {
      const input = await readBody(c, promptInput);
      return commands.createPrompt(db, actorOf(c), path.prompt_set_id, input);
    },
  }),
  definePostRoute({
    family,
    path: `${setRoot}/prompts/bulk-status`,
    capability: 'write',
    params: { path: setPath, query: noQuery },
    body: promptBulkStatus,
    response: promptSetSchema,
    async handle({ c, db }, { path }) {
      const input = await readBody(c, promptBulkStatus);
      return commands.setPromptStatuses(db, actorOf(c), path.prompt_set_id, input);
    },
  }),
  definePostRoute({
    family,
    ...publicWrite,
    publicPath: `${publicSet}/import`,
    path: `${setRoot}/import`,
    capability: 'write',
    status: 201,
    params: { path: setPath, query: noQuery },
    body: promptImport,
    response: promptSetSchema,
    async handle({ c, db }, { path }) {
      return commands.importPrompts(db, actorOf(c), path.prompt_set_id, {
        bytes: Buffer.byteLength(await c.req.text(), 'utf8'),
        read: () => readBody(c, promptImport),
      });
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
    capability: 'write',
    params: { path: setPath, query: noQuery },
    body: candidateReview,
    response: promptCandidateReviewResponseSchema,
    async handle({ c, db }, { path }) {
      const input = await readBody(c, candidateReview);
      return commands.reviewCandidates(db, actorOf(c), path.prompt_set_id, input);
    },
  }),
  definePatchRoute({
    family,
    ...publicWrite,
    publicPath: `${publicProject}/prompts/{prompt_id}`,
    path: `${api}/prompts/{prompt_id}`,
    capability: 'write',
    params: { path: { prompt_id: uuid }, query: noQuery },
    body: promptUpdate,
    response: promptSchema,
    async handle({ c, db }, { path }) {
      const input = await readBody(c, promptUpdate);
      return commands.updatePrompt(db, actorOf(c), path.prompt_id, input);
    },
  }),
  defineDeleteRoute({
    family,
    ...publicWrite,
    publicPath: `${publicProject}/prompts/{prompt_id}`,
    path: `${api}/prompts/{prompt_id}`,
    capability: 'write',
    params: { path: { prompt_id: uuid }, query: noQuery },
    handle: ({ c, db }, { path }) => commands.deletePrompt(db, actorOf(c), path.prompt_id),
  }),
  defineGetRoute({
    family,
    exposure: 'both',
    path: `${api}/projects/{project_id}/topics`,
    params: { path: { project_id: uuid }, query: noQuery },
    response: z.array(topicSchema),
    handle: ({ c, db }, { path }) =>
      listTopics(db, c.get('workspace').workspaceId, path.project_id),
  }),
  definePostRoute({
    family,
    ...publicWrite,
    path: `${api}/projects/{project_id}/topics`,
    capability: 'write',
    status: 201,
    params: { path: { project_id: uuid }, query: noQuery },
    body: topicCreate,
    response: topicSchema,
    async handle({ c, db }, { path }) {
      const input = await readBody(c, topicCreate);
      return commands.createTopic(db, actorOf(c), path.project_id, input);
    },
  }),
  definePatchRoute({
    family,
    ...publicWrite,
    publicPath: `${publicProject}/topics/{topic_id}`,
    path: `${api}/topics/{topic_id}`,
    capability: 'write',
    params: { path: { topic_id: uuid }, query: noQuery },
    body: topicUpdate,
    response: topicSchema,
    async handle({ c, db }, { path }) {
      const input = await readBody(c, topicUpdate);
      return commands.updateTopic(db, actorOf(c), path.topic_id, input);
    },
  }),
  defineDeleteRoute({
    family,
    ...publicWrite,
    publicPath: `${publicProject}/topics/{topic_id}`,
    path: `${api}/topics/{topic_id}`,
    capability: 'write',
    params: { path: { topic_id: uuid }, query: noQuery },
    handle: ({ c, db }, { path }) => commands.deleteTopic(db, actorOf(c), path.topic_id),
  }),
];
