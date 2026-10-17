/**
 * Projects + workspaces domain endpoints. Workspace-scoped; no `user_id`.
 * Every response passes through `strictValidate`.
 */
import { z } from 'zod';

import { apiClient, type ApiRequestOptions } from './client';
import { workspaceSchema } from '@citeladder/contracts/auth';
import {
  brandFactListSchema,
  brandFactSchema,
  type FactStatus,
  type FactTopic,
} from '@citeladder/contracts/fact-checking';
import { commandCenterSchema } from '@citeladder/contracts/opportunities';
import {
  overviewLayoutSchema,
  type OverviewLayout,
  type OverviewLayoutUpdate,
} from '@citeladder/contracts/overview';
import {
  brandProfileSchema,
  buyerTypeSchema,
  marketScopeSchema,
  businessMapSchema,
  projectSchema,
} from '@citeladder/contracts/project';
import { strictValidate } from '@citeladder/contracts/validation';
import { projectMarketSchema, type ProjectMarketCreate } from '@citeladder/contracts/markets';
import type {
  BrandProfile,
  BrandProfileDraft,
  BusinessMap,
  BusinessMapEntry,
  CommandCenter,
  EntityMatching,
  Project,
  Workspace,
} from './types';

const workspaceListSchema = z.array(workspaceSchema);
const projectListSchema = z.array(projectSchema);
const projectMarketListSchema = z.array(projectMarketSchema);

export type ProjectInput = {
  name: string;
  brand_name: string;
  website_url: string;
  country_code: string;
  language_code: string;
  benchmark_mode: Project['benchmark_mode'];
  default_repetitions: number;
  brand: { aliases: string[] };
  owned_domains: string[];
  unintended_domains: string[];
  competitors: Array<{ name: string; aliases: string[]; domains: string[] }>;
  /** Mention rules to save, by brand or competitor name. */
  entity_matching: Array<{
    name: string;
    mode: EntityMatching['mode'];
    context_terms: string[];
    exclusion_phrases: string[];
  }>;
};

export type BrandProfileUpdateInput = Partial<
  BrandProfileDraft & {
    category: string;
    buyer_type: z.infer<typeof buyerTypeSchema>;
    market_scope: z.infer<typeof marketScopeSchema>;
  }
>;

type BusinessMapEntryInput = Pick<BusinessMapEntry, 'value' | 'review_state'>;

/** A full business-map edit: every offering's entries and exclusions. */
export type BusinessMapUpdateInput = {
  offerings: Array<{
    offering: string;
    attributes: BusinessMapEntryInput[];
    situations: BusinessMapEntryInput[];
    audiences: BusinessMapEntryInput[];
    exclusions: Array<{ first: string; second: string }>;
  }>;
};

