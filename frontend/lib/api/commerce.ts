/** Typed Commerce catalog, discovery, prompt, and AI Shelf client. */
import { z } from 'zod';

import { apiClient, type ApiRequestOptions } from './client';
import { startInteractiveWork } from './interactive-work';
import { COMMERCE_BUYER_PROMPT_REQUEST_TIMEOUT_MS } from '@/lib/config/operational';
import { strictValidate } from '@citeladder/contracts/validation';
import {
  buyerPromptSchema,
  catalogImportSchema,
  commerceCatalogSchema,
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
  importCatalog: async (
    projectId: string,
    content: string,
    filename = 'catalog.csv',
    options?: ApiRequestOptions,
  ) =>
    strictValidate(
      catalogImportSchema,
      await apiClient.post(
        path(projectId, 'catalog/import'),
        {
          filename,
          content_type: 'text/csv',
          content,
        },
        options,
      ),
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
    targets: CommerceTarget[],
    options?: ApiRequestOptions,
  ) => {
    const discovery = strictValidate(
      competitorDiscoverySchema,
      await apiClient.post(path(projectId, 'competitors/discover'), { targets }, options),
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
    decision: 'approved' | 'rejected',
    options?: ApiRequestOptions,
  ) =>
    strictValidate(
      competitorCandidateSchema,
      await apiClient.patch(path(projectId, `competitors/${candidateId}`), { decision }, options),
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
    targets: CommerceTarget[],
    count: number,
    options?: ApiRequestOptions,
  ) =>
    strictValidate(
      z.array(buyerPromptSchema),
      await apiClient.post(
        path(projectId, 'buyer-prompts/generate'),
        { targets, count },
        { ...options, timeoutMs: COMMERCE_BUYER_PROMPT_REQUEST_TIMEOUT_MS },
      ),
      'commerce.generateBuyerPrompts',
    ),
  addBuyerPrompt: async (
    projectId: string,
    target: CommerceTarget,
    text: string,
    options?: ApiRequestOptions,
  ) =>
    strictValidate(
      buyerPromptSchema,
      await apiClient.post(path(projectId, 'buyer-prompts/manual'), { target, text }, options),
      'commerce.addBuyerPrompt',
    ),
  decideBuyerPrompt: async (
    projectId: string,
    promptId: string,
    approved: boolean,
    options?: ApiRequestOptions,
  ) =>
    strictValidate(
      buyerPromptSchema,
      await apiClient.patch(path(projectId, `buyer-prompts/${promptId}`), { approved }, options),
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
