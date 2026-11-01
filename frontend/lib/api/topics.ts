/**
 * Topics domain endpoints: first-class topical categories grouping prompts
 * within a project (topics rail + AI generation targets). Every response
 * passes through `strictValidate`.
 */
import { z } from 'zod';

import { PROMPT_GENERATION_REQUEST_TIMEOUT_MS } from '@/lib/config/operational';

import { apiClient, type ApiRequestOptions } from './client';
import {
  seedQueriesResponseSchema,
  topicPreviewResponseSchema,
  topicSchema,
} from '@citeladder/contracts/project';
import { strictValidate } from '@citeladder/contracts/validation';
import type { SeedQueries, Topic, TopicPreview } from './types';

const topicListSchema = z.array(topicSchema);

export const topicsApi = {
  list: async (projectId: string, options?: ApiRequestOptions) => {
    const res = await apiClient.get<Topic[]>(`/projects/${projectId}/topics`, options);
    return strictValidate(topicListSchema, res, 'topics.list');
  },
  create: async (
    projectId: string,
    // `parent_id` makes a subtopic of a top-level topic (one level deep).
    input: { name: string; description?: string; parent_id?: string },
    options?: ApiRequestOptions,
  ) => {
    const res = await apiClient.post<Topic>(`/projects/${projectId}/topics`, input, options);
    return strictValidate(topicSchema, res, 'topics.create');
  },
  update: async (
    topicId: string,
    input: { name?: string; description?: string },
    options?: ApiRequestOptions,
  ) => {
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
  confirm: async (projectId: string, input: TopicConfirmInput, options?: ApiRequestOptions) => {
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

export type TopicConfirmInput = {
  create: { name: string; offerings: string[] }[];
  rename: { id: string; name: string }[];
  delete: string[];
};
