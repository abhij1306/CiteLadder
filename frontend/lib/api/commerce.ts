/** Typed Commerce catalog, discovery, prompt, and AI Shelf client. */
import { z } from 'zod';

import { apiClient, type ApiRequestOptions } from './client';
import { startInteractiveWork } from './interactive-work';
import { COMMERCE_BUYER_PROMPT_REQUEST_TIMEOUT_MS } from '@/lib/config/operational';
import { strictValidate } from '@citeladder/contracts/validation';
import type {
  BuyerPromptDecisionRequest,
  BuyerPromptGenerateRequest,
  BuyerPromptManualRequest,
  CatalogImportRequest,
  CompetitorDecisionRequest,
  CompetitorDiscoveryRequest,
} from '@citeladder/contracts/commerce-requests';
import {
  buyerPromptSchema,
  catalogImportSchema,
  commerceCatalogSchema,
  commerceProjectionSchema,
  competitorDiscoverySchema,
  competitorDiscoveryTaskSchema,
  competitorCandidateSchema,
  shelfSchema,
  type CommerceTarget,
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
  importCatalog: async (
    projectId: string,
    input: CatalogImportRequest,
    options?: ApiRequestOptions,
  ) =>
    strictValidate(
      catalogImportSchema,
      await apiClient.post(path(projectId, 'catalog/import'), input, options),
      'commerce.importCatalog',
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
  shelf: async (projectId: string, target: CommerceTarget, options?: ApiRequestOptions) =>
    strictValidate(
      shelfSchema,
      await apiClient.get(
        `${path(projectId, 'ai-shelf')}?target_kind=${target.kind}&target_id=${encodeURIComponent(target.id)}`,
        options,
      ),
      'commerce.shelf',
    ),
};
