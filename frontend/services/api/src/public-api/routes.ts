/**
 * Public API operations with no browser twin. Routes served on both APIs
 * declare `exposure: 'both'` beside their browser handler; these add the
 * public list pages, the batch prompt create, single-competitor writes, the
 * one-call audit launch. `app.ts` serves their OpenAPI document.
 */
import { auditSchema, auditEstimateSchema } from '@citeladder/contracts/audits';
import {
  competitorSchema,
  projectSchema,
  promptSchema,
  promptSetSchema,
  promptStatusSchema,
} from '@citeladder/contracts/project';
import { z } from 'zod';

import { actorOf } from '../auth/actor.ts';
import { auditRuntime } from '../audits/config.ts';
import { estimateAudit, estimateInput } from '../audits/estimate.ts';
import { auditLaunchInput } from '../audits/inputs.ts';
import { listAudits } from '../audits/reads.ts';
import { launchAudit } from '../commands/audits.ts';
import { addCompetitor, removeCompetitor, updateCompetitor } from '../commands/competitors.ts';
import { createPrompts } from '../commands/prompts.ts';
import { configEnvironment, policy } from '../config.ts';
import { ApiError } from '../errors.ts';
import { readBody } from '../http/body.ts';
import { competitorCreate, competitorUpdate, listCompetitors } from '../projects/competitors.ts';
import { listProjects } from '../projects/service.ts';
import { listPromptSets } from '../prompts/prompt-sets.ts';
import { promptBatch } from '../prompts/prompts.ts';
import {
  defineDeleteRoute,
  defineGetRoute,
  definePatchRoute,
  definePostRoute,
  type ProductRoute,
} from '../routes/define.ts';
import { cursorId, nextCursor, pageAfter, pageQuery, pageSchema } from './pagination.ts';
import {
  generationRunSchema,
  listGenerationRuns,
  listPublicPrompts,
  publicPromptSchema,
} from './reads.ts';

const v1 = policy.api.machine_prefix;
const project = `${v1}/projects/{project_id}`;
const uuid = { scalar: { kind: 'uuid' }, required: true } as const;
const optionalUuid = { scalar: { kind: 'uuid' } } as const;
const projectPath = { project_id: uuid } as const;
const base = { family: 'public-api', exposure: 'public' } as const;
/** An estimate's body; the project comes from the path. */
const projectEstimate = estimateInput.omit({ project_id: true });

