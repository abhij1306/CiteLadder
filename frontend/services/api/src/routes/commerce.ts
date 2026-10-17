import {
  COMMERCE_TARGETS_MAX,
  buyerPromptSchema,
  catalogImportSchema,
  commerceCatalogSchema,
  competitorCandidateSchema,
  competitorDiscoveryTaskSchema,
  competitorDiscoverySchema,
  shelfSchema,
} from '@citeladder/contracts/commerce-suite';
import type { Context } from 'hono';
import { z } from 'zod';

import { decideBuyerPrompt, decideCandidate } from '../commerce/decisions.ts';
import { discoveryInput, enqueueDiscoveries } from '../commerce/discovery.ts';
import { executeCompetitorDiscoveries } from '../commerce/interactive.ts';
import {
  buyerGenerateInput,
  buyerManualInput,
  generateBuyerPrompts,
  manualBuyerPrompt,
} from '../commerce/buyer-prompts.ts';
import { importCatalog } from '../commerce/import.ts';
import { buyerPrompts, candidates, catalog, discoveries, shelf } from '../commerce/reads.ts';
import { policy } from '../config.ts';
import type { AppEnv } from '../context.ts';
import type { Database } from '../db/database.ts';
import { ApiError } from '../errors.ts';
import { readBody } from '../http/body.ts';
import { requireProject } from '../projects/access.ts';
import { defineGetRoute, definePatchRoute, definePostRoute } from './define.ts';

const family = 'commerce';
const root = '/api/v1/projects/{project_id}/commerce';
const uuid = { scalar: { kind: 'uuid' }, required: true } as const;
const projectPath = { project_id: uuid } as const;
const importBody = z.object({
  content: z
    .string()
    .refine(
      (value) => Buffer.byteLength(value, 'utf8') <= policy.commerce.import_max_bytes,
      'CSV exceeds the byte limit',
    ),
  filename: z.string().max(255).default('catalog.csv'),
  content_type: z.string().max(128).default('text/csv'),
});
const candidateBody = z.object({
  decision: competitorCandidateSchema.shape.state.extract(['approved', 'rejected']),
});
const promptBody = z.object({ approved: z.boolean() });
const executeDiscoveriesBody = z
  .object({
    task_ids: z.array(z.uuid()).min(1).max(COMMERCE_TARGETS_MAX),
  })
  .strict();

async function scopeOf(db: Database, c: Context<AppEnv>, projectId: string) {
  const workspace = c.get('workspace');
  await requireProject(db, workspace, projectId);
  return { workspaceId: workspace.workspaceId, projectId };
}

