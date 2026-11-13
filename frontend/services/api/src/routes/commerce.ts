import {
  buyerPromptDecisionRequestSchema,
  catalogImportApplyRequestSchema,
  catalogImportRequestSchema,
  competitorDecisionRequestSchema,
  competitorDiscoveryExecuteRequestSchema,
} from '@citeladder/contracts/commerce-requests';
import {
  buyerPromptSchema,
  catalogImportSchema,
  catalogImportStageSchema,
  commerceCatalogSchema,
  commerceProductDetailSchema,
  commerceProductPageSchema,
  commerceProductSchema,
  commerceProjectionSchema,
  commerceShoppingOverviewSchema,
  competitorCandidateSchema,
  competitorDiscoveryTaskSchema,
  competitorDiscoverySchema,
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
import {
  editProduct,
  productEditInput,
  productLifecycleInput,
  setProductLifecycle,
} from '../commerce/edits.ts';
import { applyImport, stageImport } from '../commerce/import.ts';
import { fetchShopifyStore } from '../commerce/shopify-store.ts';
import { shoppingOverview } from '../commerce/overview.ts';
import { productDetail } from '../commerce/product-detail.ts';
import { productMetrics } from '../commerce/products.ts';
import {
  buyerPrompts,
  candidates,
  catalog,
  catalogProjection,
  discoveries,
} from '../commerce/reads.ts';
import { policy } from '../config.ts';
import type { AppEnv } from '../context.ts';
import { ApiError } from '../errors.ts';
import { readBody } from '../http/body.ts';
import { defineGetRoute, definePatchRoute, definePostRoute, definePutRoute } from './define.ts';

/** Every route here reads the path project inside the active workspace. */
const family = { family: 'commerce', authorize: 'active-project' } as const;
const root = '/api/v1/projects/{project_id}/commerce';
const uuid = { scalar: { kind: 'uuid' }, required: true } as const;
const projectPath = { project_id: uuid } as const;
/** The executions a product read covers, shared by the table and the detail page. */
const windowParam = {
  scalar: { kind: 'int', ge: 1, le: 366 },
  default: policy.commerce.products.default_window_days,
} as const;
const engineParam = { scalar: { kind: 'str', minLength: 1, maxLength: 64 } } as const;
const promptSetParam = { scalar: { kind: 'uuid' } } as const;
const importBody = catalogImportRequestSchema.refine(
  (body) =>
    !('content' in body) ||
    Buffer.byteLength(body.content, 'utf8') <= policy.commerce.import_max_bytes,
  { message: 'The file exceeds the byte limit', path: ['content'] },
);
const applyBody = catalogImportApplyRequestSchema.refine(
  (body) => body.excluded_categories.length <= policy.commerce.import_max_rows,
  { message: 'Too many excluded categories', path: ['excluded_categories'] },
);
const candidateBody = competitorDecisionRequestSchema;
const promptBody = buyerPromptDecisionRequestSchema;
/** A retried generation with the same key replays the prompts its first attempt stored. */
const buyerGenerateHeaders = z.object({
  'Idempotency-Key': z
    .string()
    .max(policy.commerce.buyer_prompts.idempotency_key_max_chars)
    .nullish(),
});
const executeDiscoveriesBody = competitorDiscoveryExecuteRequestSchema;

function scopeOf(c: Context<AppEnv>, projectId: string) {
  return { workspaceId: c.get('workspace').workspaceId, projectId };
}

export const commerceRoutes = [
  definePostRoute({
    ...family,
    path: `${root}/competitors/discoveries/run`,
    capability: 'run',
    params: { path: projectPath, query: {} },
    body: executeDiscoveriesBody,
    response: z.array(competitorDiscoveryTaskSchema),
    async handle({ c, db, config }, { path }) {
      const scope = scopeOf(c, path.project_id);
      const { task_ids } = await readBody(c, executeDiscoveriesBody);
      return executeCompetitorDiscoveries(db, config, scope, task_ids);
    },
  }),
  definePostRoute({
    ...family,
    path: `${root}/competitors/discover`,
    capability: 'run',
    status: 202,
    params: { path: projectPath, query: {} },
    body: discoveryInput,
    response: competitorDiscoverySchema,
    async handle({ c, db }, { path }) {
      return enqueueDiscoveries(db, scopeOf(c, path.project_id), await readBody(c, discoveryInput));
    },
  }),
  definePostRoute({
    ...family,
    path: `${root}/buyer-prompts/generate`,
    capability: 'run',
    status: 201,
    params: { path: projectPath, query: {} },
    body: buyerGenerateInput,
    headers: buyerGenerateHeaders,
    response: z.array(buyerPromptSchema),
    async handle({ c, db }, { path }) {
      const key = c.req.header('Idempotency-Key')?.trim() || null;
      if (key && key.length > policy.commerce.buyer_prompts.idempotency_key_max_chars)
        throw new ApiError(422, 'Idempotency-Key is too long');
      return generateBuyerPrompts(
        db,
        scopeOf(c, path.project_id),
        await readBody(c, buyerGenerateInput),
        { idempotencyKey: key },
      );
    },
  }),
  definePostRoute({
    ...family,
    path: `${root}/buyer-prompts/manual`,
    capability: 'write',
    status: 201,
    params: { path: projectPath, query: {} },
    body: buyerManualInput,
    response: buyerPromptSchema,
    async handle({ c, db }, { path }) {
      return manualBuyerPrompt(
        db,
        scopeOf(c, path.project_id),
        await readBody(c, buyerManualInput),
      );
    },
  }),
  defineGetRoute({
    ...family,
    path: `${root}/catalog`,
    params: { path: projectPath, query: {} },
    response: commerceCatalogSchema,
    async handle({ c, db }, { path }) {
      return catalog(db, scopeOf(c, path.project_id));
    },
  }),
  defineGetRoute({
    ...family,
    path: `${root}/catalog/projection`,
    params: { path: projectPath, query: {} },
    response: commerceProjectionSchema,
    async handle({ c, db }, { path }) {
      return catalogProjection(db, scopeOf(c, path.project_id));
    },
  }),
  definePostRoute({
    ...family,
    path: `${root}/catalog/imports`,
    capability: 'run',
    status: 201,
    params: { path: projectPath, query: {} },
    body: importBody,
    response: catalogImportStageSchema,
    async handle({ c, db }, { path }) {
      const scope = scopeOf(c, path.project_id);
      const body = await readBody(c, importBody);
      if (body.source !== 'shopify')
        return stageImport(db, scope, {
          format: body.source,
          content: body.content,
          label: body.filename,
        });
      const store = await fetchShopifyStore(db, scope, body.store);
      return stageImport(db, scope, {
        format: 'shopify',
        content: store.content,
        label: store.host,
      });
    },
  }),
  definePostRoute({
    ...family,
    path: `${root}/catalog/imports/{import_id}/apply`,
    capability: 'run',
    params: { path: { ...projectPath, import_id: uuid }, query: {} },
    body: applyBody,
    response: catalogImportSchema,
    async handle({ c, db }, { path }) {
      const scope = scopeOf(c, path.project_id);
      const { excluded_categories } = await readBody(c, applyBody);
      return applyImport(db, scope, path.import_id, excluded_categories);
    },
  }),
  defineGetRoute({
    ...family,
    path: `${root}/products`,
    params: {
      path: projectPath,
      query: {
        source: {
          scalar: { kind: 'literal', values: ['catalog', 'all', 'archived'] },
          default: 'catalog',
        },
        category: { scalar: { kind: 'uuid' } },
        window: windowParam,
        engine: engineParam,
        prompt_set: promptSetParam,
        q: { scalar: { kind: 'str', maxLength: policy.commerce.products.search_max_chars } },
        sort: {
          scalar: { kind: 'literal', values: ['visibility', 'win_rate', 'position', 'name'] },
          default: 'visibility',
        },
        cursor: { scalar: { kind: 'str', minLength: 1, maxLength: 1024 } },
        limit: {
          scalar: { kind: 'int', ge: 1, le: policy.commerce.products.max_page_size },
          default: policy.commerce.products.page_size,
        },
      },
    },
    response: commerceProductPageSchema,
    async handle({ c, db }, { path, query }) {
      return productMetrics(db, scopeOf(c, path.project_id), {
        source: query.source,
        category: query.category,
        windowDays: query.window,
        engine: query.engine,
        promptSet: query.prompt_set,
        q: query.q,
        sort: query.sort,
        cursor: query.cursor,
        limit: query.limit,
      });
    },
  }),
  defineGetRoute({
    ...family,
    path: `${root}/overview`,
    params: {
      path: projectPath,
      query: { category: { scalar: { kind: 'uuid' } }, window: windowParam },
    },
    response: commerceShoppingOverviewSchema,
    async handle({ c, db }, { path, query }) {
      return shoppingOverview(db, scopeOf(c, path.project_id), {
        windowDays: query.window,
        category: query.category,
      });
    },
  }),
  defineGetRoute({
    ...family,
    path: `${root}/products/{holder_id}`,
    params: {
      path: { ...projectPath, holder_id: uuid },
      query: { window: windowParam, engine: engineParam, prompt_set: promptSetParam },
    },
    response: commerceProductDetailSchema,
    async handle({ c, db }, { path, query }) {
      return productDetail(db, scopeOf(c, path.project_id), path.holder_id, {
        windowDays: query.window,
        engine: query.engine,
        promptSet: query.prompt_set,
      });
    },
  }),
  definePatchRoute({
    ...family,
    path: `${root}/products/{holder_id}`,
    capability: 'write',
    params: { path: { ...projectPath, holder_id: uuid }, query: {} },
    body: productEditInput,
    response: commerceProductSchema,
    async handle({ c, db }, { path }) {
      const scope = scopeOf(c, path.project_id);
      return editProduct(db, scope, path.holder_id, await readBody(c, productEditInput));
    },
  }),
  definePutRoute({
    ...family,
    path: `${root}/products/{holder_id}/lifecycle`,
    capability: 'write',
    params: { path: { ...projectPath, holder_id: uuid }, query: {} },
    body: productLifecycleInput,
    response: commerceProductSchema,
    async handle({ c, db }, { path }) {
      const scope = scopeOf(c, path.project_id);
      const { lifecycle_state } = await readBody(c, productLifecycleInput);
      return setProductLifecycle(db, scope, path.holder_id, lifecycle_state);
    },
  }),
  defineGetRoute({
    ...family,
    path: `${root}/competitors`,
    params: { path: projectPath, query: {} },
    response: z.array(competitorCandidateSchema),
    async handle({ c, db }, { path }) {
      return candidates(db, scopeOf(c, path.project_id));
    },
  }),
  defineGetRoute({
    ...family,
    path: `${root}/competitors/discoveries`,
    params: { path: projectPath, query: { task_ids: { scalar: { kind: 'uuid' }, list: true } } },
    response: z.array(competitorDiscoveryTaskSchema),
    async handle({ c, db }, { path, query }) {
      return discoveries(db, scopeOf(c, path.project_id), query.task_ids);
    },
  }),
  definePatchRoute({
    ...family,
    path: `${root}/competitors/{candidate_id}`,
    capability: 'write',
    params: { path: { ...projectPath, candidate_id: uuid }, query: {} },
    body: candidateBody,
    response: competitorCandidateSchema,
    async handle({ c, db }, { path }) {
      const scope = scopeOf(c, path.project_id);
      return decideCandidate(
        db,
        scope,
        path.candidate_id,
        (await readBody(c, candidateBody)).decision,
      );
    },
  }),
  defineGetRoute({
    ...family,
    path: `${root}/buyer-prompts`,
    params: { path: projectPath, query: {} },
    response: z.array(buyerPromptSchema),
    async handle({ c, db }, { path }) {
      return buyerPrompts(db, scopeOf(c, path.project_id));
    },
  }),
  definePatchRoute({
    ...family,
    path: `${root}/buyer-prompts/{prompt_id}`,
    capability: 'write',
    params: { path: { ...projectPath, prompt_id: uuid }, query: {} },
    body: promptBody,
    response: buyerPromptSchema,
    async handle({ c, db }, { path }) {
      const scope = scopeOf(c, path.project_id);
      return decideBuyerPrompt(db, scope, path.prompt_id, (await readBody(c, promptBody)).approved);
    },
  }),
];
