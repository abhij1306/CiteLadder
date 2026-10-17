/**
 * Topics domain endpoints: first-class topical categories grouping prompts
 * within a project (topics rail + AI generation targets). Every response
 * passes through `strictValidate`.
 */
import { z } from 'zod';

import { apiClient, type ApiRequestOptions } from './client';
import { topicSchema } from '@citeladder/contracts/project';
import { strictValidate } from '@citeladder/contracts/validation';
import type { Topic } from './types';

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
};
