/** Typed Commerce catalog, product metrics, discovery and prompt client. */
import { mutationOptions, queryOptions, type QueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { apiClient, type ApiRequestOptions } from './client';
import { startInteractiveWork } from './interactive-work';
import { retainPreviousDataForScope } from './query-client';
import { queryKeys } from './query-keys';
import type { ProjectScope } from './query-keys/scope';
import {
  COMMERCE_BUYER_PROMPT_REQUEST_TIMEOUT_MS,
  COMMERCE_STORE_IMPORT_REQUEST_TIMEOUT_MS,
} from '@/lib/config/operational';
import { strictValidate } from '@citeladder/contracts/validation';
import type {
  BuyerPromptDecisionRequest,
  BuyerPromptGenerateRequest,
  BuyerPromptManualRequest,
  CatalogImportApplyRequest,
  CatalogImportRequest,
  CompetitorDecisionRequest,
  CompetitorDiscoveryRequest,
  ProductEditRequest,
  ProductLifecycleRequest,
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
  competitorDiscoverySchema,
  competitorDiscoveryTaskSchema,
  competitorCandidateSchema,
  type CommerceTarget,
  type CompetitorDiscoveryTask,
} from '@citeladder/contracts/commerce-suite';

const path = (projectId: string, suffix: string) => `/projects/${projectId}/commerce/${suffix}`;

export const commerceApi = {
  catalog: async (projectId: string, options?: ApiRequestOptions) =>
    strictValidate(
      commerceCatalogSchema,
      await apiClient.get(path(projectId, 'catalog'), options),
      'commerce.catalog',
    ),
  catalogProjection: async (projectId: string, options?: ApiRequestOptions) =>
    strictValidate(
      commerceProjectionSchema,
      await apiClient.get(path(projectId, 'catalog/projection'), options),
      'commerce.catalogProjection',
    ),
  stageImport: async (
    projectId: string,
    input: CatalogImportRequest,
    options?: ApiRequestOptions,
  ) =>
    strictValidate(
      catalogImportStageSchema,
      await apiClient.post(
        path(projectId, 'catalog/imports'),
        input,
        // A store import fetches the storefront before it answers.
        input.source === 'shopify'
          ? { ...options, timeoutMs: COMMERCE_STORE_IMPORT_REQUEST_TIMEOUT_MS }
          : options,
      ),
      'commerce.stageImport',
    ),
  applyImport: async (
    projectId: string,
    importId: string,
    input: CatalogImportApplyRequest,
    options?: ApiRequestOptions,
  ) =>
    strictValidate(
      catalogImportSchema,
      await apiClient.post(path(projectId, `catalog/imports/${importId}/apply`), input, options),
      'commerce.applyImport',
    ),
  competitors: async (projectId: string, options?: ApiRequestOptions) =>
    strictValidate(
      z.array(competitorCandidateSchema),
      await apiClient.get(path(projectId, 'competitors'), options),
      'commerce.competitors',
    ),
  discoverCompetitors: async (
    projectId: string,
    input: CompetitorDiscoveryRequest,
    options?: ApiRequestOptions,
  ) => {
    const discovery = strictValidate(
      competitorDiscoverySchema,
      await apiClient.post(path(projectId, 'competitors/discover'), input, options),
      'commerce.discoverCompetitors',
    );
    startInteractiveWork(path(projectId, 'competitors/discoveries/run'), options, discovery);
    return discovery;
  },
  /**
   * Discovery task status. Omitting `taskIds` asks the server for whatever is
   * still in flight for the project — the only form a page reload can recover
   * from, since ids held in component state do not survive one.
   */
  competitorDiscoveries: async (
    projectId: string,
    taskIds?: string[],
    options?: ApiRequestOptions,
  ) => {
    const query = (taskIds ?? []).map((id) => `task_ids=${encodeURIComponent(id)}`).join('&');
    const search = query ? `?${query}` : '';
    return strictValidate(
      z.array(competitorDiscoveryTaskSchema),
      await apiClient.get(`${path(projectId, 'competitors/discoveries')}${search}`, options),
      'commerce.competitorDiscoveries',
    );
  },
  decideCompetitor: async (
    projectId: string,
    candidateId: string,
    input: CompetitorDecisionRequest,
    options?: ApiRequestOptions,
  ) =>
    strictValidate(
      competitorCandidateSchema,
      await apiClient.patch(path(projectId, `competitors/${candidateId}`), input, options),
      'commerce.decideCompetitor',
    ),
  buyerPrompts: async (projectId: string, options?: ApiRequestOptions) =>
    strictValidate(
      z.array(buyerPromptSchema),
      await apiClient.get(path(projectId, 'buyer-prompts'), options),
      'commerce.buyerPrompts',
    ),
  generateBuyerPrompts: async (
    projectId: string,
    input: BuyerPromptGenerateRequest,
    options?: ApiRequestOptions,
  ) =>
    strictValidate(
      z.array(buyerPromptSchema),
      await apiClient.post(path(projectId, 'buyer-prompts/generate'), input, {
        ...options,
        timeoutMs: COMMERCE_BUYER_PROMPT_REQUEST_TIMEOUT_MS,
      }),
      'commerce.generateBuyerPrompts',
    ),
  addBuyerPrompt: async (
    projectId: string,
    input: BuyerPromptManualRequest,
    options?: ApiRequestOptions,
  ) =>
    strictValidate(
      buyerPromptSchema,
      await apiClient.post(path(projectId, 'buyer-prompts/manual'), input, options),
      'commerce.addBuyerPrompt',
    ),
  decideBuyerPrompt: async (
    projectId: string,
    promptId: string,
    input: BuyerPromptDecisionRequest,
    options?: ApiRequestOptions,
  ) =>
    strictValidate(
      buyerPromptSchema,
      await apiClient.patch(path(projectId, `buyer-prompts/${promptId}`), input, options),
      'commerce.decideBuyerPrompt',
    ),
  editProduct: async (
    projectId: string,
    productId: string,
    input: ProductEditRequest,
    options?: ApiRequestOptions,
  ) =>
    strictValidate(
      commerceProductSchema,
      await apiClient.patch(
        path(projectId, 'products/' + encodeURIComponent(productId)),
        input,
        options,
      ),
      'commerce.editProduct',
    ),
  setProductLifecycle: async (
    projectId: string,
    productId: string,
    input: ProductLifecycleRequest,
    options?: ApiRequestOptions,
  ) =>
    strictValidate(
      commerceProductSchema,
      await apiClient.put(
        path(projectId, `products/${encodeURIComponent(productId)}/lifecycle`),
        input,
        options,
      ),
      'commerce.setProductLifecycle',
    ),
  products: async (
    projectId: string,
    search: string,
    cursor: string | null,
    options?: ApiRequestOptions,
  ) => {
    const params = new URLSearchParams(search);
    if (cursor) params.set('cursor', cursor);
    return strictValidate(
      commerceProductPageSchema,
      await apiClient.get(`${path(projectId, 'products')}?${params.toString()}`, options),
      'commerce.products',
    );
  },
  overview: async (projectId: string, search: string, options?: ApiRequestOptions) =>
    strictValidate(
      commerceShoppingOverviewSchema,
      await apiClient.get(`${path(projectId, 'overview')}?${search}`, options),
      'commerce.overview',
    ),
  productDetail: async (
    projectId: string,
    holderId: string,
    search: string,
    options?: ApiRequestOptions,
  ) => {
    const resource = path(projectId, 'products/' + encodeURIComponent(holderId));
    return strictValidate(
      commerceProductDetailSchema,
      await apiClient.get(`${resource}?${search}`, options),
      'commerce.productDetail',
    );
  },
};

const scoped = (scope: ProjectScope, signal?: AbortSignal) => ({
  signal,
  workspaceId: scope.workspaceId,
});

/** Commerce reads: the Products screen and navigation intent share these keys. */
export const commerceQueries = {
  /** The catalog is the screen's navigation; while projections run, only their state polls. */
  catalog: (scope: ProjectScope) =>
    queryOptions({
      queryKey: queryKeys.commerce.catalog(scope),
      queryFn: ({ signal }) => commerceApi.catalog(scope.projectId, scoped(scope, signal)),
    }),
  catalogProjection: (scope: ProjectScope) =>
    queryOptions({
      queryKey: queryKeys.commerce.catalogProjection(scope),
      queryFn: ({ signal }) =>
        commerceApi.catalogProjection(scope.projectId, scoped(scope, signal)),
    }),
  /**
   * One Products page for the filters' query string (`productSearch`). The
   * project's previous page stays on screen while the next one loads, so a
   * filter or a page turn never empties the table; another project's never does.
   */
  products: (scope: ProjectScope, search: string, cursor: string | null) =>
    queryOptions({
      queryKey: queryKeys.commerce.products(scope, search, cursor),
      queryFn: ({ signal }) =>
        commerceApi.products(scope.projectId, search, cursor, scoped(scope, signal)),
      placeholderData: (previous, previousQuery) =>
        retainPreviousDataForScope(scope.projectId, previous, previousQuery),
    }),
  /** The Shopping overview; like a Products page, the project's previous one stays while the next loads. */
  overview: (scope: ProjectScope, search: string) =>
    queryOptions({
      queryKey: queryKeys.commerce.overview(scope, search),
      queryFn: ({ signal }) => commerceApi.overview(scope.projectId, search, scoped(scope, signal)),
      placeholderData: (previous, previousQuery) =>
        retainPreviousDataForScope(scope.projectId, previous, previousQuery),
    }),
  competitors: (scope: ProjectScope) =>
    queryOptions({
      queryKey: queryKeys.commerce.competitors(scope),
      queryFn: ({ signal }) => commerceApi.competitors(scope.projectId, scoped(scope, signal)),
    }),
  buyerPrompts: (scope: ProjectScope) =>
    queryOptions({
      queryKey: queryKeys.commerce.buyerPrompts(scope),
      queryFn: ({ signal }) => commerceApi.buyerPrompts(scope.projectId, scoped(scope, signal)),
    }),
  /**
   * One product holder's page for the window's query string (`window=30`).
   * The previous window's page stays on screen while the next one loads.
   */
  productDetail: (scope: ProjectScope, holderId: string, search: string) =>
    queryOptions({
      queryKey: queryKeys.commerce.productDetail(scope, holderId, search),
      queryFn: ({ signal }) =>
        commerceApi.productDetail(scope.projectId, holderId, search, scoped(scope, signal)),
      placeholderData: (previous, previousQuery) =>
        previous?.product.holder_id === holderId
          ? retainPreviousDataForScope(scope.projectId, previous, previousQuery)
          : undefined,
    }),
  /**
   * Discovery task status: the tracked ids, or, with none (after a reload),
   * whatever the server says is still in flight.
   */
  discoveries: (scope: ProjectScope, taskIds: readonly string[]) => {
    const queryKey = taskIds.length
      ? queryKeys.commerce.discoveryTasks(scope, taskIds)
      : queryKeys.commerce.activeDiscoveries(scope);
    return queryOptions({
      queryKey,
      // A discovery that finished since the previous read refreshes the
      // competitor candidates at once, rather than when every run is done.
      queryFn: async ({ client, signal }) => {
        const previous = client.getQueryData<DiscoveryTasks>(queryKey);
        const next = await commerceApi.competitorDiscoveries(
          scope.projectId,
          taskIds.length ? [...taskIds] : undefined,
          scoped(scope, signal),
        );
        if (discoveryFinished(previous, next)) void refreshCompetitors(client, scope.projectId);
        return next;
      },
    });
  },
};

type DiscoveryTasks = readonly CompetitorDiscoveryTask[];

/**
 * True when some discovery finished since the previous read, so its
 * candidates are worth fetching now rather than when every run is done.
 *
 * A tracked task that is terminal now and was not before (or was not read
 * yet) has finished. The reload path reads only what is still in flight, so
 * there a task that drops off the list has finished.
 */
export function discoveryFinished(
  previous: DiscoveryTasks | undefined,
  next: DiscoveryTasks,
): boolean {
  const before = new Map((previous ?? []).map((task) => [task.id, task.terminal]));
  if (next.some((task) => task.terminal && before.get(task.id) !== true)) return true;
  const present = new Set(next.map((task) => task.id));
  return [...before].some(([id, terminal]) => !terminal && !present.has(id));
}

/**
 * The project's catalog, after an import or once its projections settle.
 * `joinInFlight` keeps a read already under way rather than restarting it.
 */
export const refreshCatalog = (
  client: QueryClient,
  projectId: string,
  { joinInFlight = false }: { joinInFlight?: boolean } = {},
) =>
  client.invalidateQueries(
    { queryKey: queryKeys.commerce.resource(projectId, 'catalog') },
    { cancelRefetch: !joinInFlight },
  );

/** Every Products page and Shopping overview, after the catalog or the approved competitors change. */
const refreshProducts = (client: QueryClient, projectId: string) =>
  Promise.all(
    (['products', 'overview'] as const).map((resource) =>
      client.invalidateQueries({ queryKey: queryKeys.commerce.resource(projectId, resource) }),
    ),
  );

/** Every product page, after a product's catalog record or a competitor's state changes. */
const refreshProductDetails = (client: QueryClient, projectId: string) =>
  client.invalidateQueries({ queryKey: queryKeys.commerce.resource(projectId, 'product-detail') });

/** Every read a catalog product's edit, archive or restore changes. */
const refreshCatalogProduct = (client: QueryClient, projectId: string) =>
  Promise.all([
    refreshCatalog(client, projectId),
    refreshProducts(client, projectId),
    refreshProductDetails(client, projectId),
  ]);

/** The project's competitor candidates, after a decision or a finished discovery. */
const refreshCompetitors = (client: QueryClient, projectId: string) =>
  client.invalidateQueries({ queryKey: queryKeys.commerce.resource(projectId, 'competitors') });

const refreshBuyerPrompts = (client: QueryClient, projectId: string) =>
  client.invalidateQueries({ queryKey: queryKeys.commerce.resource(projectId, 'buyer-prompts') });

/** Commerce writes; each success refreshes every read it changes. */
export const commerceMutations = {
  /** Stage an import for review; nothing reaches the catalog until it is applied. */
  stageImport: (scope: ProjectScope) =>
    mutationOptions({
      mutationFn: (input: CatalogImportRequest) =>
        commerceApi.stageImport(scope.projectId, input, scoped(scope)),
    }),
  applyImport: (scope: ProjectScope) =>
    mutationOptions({
      mutationFn: ({ importId, ...input }: { importId: string } & CatalogImportApplyRequest) =>
        commerceApi.applyImport(scope.projectId, importId, input, scoped(scope)),
      onSuccess: (_result, _input, _context, { client }) =>
        Promise.all([
          refreshCatalog(client, scope.projectId),
          refreshProducts(client, scope.projectId),
          refreshProductDetails(client, scope.projectId),
        ]),
    }),
  discoverCompetitors: (scope: ProjectScope) =>
    mutationOptions({
      mutationFn: (targets: CommerceTarget[]) =>
        commerceApi.discoverCompetitors(scope.projectId, { targets }, scoped(scope)),
    }),
  decideCompetitor: (scope: ProjectScope) =>
    mutationOptions({
      mutationFn: ({ id, decision }: { id: string } & CompetitorDecisionRequest) =>
        commerceApi.decideCompetitor(scope.projectId, id, { decision }, scoped(scope)),
      onSuccess: (_candidate, _input, _context, { client }) =>
        Promise.all([
          refreshCompetitors(client, scope.projectId),
          refreshProducts(client, scope.projectId),
          refreshProductDetails(client, scope.projectId),
        ]),
    }),
  editProduct: (scope: ProjectScope) =>
    mutationOptions({
      mutationFn: ({ id, ...input }: { id: string } & ProductEditRequest) =>
        commerceApi.editProduct(scope.projectId, id, input, scoped(scope)),
      onSuccess: (_product, _input, _context, { client }) =>
        refreshCatalogProduct(client, scope.projectId),
    }),
  setProductLifecycle: (scope: ProjectScope) =>
    mutationOptions({
      mutationFn: ({ id, ...input }: { id: string } & ProductLifecycleRequest) =>
        commerceApi.setProductLifecycle(scope.projectId, id, input, scoped(scope)),
      onSuccess: (_product, _input, _context, { client }) =>
        refreshCatalogProduct(client, scope.projectId),
    }),
  /** Metered: a retry of one request sends the same key and is replayed, not run again. */
  generateBuyerPrompts: (scope: ProjectScope) =>
    mutationOptions({
      mutationFn: ({
        input,
        idempotencyKey,
      }: {
        input: BuyerPromptGenerateRequest;
        idempotencyKey: string;
      }) =>
        commerceApi.generateBuyerPrompts(scope.projectId, input, {
          ...scoped(scope),
          idempotencyKey,
        }),
      onSuccess: (_created, _input, _context, { client }) =>
        refreshBuyerPrompts(client, scope.projectId),
    }),
  addBuyerPrompt: (scope: ProjectScope) =>
    mutationOptions({
      mutationFn: (input: BuyerPromptManualRequest) =>
        commerceApi.addBuyerPrompt(scope.projectId, input, scoped(scope)),
      onSuccess: (_prompt, _input, _context, { client }) =>
        refreshBuyerPrompts(client, scope.projectId),
    }),
  decideBuyerPrompt: (scope: ProjectScope) =>
    mutationOptions({
      mutationFn: ({ id, approved }: { id: string; approved: boolean }) =>
        commerceApi.decideBuyerPrompt(scope.projectId, id, { approved }, scoped(scope)),
      onSuccess: (_prompt, _input, _context, { client }) =>
        refreshBuyerPrompts(client, scope.projectId),
    }),
};

/** The crawl's analyzed count the cached catalog was read beside. */
type CatalogReadCount = { readAt: number; count: number };

/**
 * A running crawl enqueues projections as pages are analyzed. Record the
 * analyzed count beside the catalog read it was seen with, and re-read the
 * catalog once that count moves past the recorded one. The count lives in the
 * cache next to the catalog, so a remount over a fresh catalog still sees a
 * count that moved meanwhile, and a catalog read just now is not read again
 * for a count it already reflects.
 */
export function followCatalogAnalysis(
  client: QueryClient,
  scope: ProjectScope,
  { readAt, analyzed }: { readAt: number; analyzed: number },
) {
  const key = queryKeys.commerce.catalogReadCount(scope);
  const recorded = client.getQueryData<CatalogReadCount>(key);
  if (!recorded || recorded.readAt !== readAt)
    client.setQueryData<CatalogReadCount>(key, { readAt, count: analyzed });
  else if (recorded.count !== analyzed) void refreshCatalog(client, scope.projectId);
}