/** Changes and new work need Commerce in the plan; reads of collected data do not. */
export const commerceRoutes = [
  definePostRoute({
    family,
    path: `${root}/competitors/discoveries/run`,
    capability: 'run',
    params: { path: projectPath, query: {} },
    body: executeDiscoveriesBody,
    response: z.array(competitorDiscoveryTaskSchema),
    async handle({ c, db, config }, { path }) {
      const scope = await scopeOf(db, c, path.project_id);
      const { task_ids } = await readBody(c, executeDiscoveriesBody);
      return executeCompetitorDiscoveries(db, config, scope, task_ids);
    },
  }),
  definePostRoute({
    family,
    path: `${root}/competitors/discover`,
    capability: 'run',
    status: 202,
    params: { path: projectPath, query: {} },
    body: discoveryInput,
    response: competitorDiscoverySchema,
    async handle({ c, db }, { path }) {
      return enqueueDiscoveries(
        db,
        await scopeOf(db, c, path.project_id),
        await readBody(c, discoveryInput),
      );
    },
  }),
  definePostRoute({
    family,
    path: `${root}/buyer-prompts/generate`,
    capability: 'run',
    status: 201,
    params: { path: projectPath, query: {} },
    body: buyerGenerateInput,
    response: z.array(buyerPromptSchema),
    async handle({ c, db }, { path }) {
      return generateBuyerPrompts(
        db,
        await scopeOf(db, c, path.project_id),
        await readBody(c, buyerGenerateInput),
      );
    },
  }),
  definePostRoute({
    family,
    path: `${root}/buyer-prompts/manual`,
    capability: 'write',
    status: 201,
    params: { path: projectPath, query: {} },
    body: buyerManualInput,
    response: buyerPromptSchema,
    async handle({ c, db }, { path }) {
      return manualBuyerPrompt(
        db,
        await scopeOf(db, c, path.project_id),
        await readBody(c, buyerManualInput),
      );
    },
  }),
  defineGetRoute({
    family,
    path: `${root}/catalog`,
    params: { path: projectPath, query: {} },
    response: commerceCatalogSchema,
    async handle({ c, db }, { path }) {
      return catalog(db, await scopeOf(db, c, path.project_id));
    },
  }),
  definePostRoute({
    family,
    path: `${root}/catalog/import`,
    capability: 'run',
    status: 201,
    params: { path: projectPath, query: {} },
    body: importBody,
    response: catalogImportSchema,
    async handle({ c, db }, { path }) {
      const scope = await scopeOf(db, c, path.project_id);
      return importCatalog(db, scope, await readBody(c, importBody));
    },
  }),
  defineGetRoute({
    family,
    path: `${root}/competitors`,
    params: { path: projectPath, query: {} },
    response: z.array(competitorCandidateSchema),
    async handle({ c, db }, { path }) {
      return candidates(db, await scopeOf(db, c, path.project_id));
    },
  }),
  defineGetRoute({
    family,
    path: `${root}/competitors/discoveries`,
    params: { path: projectPath, query: { task_ids: { scalar: { kind: 'uuid' }, list: true } } },
    response: z.array(competitorDiscoveryTaskSchema),
    async handle({ c, db }, { path, query }) {
      return discoveries(db, await scopeOf(db, c, path.project_id), query.task_ids);
    },
  }),
  definePatchRoute({
    family,
    path: `${root}/competitors/{candidate_id}`,
    capability: 'write',
    params: { path: { ...projectPath, candidate_id: uuid }, query: {} },
    body: candidateBody,
    response: competitorCandidateSchema,
    async handle({ c, db }, { path }) {
      const scope = await scopeOf(db, c, path.project_id);
      return decideCandidate(
        db,
        scope,
        path.candidate_id,
        (await readBody(c, candidateBody)).decision,
      );
    },
  }),
  defineGetRoute({
    family,
    path: `${root}/buyer-prompts`,
    params: { path: projectPath, query: {} },
    response: z.array(buyerPromptSchema),
    async handle({ c, db }, { path }) {
      return buyerPrompts(db, await scopeOf(db, c, path.project_id));
    },
  }),
  definePatchRoute({
    family,
    path: `${root}/buyer-prompts/{prompt_id}`,
    capability: 'write',
    params: { path: { ...projectPath, prompt_id: uuid }, query: {} },
    body: promptBody,
    response: buyerPromptSchema,
    async handle({ c, db }, { path }) {
      const scope = await scopeOf(db, c, path.project_id);
      return decideBuyerPrompt(db, scope, path.prompt_id, (await readBody(c, promptBody)).approved);
    },
  }),
  defineGetRoute({
    family,
    path: `${root}/ai-shelf`,
    params: {
      path: projectPath,
      query: {
        target_id: { scalar: { kind: 'uuid' } },
        target_kind: { scalar: { kind: 'literal', values: ['category', 'product'] } },
      },
    },
    response: shelfSchema,
    async handle({ c, db }, { path, query }) {
      const scope = await scopeOf(db, c, path.project_id);
      if (!query.target_kind || !query.target_id)
        throw new ApiError(422, 'AI Shelf requires a product or category target', {
          code: 'commerce_target_required',
        });
      return shelf(db, scope, { kind: query.target_kind, id: query.target_id });
    },
  }),
];
