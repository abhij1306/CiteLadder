import { mutationOptions, queryOptions, type QueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { PROMPT_GENERATION_REQUEST_TIMEOUT_MS } from '@/lib/config/operational';

import { apiClient, type ApiRequestOptions } from './client';
import { refreshPromptLibrary } from './prompts';
import { queryKeys } from './query-keys';
import type { ProjectScope } from './query-keys/scope';
import {
  seedQueriesResponseSchema,
  topicPreviewResponseSchema,
  topicSchema,
} from '@citeladder/contracts/project';
import type {
  TopicConfirmRequest,
  TopicCreateRequest,
  TopicUpdateRequest,
} from '@citeladder/contracts/prompt-requests';
import { strictValidate } from '@citeladder/contracts/validation';
import type { SeedQueries, Topic, TopicPreview } from '@citeladder/contracts';

const topicListSchema = z.array(topicSchema);

const topicsApi = {
  list: async (projectId: string, options?: ApiRequestOptions) => {
    const res = await apiClient.get<Topic[]>(`/projects/${projectId}/topics`, options);
    return strictValidate(topicListSchema, res, 'topics.list');
  },
  create: async (projectId: string, input: TopicCreateRequest, options?: ApiRequestOptions) => {
    const res = await apiClient.post<Topic>(`/projects/${projectId}/topics`, input, options);
    return strictValidate(topicSchema, res, 'topics.create');
  },
  update: async (topicId: string, input: TopicUpdateRequest, options?: ApiRequestOptions) => {
    const res = await apiClient.patch<Topic>(`/topics/${topicId}`, input, options);
    return strictValidate(topicSchema, res, 'topics.update');
  },
  remove: (topicId: string, options?: ApiRequestOptions) =>
    apiClient.delete<void>(`/topics/${topicId}`, options),
  preview: async (projectId: string, options?: ApiRequestOptions) => {
    const res = await apiClient.post<TopicPreview>(
      `/projects/${projectId}/topics/preview`,
      undefined,
      { timeoutMs: PROMPT_GENERATION_REQUEST_TIMEOUT_MS, ...options },
    );
    return strictValidate(topicPreviewResponseSchema, res, 'topics.preview');
  },
  confirm: async (projectId: string, input: TopicConfirmRequest, options?: ApiRequestOptions) => {
    const res = await apiClient.post<Topic[]>(
      `/projects/${projectId}/topics/confirm`,
      input,
      options,
    );
    return strictValidate(topicListSchema, res, 'topics.confirm');
  },
  seedQueries: async (projectId: string, options?: ApiRequestOptions) => {
    const res = await apiClient.get<SeedQueries>(`/projects/${projectId}/seed-queries`, options);
    return strictValidate(seedQueriesResponseSchema, res, 'topics.seedQueries');
  },
};

const scoped = (scope: ProjectScope) => ({ workspaceId: scope.workspaceId });

export const topicsQueries = {
  list: (scope: ProjectScope) =>
    queryOptions({
      queryKey: queryKeys.topics.list(scope),
      queryFn: ({ signal }) => topicsApi.list(scope.projectId, { signal, ...scoped(scope) }),
    }),
  seedQueries: (scope: ProjectScope) =>
    queryOptions({
      queryKey: queryKeys.topics.seedQueries(scope),
      queryFn: ({ signal }) => topicsApi.seedQueries(scope.projectId, { signal, ...scoped(scope) }),
    }),
};

export function refreshSeedQueries(client: QueryClient, projectId: string) {
  return client.invalidateQueries({ queryKey: queryKeys.topics.project(projectId) });
}

export const topicsMutations = {
  create: (scope: ProjectScope) =>
    mutationOptions({
      mutationFn: (input: TopicCreateRequest) =>
        topicsApi.create(scope.projectId, input, scoped(scope)),
      onSuccess: (_topic, _input, _result, { client }) =>
        refreshPromptLibrary(client, scope.projectId),
    }),
  rename: (scope: ProjectScope) =>
    mutationOptions({
      mutationFn: ({ topic, name }: { topic: Topic; name: string }) =>
        topicsApi.update(topic.id, { name }, scoped(scope)),
      onSuccess: (_topic, _input, _result, { client }) =>
        refreshPromptLibrary(client, scope.projectId),
    }),
  remove: (scope: ProjectScope) =>
    mutationOptions({
      mutationFn: (topic: Topic) => topicsApi.remove(topic.id, scoped(scope)),
      onSuccess: (_data, _topic, _result, { client }) =>
        refreshPromptLibrary(client, scope.projectId),
    }),
  preview: (scope: ProjectScope) =>
    mutationOptions({ mutationFn: () => topicsApi.preview(scope.projectId, scoped(scope)) }),
  confirm: (scope: ProjectScope) =>
    mutationOptions({
      mutationFn: (plan: TopicConfirmRequest) =>
        topicsApi.confirm(scope.projectId, plan, scoped(scope)),
      onSuccess: (_topics, _plan, _result, { client }) =>
        refreshPromptLibrary(client, scope.projectId),
    }),
};