export const publicApiRoutes: readonly ProductRoute[] = [
  defineGetRoute({
    ...base,
    path: `${v1}/projects`,
    params: { path: {}, query: pageQuery },
    response: pageSchema(projectSchema),
    async handle({ c, db }, { query }) {
      const allowed = c.get('apiKey')?.projectIds ?? null;
      const projects = (await listProjects(db, c.get('workspace').workspaceId)).filter(
        (item) => allowed === null || allowed.includes(item.id),
      );
      return pageAfter(projects, query, { endpoint: 'projects', filters: {} });
    },
  }),
  defineGetRoute({
    ...base,
    path: `${project}/prompt-sets`,
    params: { path: projectPath, query: {} },
    response: z.array(promptSetSchema),
    handle: ({ c, db }, { path }) =>
      listPromptSets(db, c.get('workspace').workspaceId, path.project_id),
  }),
  defineGetRoute({
    ...base,
    path: `${project}/prompts`,
    params: {
      path: projectPath,
      query: {
        ...pageQuery,
        prompt_set_id: optionalUuid,
        topic_id: optionalUuid,
        status: { scalar: { kind: 'literal', values: promptStatusSchema.options } },
      },
    },
    response: pageSchema(publicPromptSchema),
    handle: ({ c, db }, { path, query }) =>
      listPublicPrompts(
        db,
        { workspaceId: c.get('workspace').workspaceId, projectId: path.project_id },
        { promptSetId: query.prompt_set_id, topicId: query.topic_id, status: query.status },
        { cursor: query.cursor, limit: query.limit },
      ),
  }),
  definePostRoute({
    ...base,
    scope: 'prompts:write',
    capability: 'write',
    status: 201,
    path: `${project}/prompt-sets/{prompt_set_id}/prompts`,
    params: { path: { ...projectPath, prompt_set_id: uuid }, query: {} },
    body: promptBatch,
    response: z.object({ prompts: z.array(promptSchema) }),
    handle: async ({ c, db }, { path }) => ({
      prompts: await createPrompts(
        db,
        actorOf(c),
        path.prompt_set_id,
        (await readBody(c, promptBatch)).prompts,
      ),
    }),
  }),
  defineGetRoute({
    ...base,
    path: `${project}/prompt-sets/{prompt_set_id}/generation-runs`,
    params: { path: { ...projectPath, prompt_set_id: uuid }, query: pageQuery },
    response: pageSchema(generationRunSchema),
    handle: ({ c, db }, { path, query }) =>
      listGenerationRuns(db, c.get('workspace').workspaceId, path.prompt_set_id, query),
  }),
  defineGetRoute({
    ...base,
    path: `${project}/competitors`,
    params: { path: projectPath, query: {} },
    response: z.array(competitorSchema),
    handle: ({ c, db }, { path }) =>
      listCompetitors(db, {
        workspaceId: c.get('workspace').workspaceId,
        projectId: path.project_id,
      }),
  }),
  definePostRoute({
    ...base,
    scope: 'competitors:write',
    capability: 'write',
    status: 201,
    path: `${project}/competitors`,
    params: { path: projectPath, query: {} },
    body: competitorCreate,
    response: competitorSchema,
    handle: async ({ c, db }, { path }) =>
      addCompetitor(db, actorOf(c), path.project_id, await readBody(c, competitorCreate)),
  }),
  definePatchRoute({
    ...base,
    scope: 'competitors:write',
    capability: 'write',
    path: `${project}/competitors/{competitor_id}`,
    params: { path: { ...projectPath, competitor_id: uuid }, query: {} },
    body: competitorUpdate,
    response: competitorSchema,
    handle: async ({ c, db }, { path }) =>
      updateCompetitor(
        db,
        actorOf(c),
        path.project_id,
        path.competitor_id,
        await readBody(c, competitorUpdate),
      ),
  }),
  defineDeleteRoute({
    ...base,
    scope: 'competitors:write',
    capability: 'write',
    path: `${project}/competitors/{competitor_id}`,
    params: { path: { ...projectPath, competitor_id: uuid }, query: {} },
    handle: ({ c, db }, { path }) =>
      removeCompetitor(db, actorOf(c), path.project_id, path.competitor_id),
  }),
  defineGetRoute({
    ...base,
    path: `${project}/audits`,
    params: { path: projectPath, query: pageQuery },
    response: pageSchema(auditSchema),
    async handle({ c, db }, { path, query }) {
      const scope = { endpoint: 'audits', filters: { project_id: path.project_id } };
      const workspaceId = c.get('workspace').workspaceId;
      const after = cursorId(query.cursor, scope);
      // A cursor names an audit of this project; a deleted one cannot anchor a page.
      if (
        after !== null &&
        !(await db
          .selectFrom('audits')
          .select('id')
          .where('id', '=', after)
          .where('workspace_id', '=', workspaceId)
          .where('project_id', '=', path.project_id)
          .executeTakeFirst())
      )
        throw new ApiError(400, 'Invalid cursor', { code: 'invalid_cursor' });
      // One extra row says whether another page exists.
      const rows = await listAudits(
        db,
        workspaceId,
        path.project_id,
        query.limit + 1,
        after ?? undefined,
      );
      const items = rows.slice(0, query.limit);
      const last = items.at(-1);
      return {
        items,
        next_cursor: rows.length > query.limit && last ? nextCursor(scope, last.id) : null,
      };
    },
  }),
  definePostRoute({
    ...base,
    capability: 'read',
    scope: 'read',
    path: `${project}/audits/estimate`,
    params: { path: projectPath, query: {} },
    body: projectEstimate,
    response: auditEstimateSchema,
    handle: async ({ c, db, config }, { path }) =>
      estimateAudit(
        db,
        c.get('workspace').workspaceId,
        { ...(await readBody(c, projectEstimate)), project_id: path.project_id },
        auditRuntime(configEnvironment(config)),
      ),
  }),
  definePostRoute({
    ...base,
    scope: 'audits:run',
    capability: 'run',
    status: 201,
    path: `${project}/audits`,
    params: { path: projectPath, query: {} },
    body: auditLaunchInput,
    response: auditSchema.array(),
    handle: async ({ c, db, config }, { path }) =>
      launchAudit(db, config, actorOf(c), path.project_id, await readBody(c, auditLaunchInput)),
  }),
];
