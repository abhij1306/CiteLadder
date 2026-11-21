import { mutationOptions, queryOptions, type QueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { projectThemeSchema, type ProjectTheme } from '@citeladder/contracts/project';
import type { ProjectThemeRequest } from '@citeladder/contracts/project-requests';
import { strictValidate } from '@citeladder/contracts/validation';

import { apiClient, type ApiRequestOptions } from './client';
import { queryKeys } from './query-keys';
import type { ProjectScope } from './query-keys/scope';

const themeListSchema = z.array(projectThemeSchema);

const themesApi = {
  list: async (projectId: string, options?: ApiRequestOptions) => {
    const res = await apiClient.get(`/projects/${projectId}/themes`, options);
    return strictValidate(themeListSchema, res, 'themes.list');
  },
  create: async (projectId: string, input: ProjectThemeRequest, options?: ApiRequestOptions) => {
    const res = await apiClient.post(`/projects/${projectId}/themes`, input, options);
    return strictValidate(projectThemeSchema, res, 'themes.create');
  },
  rename: async (
    projectId: string,
    themeId: string,
    input: ProjectThemeRequest,
    options?: ApiRequestOptions,
  ) => {
    const res = await apiClient.patch(`/projects/${projectId}/themes/${themeId}`, input, options);
    return strictValidate(projectThemeSchema, res, 'themes.rename');
  },
  remove: (projectId: string, themeId: string, options?: ApiRequestOptions) =>
    apiClient.delete<void>(`/projects/${projectId}/themes/${themeId}`, options),
};

const scoped = (scope: ProjectScope) => ({ workspaceId: scope.workspaceId });

export const themeQueries = {
  list: (scope: ProjectScope) =>
    queryOptions({
      queryKey: queryKeys.projects.themes(scope),
      queryFn: ({ signal }) => themesApi.list(scope.projectId, { signal, ...scoped(scope) }),
    }),
};

function refresh(client: QueryClient, projectId: string) {
  void client.invalidateQueries({ queryKey: queryKeys.projects.resource(projectId, 'themes') });
  void client.invalidateQueries({ queryKey: queryKeys.projects.resource(projectId, 'probes') });
  void client.invalidateQueries({ queryKey: queryKeys.visibility.project(projectId) });
}

export const themeMutations = {
  create: (scope: ProjectScope) =>
    mutationOptions({
      mutationFn: (name: string) => themesApi.create(scope.projectId, { name }, scoped(scope)),
      onSuccess: (_theme, _name, _result, { client }) => refresh(client, scope.projectId),
    }),
  rename: (scope: ProjectScope) =>
    mutationOptions({
      mutationFn: ({ theme, name }: { theme: ProjectTheme; name: string }) =>
        themesApi.rename(scope.projectId, theme.id, { name }, scoped(scope)),
      onSuccess: (_theme, _input, _result, { client }) => refresh(client, scope.projectId),
    }),
  remove: (scope: ProjectScope) =>
    mutationOptions({
      mutationFn: (theme: ProjectTheme) =>
        themesApi.remove(scope.projectId, theme.id, scoped(scope)),
      onSuccess: (_data, _theme, _result, { client }) => refresh(client, scope.projectId),
    }),
};
