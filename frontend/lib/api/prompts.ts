/**
 * Prompts domain endpoints: prompt-set CRUD, individual prompt edits,
 * import of browser-parsed CSV rows, AI generation via the
 * app-level default agent, and bulk review-status transitions. Every response
 * passes through `strictValidate`.
 */
import { z } from 'zod';
import { queryOptions } from '@tanstack/react-query';

import { PROMPT_GENERATION_REQUEST_TIMEOUT_MS } from '@/lib/config/operational';

import { apiClient, type ApiRequestOptions } from './client';
import { queryKeys } from './query-keys';
import {
  promptCandidateReviewResponseSchema,
  promptCandidateSchema,
  promptGenerateResponseSchema,
  promptSchema,
  promptSetSchema,
  topicSchema,
} from '@citeladder/contracts/project';
import type {
  PromptBulkStatusRequest,
  PromptCandidateReviewRequest,
  PromptCreateRequest,
  PromptGenerateRequest,
  PromptImportRowRequest,
  PromptSetCreateRequest,
  PromptUpdateRequest,
  TopicCreateRequest,
} from '@citeladder/contracts/prompt-requests';
import { strictValidate } from '@citeladder/contracts/validation';
import type {
  Prompt,
  PromptCandidate,
  PromptCandidateReviewResponse,
  PromptGenerateResponse,
  PromptSet,
  Topic,
} from '@citeladder/contracts';

const promptSetListSchema = z.array(promptSetSchema);
const promptCandidateListSchema = z.array(promptCandidateSchema);

export const promptsApi = {
  listPromptSets: async (projectId: string, options?: ApiRequestOptions) => {
    const res = await apiClient.get<PromptSet[]>(
      `/prompt-sets?project_id=${encodeURIComponent(projectId)}`,
      options,
    );
    return strictValidate(promptSetListSchema, res, 'prompts.listPromptSets');
  },
  getPromptSet: async (promptSetId: string, options?: ApiRequestOptions) => {
    const res = await apiClient.get<PromptSet>(`/prompt-sets/${promptSetId}`, options);
    return strictValidate(promptSetSchema, res, 'prompts.getPromptSet');
  },
  createPromptSet: async (input: PromptSetCreateRequest, options?: ApiRequestOptions) => {
    const res = await apiClient.post<PromptSet>('/prompt-sets', input, options);
    return strictValidate(promptSetSchema, res, 'prompts.createPromptSet');
  },
  /**
   * Create a topic on a project. Onboarding calls this once per topic the
   * agent proposed, then files each prompt under the returned id — mirroring
   * what `/generate` does server-side, so an onboarded prompt set has the same
   * topic structure as a generated one.
   *
   * Answers 409 when a topic of that name already exists on the project
   * (uniqueness is case-insensitive).
   */
  createTopic: async (
    projectId: string,
    input: TopicCreateRequest,
    options?: ApiRequestOptions,
  ) => {
    const res = await apiClient.post<Topic>(
      `/projects/${encodeURIComponent(projectId)}/topics`,
      input,
      options,
    );
    return strictValidate(topicSchema, res, 'prompts.createTopic');
  },
  createPrompt: async (
    promptSetId: string,
    input: PromptCreateRequest,
    options?: ApiRequestOptions,
  ) => {
    const res = await apiClient.post<Prompt>(`/prompt-sets/${promptSetId}/prompts`, input, options);
    return strictValidate(promptSchema, res, 'prompts.createPrompt');
  },
  updatePrompt: async (
    promptId: string,
    input: PromptUpdateRequest,
    options?: ApiRequestOptions,
  ) => {
    const res = await apiClient.patch<Prompt>(`/prompts/${promptId}`, input, options);
    return strictValidate(promptSchema, res, 'prompts.updatePrompt');
  },
  deletePrompt: (promptId: string, options?: ApiRequestOptions) =>
    apiClient.delete<void>(`/prompts/${promptId}`, options),
  /**
   * Persist browser-parsed rows through `/import`: a JSON body of
   * `{ prompts: [...] }` (rows already parsed and previewed in the browser),
   * bulk-created with `origin='imported'`.
   */
  importRows: async (
    promptSetId: string,
    rows: PromptImportRowRequest[],
    options?: ApiRequestOptions,
  ) => {
    const res = await apiClient.post<PromptSet>(
      `/prompt-sets/${promptSetId}/import`,
      { prompts: rows },
      options,
    );
    return strictValidate(promptSetSchema, res, 'prompts.importRows');
  },
  /**
   * AI prompt generation via the app-level default agent. Validated
   * suggestions are staged as candidates for review; nothing is tracked until
   * accepted. Errors: 409 key reused for another request, 422 invalid, 502
   * agent/output failure, 503 when no default agent is configured. Pass an
   * `idempotencyKey` so a retry replays a run the server already staged.
   */
  generate: async (
    promptSetId: string,
    input: PromptGenerateRequest,
    options?: ApiRequestOptions,
  ) => {
    const res = await apiClient.post<PromptGenerateResponse>(
      `/prompt-sets/${promptSetId}/generate`,
      input,
      { timeoutMs: PROMPT_GENERATION_REQUEST_TIMEOUT_MS, ...options },
    );
    return strictValidate(promptGenerateResponseSchema, res, 'prompts.generate');
  },
  /** Pending, unexpired generated candidates awaiting review. */
  listCandidates: async (promptSetId: string, options?: ApiRequestOptions) => {
    const res = await apiClient.get<PromptCandidate[]>(
      `/prompt-sets/${promptSetId}/candidates`,
      options,
    );
    return strictValidate(promptCandidateListSchema, res, 'prompts.listCandidates');
  },
  /**
   * Accept candidates as active prompts (403 when over prompt capacity) or
   * reject them (deleted). Already-reviewed or expired ids are counted as
   * unavailable, so a repeated submit is harmless.
   */
  reviewCandidates: async (
    promptSetId: string,
    input: PromptCandidateReviewRequest,
    options?: ApiRequestOptions,
  ) => {
    const res = await apiClient.post<PromptCandidateReviewResponse>(
      `/prompt-sets/${promptSetId}/candidates/review`,
      input,
      options,
    );
    return strictValidate(promptCandidateReviewResponseSchema, res, 'prompts.reviewCandidates');
  },
  /** Bulk review transition (accept-all / archive-selected). */
  bulkStatus: async (
    promptSetId: string,
    input: PromptBulkStatusRequest,
    options?: ApiRequestOptions,
  ) => {
    const res = await apiClient.post<PromptSet>(
      `/prompt-sets/${promptSetId}/prompts/bulk-status`,
      input,
      options,
    );
    return strictValidate(promptSetSchema, res, 'prompts.bulkStatus');
  },
};

export const promptsQueries = {
  /** The project's prompt sets: the Prompts screen, its create guard and the launch dialog. */
  sets: (workspaceId: string | null, projectId: string) =>
    queryOptions({
      queryKey: queryKeys.prompts.sets(workspaceId, projectId),
      queryFn: ({ signal }) => promptsApi.listPromptSets(projectId, { signal, workspaceId }),
    }),
};
