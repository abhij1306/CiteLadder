/**
 * Projects + workspaces domain endpoints. Workspace-scoped; no `user_id`.
 * Every response passes through `strictValidate`.
 */
import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';

import { getBootstrapReadTimeoutMs } from '@/lib/config/operational';
import { apiClient, type ApiRequestOptions } from './client';
import { queryKeys } from './query-keys';
import { workspaceSchema } from '@citeladder/contracts/auth';
import { brandFactListSchema, brandFactSchema } from '@citeladder/contracts/fact-checking';
import { commandCenterSchema } from '@citeladder/contracts/opportunities';
import {
  overviewLayoutSchema,
  type OverviewLayout,
  type OverviewLayoutUpdate,
} from '@citeladder/contracts/overview';
import {
  brandProfileSchema,
  businessMapSchema,
  projectSchema,
} from '@citeladder/contracts/project';
import type {
  BrandFactCreateRequest,
  BrandFactUpdateRequest,
  BrandProfileUpdateRequest,
  BusinessMapUpdateRequest,
  ProjectCreateRequest,
  ProjectUpdateRequest,
} from '@citeladder/contracts/project-requests';
import { strictValidate } from '@citeladder/contracts/validation';
import { projectMarketSchema, type ProjectMarketCreate } from '@citeladder/contracts/markets';
import type {
  BrandProfile,
  BusinessMap,
  CommandCenter,
  Project,
  Workspace,
} from '@citeladder/contracts';

const workspaceListSchema = z.array(workspaceSchema);
const projectListSchema = z.array(projectSchema);
const projectMarketListSchema = z.array(projectMarketSchema);

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
  createProject: async (input: ProjectCreateRequest, options?: ApiRequestOptions) => {
    const res = await apiClient.post<Project>('/projects', input, options);
    return strictValidate(projectSchema, res, 'projects.createProject');
  },
  updateProject: async (
    projectId: string,
    input: ProjectUpdateRequest,
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
    input: BrandProfileUpdateRequest,
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
    input: BrandFactCreateRequest,
    options?: ApiRequestOptions,
  ) => {
    const res = await apiClient.post(`/projects/${projectId}/brand-facts`, input, options);
    return strictValidate(brandFactSchema, res, 'projects.createBrandFact');
  },
  /** Edit the revision that was read; a stale revision is a 409. */
  updateBrandFact: async (
    projectId: string,
    factId: string,
    input: BrandFactUpdateRequest,
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
    input: BusinessMapUpdateRequest,
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

/**
 * Project read options: the shell's reads, shared by the route loader and the
 * project context under one bounded bootstrap timeout, and the Overview's,
 * shared by the screen and navigation intent.
 */
export const projectQueries = {
  /** The Overview's composed projection of the project's persisted state. */
  commandCenter: (workspaceId: string, projectId: string) =>
    queryOptions({
      queryKey: queryKeys.projects.commandCenter(projectId),
      queryFn: ({ signal }) => projectsApi.getCommandCenter(projectId, { signal, workspaceId }),
    }),
  /** The company facts and audience the Agent's Context screen edits. */
  brandProfile: (workspaceId: string, projectId: string) =>
    queryOptions({
      queryKey: queryKeys.projects.brandProfile(projectId),
      queryFn: ({ signal }) => projectsApi.getBrandProfile(projectId, { signal, workspaceId }),
    }),
  /** The brand facts and the fact-checking pilot gate that decides Context's tabs. */
  brandFacts: (workspaceId: string | null, projectId: string) =>
    queryOptions({
      queryKey: queryKeys.projects.brandFacts(projectId),
      queryFn: ({ signal }) => projectsApi.getBrandFacts(projectId, { signal, workspaceId }),
    }),
  /** Which widgets the project's Overview shows; independent of the command center. */
  overviewLayout: (workspaceId: string, projectId: string) =>
    queryOptions({
      queryKey: queryKeys.projects.overviewLayout(projectId),
      queryFn: ({ signal }) => projectsApi.getOverviewLayout(projectId, { signal, workspaceId }),
    }),
  /**
   * One workspace's projects. Every listed project is the same authorized
   * object its detail read returns, so the list seeds those entries: opening
   * or switching to a listed project does not fetch it a second time.
   */
  list: (workspaceId: string) =>
    queryOptions({
      queryKey: queryKeys.projects.list(workspaceId),
      queryFn: async ({ client, signal }) => {
        const projects = await projectsApi.listProjects({
          signal,
          workspaceId,
          timeoutMs: getBootstrapReadTimeoutMs(),
        });
        for (const project of projects)
          client.setQueryData(queryKeys.projects.detail(project.id), project);
        return projects;
      },
    }),
  /** An explicit project, authorized from its path before any workspace is known. */
  detail: (projectId: string) =>
    queryOptions({
      queryKey: queryKeys.projects.detail(projectId),
      queryFn: ({ signal }) =>
        projectsApi.getProject(projectId, {
          signal,
          workspaceId: null,
          timeoutMs: getBootstrapReadTimeoutMs(),
        }),
    }),
};