export const projectsApi = {
  listWorkspaces: async (options?: ApiRequestOptions) => {
    const res = await apiClient.get<Workspace[]>('/workspaces', options);
    return strictValidate(workspaceListSchema, res, 'projects.listWorkspaces');
  },
  listProjects: async (options?: ApiRequestOptions) => {
    const res = await apiClient.get<Project[]>('/projects', options);
    return strictValidate(projectListSchema, res, 'projects.listProjects');
  },
  getProject: async (projectId: string, options?: ApiRequestOptions) => {
    const res = await apiClient.get<Project>(`/projects/${projectId}`, options);
    return strictValidate(projectSchema, res, 'projects.getProject');
  },
  getCommandCenter: async (projectId: string, options?: ApiRequestOptions) => {
    const res = await apiClient.get<CommandCenter>(
      `/projects/${projectId}/command-center`,
      options,
    );
    return strictValidate(commandCenterSchema, res, 'projects.getCommandCenter');
  },
  getOverviewLayout: async (projectId: string, options?: ApiRequestOptions) => {
    const res = await apiClient.get<OverviewLayout>(
      `/projects/${projectId}/overview/layout`,
      options,
    );
    return strictValidate(overviewLayoutSchema, res, 'projects.getOverviewLayout');
  },
  /** `widgets: null` resets to the default layout. */
  updateOverviewLayout: async (
    projectId: string,
    input: OverviewLayoutUpdate,
    options?: ApiRequestOptions,
  ) => {
    const res = await apiClient.put<OverviewLayout>(
      `/projects/${projectId}/overview/layout`,
      input,
      options,
    );
    return strictValidate(overviewLayoutSchema, res, 'projects.updateOverviewLayout');
  },
  downloadOverviewReport: (projectId: string, options?: ApiRequestOptions) =>
    apiClient.getBlob(`/projects/${projectId}/overview/report.pdf`, options),
  createProject: async (input: ProjectInput, options?: ApiRequestOptions) => {
    const res = await apiClient.post<Project>('/projects', input, options);
    return strictValidate(projectSchema, res, 'projects.createProject');
  },
  updateProject: async (
    projectId: string,
    input: Partial<ProjectInput>,
    options?: ApiRequestOptions,
  ) => {
    const res = await apiClient.patch<Project>(`/projects/${projectId}`, input, options);
    return strictValidate(projectSchema, res, 'projects.updateProject');
  },
  deleteProject: (projectId: string, options?: ApiRequestOptions) =>
    apiClient.delete<void>(`/projects/${projectId}`, options),
  /** The project's measurement markets, its default first (`id: null`). */
  listMarkets: async (projectId: string, options?: ApiRequestOptions) => {
    const res = await apiClient.get(`/projects/${projectId}/markets`, options);
    return strictValidate(projectMarketListSchema, res, 'projects.listMarkets');
  },
  addMarket: async (projectId: string, input: ProjectMarketCreate, options?: ApiRequestOptions) => {
    const res = await apiClient.post(`/projects/${projectId}/markets`, input, options);
    return strictValidate(projectMarketListSchema, res, 'projects.addMarket');
  },
  deleteMarket: (projectId: string, marketId: string, options?: ApiRequestOptions) =>
    apiClient.delete<void>(`/projects/${projectId}/markets/${marketId}`, options),
  refreshProjectLogos: async (projectId: string, options?: ApiRequestOptions) => {
    const res = await apiClient.post<Project>(`/projects/${projectId}/logos/refresh`, {}, options);
    return strictValidate(projectSchema, res, 'projects.refreshProjectLogos');
  },
  getBrandProfile: async (projectId: string, options?: ApiRequestOptions) => {
    const res = await apiClient.get<BrandProfile>(`/projects/${projectId}/brand-profile`, options);
    return strictValidate(brandProfileSchema, res, 'projects.getBrandProfile');
  },
  updateBrandProfile: async (
    projectId: string,
    input: BrandProfileUpdateInput,
    options?: ApiRequestOptions,
  ) => {
    const res = await apiClient.put<BrandProfile>(
      `/projects/${projectId}/brand-profile`,
      input,
      options,
    );
    return strictValidate(brandProfileSchema, res, 'projects.updateBrandProfile');
  },
  /** The fact-checking pilot's brand facts; `enabled: false` outside the pilot. */
  getBrandFacts: async (projectId: string, options?: ApiRequestOptions) => {
    const res = await apiClient.get(`/projects/${projectId}/brand-facts`, options);
    return strictValidate(brandFactListSchema, res, 'projects.getBrandFacts');
  },
  createBrandFact: async (
    projectId: string,
    input: { topic: FactTopic; statement: string; source_url: string | null },
    options?: ApiRequestOptions,
  ) => {
    const res = await apiClient.post(`/projects/${projectId}/brand-facts`, input, options);
    return strictValidate(brandFactSchema, res, 'projects.createBrandFact');
  },
  /** Edit the revision that was read; a stale revision is a 409. */
  updateBrandFact: async (
    projectId: string,
    factId: string,
    input: {
      expected_revision: number;
      topic?: FactTopic;
      statement?: string;
      source_url?: string | null;
      status?: FactStatus;
    },
    options?: ApiRequestOptions,
  ) => {
    const res = await apiClient.patch(
      `/projects/${projectId}/brand-facts/${factId}`,
      input,
      options,
    );
    return strictValidate(brandFactSchema, res, 'projects.updateBrandFact');
  },
  getBusinessMap: async (projectId: string, options?: ApiRequestOptions) => {
    const res = await apiClient.get<BusinessMap>(`/projects/${projectId}/business-map`, options);
    return strictValidate(businessMapSchema, res, 'projects.getBusinessMap');
  },
  /** Replace the business map; surviving entries keep their provenance. */
  updateBusinessMap: async (
    projectId: string,
    input: BusinessMapUpdateInput,
    options?: ApiRequestOptions,
  ) => {
    const res = await apiClient.put<BusinessMap>(
      `/projects/${projectId}/business-map`,
      input,
      options,
    );
    return strictValidate(businessMapSchema, res, 'projects.updateBusinessMap');
  },
};
