/**
 * Topics domain endpoints: first-class topical categories grouping prompts
 * within a project (topics rail + AI generation targets), with their query
 * and mutation descriptors. Every response passes through `strictValidate`.
 */
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
  // Deleting a topic detaches its prompts (topic_id -> null); prompts survive.
  remove: (topicId: string, options?: ApiRequestOptions) =>
    apiClient.delete<void>(`/topics/${topicId}`, options),
  /**
   * Buyer-facing topic proposals beside the existing topics. A metered model
   * call (429 when the workspace's provider-call window is spent, 422 without
   * saved offerings); nothing is written.
   */
  preview: async (projectId: string, options?: ApiRequestOptions) => {
    const res = await apiClient.post<TopicPreview>(
      `/projects/${projectId}/topics/preview`,
      undefined,
      { timeoutMs: PROMPT_GENERATION_REQUEST_TIMEOUT_MS, ...options },
    );
    return strictValidate(topicPreviewResponseSchema, res, 'topics.preview');
  },
  /**
   * Apply a reviewed topic plan at once: delete, rename, then create. A
   * created proposal names the offerings it covers. 409 on a name collision,
   * and then nothing is applied.
   */
  confirm: async (projectId: string, input: TopicConfirmRequest, options?: ApiRequestOptions) => {
    const res = await apiClient.post<Topic[]>(
      `/projects/${projectId}/topics/confirm`,
      input,
      options,
    );
    return strictValidate(topicListSchema, res, 'topics.confirm');
  },
  /** Searches generation would ground on, per persisted source; no weights. */
  seedQueries: async (projectId: string, options?: ApiRequestOptions) => {
    const res = await apiClient.get<SeedQueries>(`/projects/${projectId}/seed-queries`, options);
    return strictValidate(seedQueriesResponseSchema, res, 'topics.seedQueries');
  },
};

const scoped = (scope: ProjectScope) => ({ workspaceId: scope.workspaceId });

export const topicsQueries = {
  /** The project's topics: the library's topic filter and the Prompt Builder. */
  list: (scope: ProjectScope) =>
    queryOptions({
      queryKey: queryKeys.topics.list(scope),
      queryFn: ({ signal }) => topicsApi.list(scope.projectId, { signal, ...scoped(scope) }),
    }),
  /** The searches generation would ground on. */
  seedQueries: (scope: ProjectScope) =>
    queryOptions({
      queryKey: queryKeys.topics.seedQueries(scope),
      queryFn: ({ signal }) => topicsApi.seedQueries(scope.projectId, { signal, ...scoped(scope) }),
    }),
};

/**
 * Seed queries derive from the topics and the saved business context, so a
 * write to either refreshes them; this is the one place that says so.
 */
export function refreshSeedQueries(client: QueryClient, projectId: string) {
  return client.invalidateQueries({ queryKey: queryKeys.topics.project(projectId) });
}

/**
 * Topic writes. Each success refreshes the prompt library (topics, the seed
 * queries bound to them, and the prompts filed under them).
 */
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
  /** Deleting a topic detaches its prompts; the prompts survive. */
  remove: (scope: ProjectScope) =>
    mutationOptions({
      mutationFn: (topic: Topic) => topicsApi.remove(topic.id, scoped(scope)),
      onSuccess: (_data, _topic, _result, { client }) =>
        refreshPromptLibrary(client, scope.projectId),
    }),
  /** Proposals beside the existing topics; a metered call that writes nothing. */
  preview: (scope: ProjectScope) =>
    mutationOptions({ mutationFn: () => topicsApi.preview(scope.projectId, scoped(scope)) }),
  /** Apply a reviewed topic plan at once. */
  confirm: (scope: ProjectScope) =>
    mutationOptions({
      mutationFn: (plan: TopicConfirmRequest) =>
        topicsApi.confirm(scope.projectId, plan, scoped(scope)),
      onSuccess: (_topics, _plan, _result, { client }) =>
        refreshPromptLibrary(client, scope.projectId),
    }),
};
