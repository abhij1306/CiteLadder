/**
 * Prompts domain endpoints: prompt-set CRUD, individual prompt edits,
 * import of browser-parsed CSV rows, AI generation via the
 * app-level default agent, and bulk review-status transitions. Every response
 * passes through `strictValidate`.
 */
import { z } from 'zod';

import { PROMPT_GENERATION_REQUEST_TIMEOUT_MS } from '@/lib/config/operational';

import { apiClient, type ApiRequestOptions } from './client';
import {
  promptCandidateReviewResponseSchema,
  promptCandidateSchema,
  promptGenerateResponseSchema,
  promptSchema,
  promptSetSchema,
  topicSchema,
} from '@citeladder/contracts/project';
import { strictValidate } from '@citeladder/contracts/validation';
import type {
  BuyerStage,
  Prompt,
  PromptCandidate,
  PromptCandidateReviewResponse,
  PromptGenerateResponse,
  PromptSet,
  PromptStatus,
  Topic,
} from './types';

const promptSetListSchema = z.array(promptSetSchema);
const promptCandidateListSchema = z.array(promptCandidateSchema);

export type PromptInput = {
  text: string;
  // Theme, intent and cohort are internal vocabulary: users are never asked
  // for them, and omitting them takes the backend's defaults. An omitted
  // cohort is filed by the backend: branded when the text names the brand.
  // Backend `PromptInput.theme` is a non-null `str = ""` — create/import 422 on null.
  theme?: string;
  intent?: Prompt['intent'];
  cohort?: Prompt['cohort'];
  enabled?: boolean;
  // Files the prompt under an existing topic at creation time. Onboarding
  // creates its topics first and passes this, rather than creating every
  // prompt and then PATCHing every prompt. Must name a topic of the prompt's
  // own project — the backend answers 404 otherwise.
  topic_id?: string;
};

/** One CSV import row: the user's topic NAME (created when new, '' = none). */
export type PromptImportRow = PromptInput & {
  topic: string;
  buyer_stage?: BuyerStage;
  persona?: string;
};

export type PromptUpdateInput = Partial<Omit<PromptInput, 'topic_id'>> & {
  status?: PromptStatus;
  buyer_stage?: BuyerStage;
  persona?: string;
  // Explicit null detaches the prompt from its topic.
  topic_id?: string | null;
};

export type PromptGenerateInput = {
  agent_revision_id?: string;
  count?: number;
  // Scope generation to existing topics; omitted or empty = every topic.
  topic_ids?: string[];
  // A short note for this run only; never saved as a business fact.
  run_context?: string;
  // Omitted = a core-only run with stages balanced; shares are 0–1.
  distribution?: {
    branded_share?: number;
    comparison_share?: number;
    intent_mix?: { informational: number; commercial: number; transactional: number };
    personas?: string[];
  };
  // Which persisted searches may steer wording; omitted = every source.
  seed_source?: 'search_console' | 'search_intelligence' | 'none';
  seed_query_ids?: string[];
};

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
  createPromptSet: async (
    input: { project_id: string; name?: string; description?: string },
    options?: ApiRequestOptions,
  ) => {
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
    input: { name: string; description?: string; parent_id?: string },
    options?: ApiRequestOptions,
  ) => {
    const res = await apiClient.post<Topic>(
      `/projects/${encodeURIComponent(projectId)}/topics`,
      input,
      options,
    );
    return strictValidate(topicSchema, res, 'prompts.createTopic');
  },
  createPrompt: async (promptSetId: string, input: PromptInput, options?: ApiRequestOptions) => {
    const res = await apiClient.post<Prompt>(`/prompt-sets/${promptSetId}/prompts`, input, options);
    return strictValidate(promptSchema, res, 'prompts.createPrompt');
  },
  updatePrompt: async (promptId: string, input: PromptUpdateInput, options?: ApiRequestOptions) => {
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
  importRows: async (promptSetId: string, rows: PromptImportRow[], options?: ApiRequestOptions) => {
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
    input: PromptGenerateInput,
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
    input: { accept_ids?: string[]; reject_ids?: string[] },
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
    input: { prompt_ids: string[]; status: PromptStatus },
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
