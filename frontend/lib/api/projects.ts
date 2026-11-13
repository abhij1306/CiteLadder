/**
 * Projects domain endpoints (F2), with their query and mutation descriptors.
 * Workspace-scoped; no `user_id`. Every response passes through `strictValidate`.
 */
import { mutationOptions, queryOptions, type QueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { getBootstrapReadTimeoutMs } from '@/lib/config/operational';
import { apiClient, type ApiRequestOptions } from './client';
import { opportunitiesApi } from './opportunities';
import { queryKeys } from './query-keys';
import type { ProjectScope } from './query-keys/scope';
import { refreshSeedQueries } from './topics';
import { brandFactListSchema, brandFactSchema } from '@citeladder/contracts/fact-checking';
import { commandCenterSchema } from '@citeladder/contracts/opportunities';
import {
  overviewLayoutSchema,
  type OverviewLayout,
  type OverviewLayoutUpdate,
  type OverviewWidget,
} from '@citeladder/contracts/overview';
import {
  brandProfileSchema,
  businessMapSchema,
  projectSchema,
  projectSummarySchema,
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
  Opportunity,
  Project,
  ProjectSummary,
} from '@citeladder/contracts';

const projectSummaryListSchema = z.array(projectSummarySchema);
const projectMarketListSchema = z.array(projectMarketSchema);

export const projectsApi = {
  listProjects: async (options?: ApiRequestOptions) => {
    const res = await apiClient.get<ProjectSummary[]>('/projects', options);
    return strictValidate(projectSummaryListSchema, res, 'projects.listProjects');
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

const scoped = (scope: ProjectScope, signal?: AbortSignal) => ({
  signal,
  workspaceId: scope.workspaceId,
});

/**
 * Project read options: the shell's reads, shared by the route loader and the
 * project context under one bounded bootstrap timeout, and the Overview's,
 * shared by the screen and navigation intent.
 */
export const projectQueries = {
  /** The Overview's composed projection of the project's persisted state. */
  commandCenter: (scope: ProjectScope) =>
    queryOptions({
      queryKey: queryKeys.projects.commandCenter(scope),
      queryFn: ({ signal }) => projectsApi.getCommandCenter(scope.projectId, scoped(scope, signal)),
    }),
  /** The company facts and audience the Agent's Context screen edits. */
  brandProfile: (scope: ProjectScope) =>
    queryOptions({
      queryKey: queryKeys.projects.brandProfile(scope),
      queryFn: ({ signal }) => projectsApi.getBrandProfile(scope.projectId, scoped(scope, signal)),
    }),
  /** The offerings' buyers, jobs and terms that steer prompt generation. */
  businessMap: (scope: ProjectScope) =>
    queryOptions({
      queryKey: queryKeys.projects.businessMap(scope),
      queryFn: ({ signal }) => projectsApi.getBusinessMap(scope.projectId, scoped(scope, signal)),
    }),
  /** The brand facts and the fact-checking pilot gate that decides Context's tabs. */
  brandFacts: (scope: ProjectScope) =>
    queryOptions({
      queryKey: queryKeys.projects.brandFacts(scope),
      queryFn: ({ signal }) => projectsApi.getBrandFacts(scope.projectId, scoped(scope, signal)),
    }),
  /** The project's measurement markets, its default first: the market pickers' list. */
  markets: (scope: ProjectScope) =>
    queryOptions({
      queryKey: queryKeys.projects.markets(scope),
      queryFn: ({ signal }) => projectsApi.listMarkets(scope.projectId, scoped(scope, signal)),
    }),
  /** Which widgets the project's Overview shows; independent of the command center. */
  overviewLayout: (scope: ProjectScope) =>
    queryOptions({
      queryKey: queryKeys.projects.overviewLayout(scope),
      queryFn: ({ signal }) =>
        projectsApi.getOverviewLayout(scope.projectId, scoped(scope, signal)),
    }),
  /**
   * One workspace's projects as the switcher shows them. A summary is not a
   * project view: the active project is its own detail read.
   */
  list: (workspaceId: string) =>
    queryOptions({
      queryKey: queryKeys.projects.summaries(workspaceId),
      queryFn: ({ signal }) =>
        projectsApi.listProjects({
          signal,
          workspaceId,
          timeoutMs: getBootstrapReadTimeoutMs(),
        }),
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

/**
 * Re-read the shell after a failed bootstrap: the memberships and every
 * project read, so a retry recovers whichever of them failed.
 */
export function retryProjectShell(client: QueryClient) {
  return Promise.all([
    client.refetchQueries({ queryKey: queryKeys.workspaces.list() }),
    client.refetchQueries({ queryKey: queryKeys.projects.all }),
  ]);
}

/**
 * A workspace's project list after a project was created in it. A list read
 * already in flight predates the project, so it is dropped rather than joined.
 */
export async function refreshAfterProjectCreated(client: QueryClient, workspaceId: string) {
  const listKey = queryKeys.projects.summaries(workspaceId);
  await client.cancelQueries({ queryKey: listKey });
  void client.invalidateQueries({ queryKey: listKey });
}

/**
 * Look up brand and competitor logos after a write that set or changed the
 * project's domains: creation and a project edit. Opening the app never
 * fetches logos. The API answers from its own cache (negative entries
 * included) and rate-limits the lookup; a failure leaves the initials fallback
 * and is not retried. The project's list and detail reads carry the logo, and
 * they are re-read only when one was found.
 */
export function refreshBrandLogos(client: QueryClient, projectId: string, workspaceId: string) {
  void projectsApi
    .refreshProjectLogos(projectId, { workspaceId })
    .then((project) => {
      if (!project.brand.logo_url) return;
      return Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.projects.summaries(workspaceId) }),
        client.invalidateQueries({ queryKey: queryKeys.projects.detail(projectId) }),
      ]);
    })
    .catch(() => undefined);
}

/**
 * A saved brand profile is written into its read at once, and the Overview's
 * command center, which shows the company facts, re-reads.
 */
function profileSaved(client: QueryClient, scope: ProjectScope, profile: BrandProfile) {
  client.setQueryData(queryKeys.projects.brandProfile(scope), profile);
  void client.invalidateQueries({
    queryKey: queryKeys.projects.resource(scope.projectId, 'command-center'),
  });
}

const refreshBrandFacts = (client: QueryClient, projectId: string) =>
  client.invalidateQueries({ queryKey: queryKeys.projects.resource(projectId, 'brand-facts') });

/** A project scope whose workspace is known: writes always name one. */
type WorkspaceProjectScope = ProjectScope & Readonly<{ workspaceId: string }>;
/** The owners a business-step save writes; `null` leaves that owner as it is. */
type BusinessUpdate = Readonly<{
  profile: BrandProfileUpdateRequest | null;
  map: BusinessMapUpdateRequest | null;
}>;
/** The Overview's actions in their new order, and the order version that was read. */
type ActionOrder = Readonly<{ ordered: Opportunity[]; expectedVersion: number }>;

/** Project writes; each one refreshes or writes every read it changes. */
export const projectMutations = {
  /** Edit the project's settings; the website or a competitor's domains may change. */
  update: (scope: WorkspaceProjectScope) =>
    mutationOptions({
      mutationFn: (input: ProjectUpdateRequest) =>
        projectsApi.updateProject(scope.projectId, input, scoped(scope)),
      onSuccess: async (_project, _input, _result, { client }) => {
        refreshBrandLogos(client, scope.projectId, scope.workspaceId);
        await client.invalidateQueries({ queryKey: queryKeys.projects.all });
      },
    }),
  /**
   * Delete a project. Every project read is refreshed, and the result is the
   * workspace's list as it is after the deletion, so the caller can choose
   * where to go while the delete is still pending.
   */
  remove: (workspaceId: string | null) =>
    mutationOptions({
      mutationFn: async (projectId: string, { client }) => {
        await projectsApi.deleteProject(projectId, { workspaceId });
        await client.invalidateQueries({ queryKey: queryKeys.projects.all });
        return client.fetchQuery(projectQueries.list(String(workspaceId)));
      },
    }),
  /** Add a measurement market; the response is the project's new market list. */
  addMarket: (scope: ProjectScope) =>
    mutationOptions({
      mutationFn: (input: ProjectMarketCreate) =>
        projectsApi.addMarket(scope.projectId, input, scoped(scope)),
      onSuccess: (list, _input, _result, { client }) =>
        client.setQueryData(queryKeys.projects.markets(scope), list),
    }),
  /** Remove a measurement market; the runs that named it read differently now. */
  removeMarket: (scope: ProjectScope) =>
    mutationOptions({
      mutationFn: (marketId: string) =>
        projectsApi.deleteMarket(scope.projectId, marketId, scoped(scope)),
      onSuccess: (_data, _marketId, _result, { client }) => {
        void client.invalidateQueries({
          queryKey: queryKeys.projects.resource(scope.projectId, 'markets'),
        });
        void client.invalidateQueries({ queryKey: queryKeys.runs.all });
      },
    }),
  createBrandFact: (scope: ProjectScope) =>
    mutationOptions({
      mutationFn: (input: BrandFactCreateRequest) =>
        projectsApi.createBrandFact(scope.projectId, input, scoped(scope)),
      onSuccess: (_fact, _input, _result, { client }) => refreshBrandFacts(client, scope.projectId),
    }),
  /**
   * Edit the revision that was read. A refusal (a stale revision) re-reads
   * the facts too, so the next edit starts from the current revision.
   */
  updateBrandFact: (scope: ProjectScope) =>
    mutationOptions({
      mutationFn: ({ factId, input }: { factId: string; input: BrandFactUpdateRequest }) =>
        projectsApi.updateBrandFact(scope.projectId, factId, input, scoped(scope)),
      onSettled: (_fact, _error, _input, _result, { client }) =>
        refreshBrandFacts(client, scope.projectId),
    }),
  updateBrandProfile: (scope: ProjectScope) =>
    mutationOptions({
      mutationFn: (input: BrandProfileUpdateRequest) =>
        projectsApi.updateBrandProfile(scope.projectId, input, scoped(scope)),
      onSuccess: (profile, _input, _result, { client }) => {
        profileSaved(client, scope, profile);
        // Seed queries carry the category and offerings, so the builder rereads them.
        void refreshSeedQueries(client, scope.projectId);
      },
    }),
  /**
   * The Prompt Builder's business step: the profile first, so the map never
   * names an offering the profile does not list yet. Each owner is written
   * into its read as soon as it lands, so a map refusal keeps the saved profile.
   */
  saveBusiness: (scope: ProjectScope) =>
    mutationOptions({
      mutationFn: async ({ profile, map }: BusinessUpdate, { client }) => {
        if (profile) {
          const next = await projectsApi.updateBrandProfile(
            scope.projectId,
            profile,
            scoped(scope),
          );
          profileSaved(client, scope, next);
        }
        if (map) {
          const next = await projectsApi.updateBusinessMap(scope.projectId, map, scoped(scope));
          client.setQueryData(queryKeys.projects.businessMap(scope), next);
        }
      },
      // Offerings and category terms decide which searches seed a run.
      onSuccess: (_data, _input, _result, { client }) =>
        refreshSeedQueries(client, scope.projectId),
    }),
  /**
   * Save the Overview layout. A save names the version it edited, so a stale
   * save fails instead of overwriting someone else's arrangement; the layout
   * shows the edit at once, and a failed save rolls back and re-reads the
   * layout that won.
   */
  saveOverviewLayout: (scope: ProjectScope) => {
    const queryKey = queryKeys.projects.overviewLayout(scope);
    return mutationOptions({
      mutationFn: ({ widgets, version }: { widgets: OverviewWidget[] | null; version: number }) =>
        projectsApi.updateOverviewLayout(
          scope.projectId,
          { widgets, expected_version: version },
          scoped(scope),
        ),
      onMutate: async ({ widgets }, { client }) => {
        await client.cancelQueries({ queryKey });
        const previous = client.getQueryData<OverviewLayout>(queryKey);
        if (widgets && previous)
          client.setQueryData<OverviewLayout>(queryKey, { ...previous, widgets });
        return { previous };
      },
      onSuccess: (layout, _input, _result, { client }) => client.setQueryData(queryKey, layout),
      onError: (_error, _input, result, { client }) => {
        if (result?.previous) client.setQueryData(queryKey, result.previous);
        void client.invalidateQueries({ queryKey });
      },
    });
  },
  /**
   * Reorder the Overview's actions. The command center shows the new order at
   * once; a refusal (another reorder won the version) rolls it back, and
   * either way the order is re-read.
   */
  reorderActions: (scope: ProjectScope) => {
    const queryKey = queryKeys.projects.commandCenter(scope);
    return mutationOptions({
      mutationFn: ({ ordered, expectedVersion }: ActionOrder) =>
        opportunitiesApi.updateOrder(
          scope.projectId,
          {
            ordered_opportunity_ids: ordered.map((row) => row.id),
            expected_version: expectedVersion,
          },
          scoped(scope),
        ),
      onMutate: async ({ ordered }, { client }) => {
        await client.cancelQueries({ queryKey });
        const previous = client.getQueryData<CommandCenter>(queryKey);
        client.setQueryData<CommandCenter>(queryKey, (current) =>
          current ? { ...current, actions: ordered } : current,
        );
        return { previous };
      },
      onError: (_error, _input, result, { client }) => {
        if (result?.previous) client.setQueryData(queryKey, result.previous);
      },
      onSettled: (_data, _error, _input, _result, { client }) =>
        client.invalidateQueries({ queryKey }),
    });
  },
};
