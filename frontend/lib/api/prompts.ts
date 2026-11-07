/**
 * Prompts domain endpoints: prompt-set CRUD, individual prompt edits,
 * import of browser-parsed CSV rows, AI generation via the
 * app-level default agent, and bulk review-status transitions, with their
 * query and mutation descriptors. Every response passes through
 * `strictValidate`.
 */
import { z } from 'zod';
import { mutationOptions, queryOptions, skipToken, type QueryClient } from '@tanstack/react-query';

import { PROMPT_GENERATION_REQUEST_TIMEOUT_MS } from '@/lib/config/operational';

import { apiClient, type ApiRequestOptions } from './client';
import { queryKeys } from './query-keys';
import type { ProjectScope } from './query-keys/scope';
import {
  promptCandidateReviewResponseSchema,
  promptCandidateSchema,
  promptGenerateResponseSchema,
  promptSchema,
  promptSetListSchema,
  promptSetSchema,
} from '@citeladder/contracts/project';
import type {
  PromptBulkStatusRequest,
  PromptCandidateReviewRequest,
  PromptCreateRequest,
  PromptGenerateRequest,
  PromptImportRowRequest,
  PromptSetCreateRequest,
  PromptUpdateRequest,
} from '@citeladder/contracts/prompt-requests';
import { strictValidate } from '@citeladder/contracts/validation';
import type {
  Prompt,
  PromptCandidate,
  PromptCandidateReviewResponse,
  PromptGenerateResponse,
  PromptSet,
  PromptSetList,
} from '@citeladder/contracts';

const promptCandidateListSchema = z.array(promptCandidateSchema);

export const promptsApi = {
  /** The project's sets and the server-enforced bounds of the forms they open. */
  listPromptSets: async (projectId: string, options?: ApiRequestOptions) => {
    const res = await apiClient.get<PromptSetList>(
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

const scoped = (scope: ProjectScope) => ({ workspaceId: scope.workspaceId });

export const promptsQueries = {
  /** The project's prompt sets: the Prompts screen, its create guard and the launch dialog. */
  sets: (scope: ProjectScope) =>
    queryOptions({
      queryKey: queryKeys.prompts.sets(scope),
      queryFn: ({ signal }) =>
        promptsApi.listPromptSets(scope.projectId, { signal, ...scoped(scope) }),
    }),
  /** A set's pending generated candidates; skipped until the set exists. */
  candidates: (scope: ProjectScope, promptSetId: string | null) =>
    queryOptions({
      queryKey: queryKeys.prompts.candidates(scope, promptSetId),
      queryFn: promptSetId
        ? ({ signal }) => promptsApi.listCandidates(promptSetId, { signal, ...scoped(scope) })
        : skipToken,
    }),
};

/**
 * Every read a prompt-library write changes: the project's prompt sets and
 * candidates, its topics and the seed queries bound to them (generation and
 * import create topics), and the project list, whose embedded prompt sets
 * mark onboarding's "Add prompts" step done.
 */
export async function refreshPromptLibrary(client: QueryClient, projectId: string) {
  await Promise.all([
    client.invalidateQueries({ queryKey: queryKeys.prompts.project(projectId) }),
    client.invalidateQueries({ queryKey: queryKeys.topics.project(projectId) }),
    client.invalidateQueries({ queryKey: queryKeys.projects.all }),
  ]);
}

/** Resolves the set a write lands in, creating the project's default set when it has none. */
type SetResolver = () => Promise<PromptSet>;
const refreshed = (scope: ProjectScope) => ({
  onSuccess: (
    _data: unknown,
    _vars: unknown,
    _result: unknown,
    { client }: { client: QueryClient },
  ) => refreshPromptLibrary(client, scope.projectId),
});

/** Prompt-library writes; each success refreshes every read it changes. */
export const promptsMutations = {
  /**
   * The project's prompt set, created as the default set when the project has
   * none. The list is re-read first (joining a read already in flight), so an
   * empty cache is never taken for an empty project; a created set is written
   * into the list at once.
   */
  ensureSet: (scope: ProjectScope) =>
    mutationOptions({
      scope: { id: `ensure-prompt-set:${scope.workspaceId}:${scope.projectId}` },
      mutationFn: async (_vars: void, { client }) => {
        const available = await client.fetchQuery({
          ...promptsQueries.sets(scope),
          staleTime: 0,
        });
        const [first] = available.prompt_sets;
        if (first) return first;
        return promptsApi.createPromptSet(
          { project_id: scope.projectId, name: 'Default prompt set' },
          scoped(scope),
        );
      },
      onSuccess: async (created, _vars, _result, { client }) => {
        client.setQueryData<PromptSetList>(queryKeys.prompts.sets(scope), (prev) =>
          prev && !prev.prompt_sets.length ? { ...prev, prompt_sets: [created] } : prev,
        );
        await client.invalidateQueries({ queryKey: queryKeys.prompts.project(scope.projectId) });
      },
    }),
  create: (scope: ProjectScope, resolveSet: SetResolver) =>
    mutationOptions({
      mutationFn: async (input: PromptCreateRequest) =>
        promptsApi.createPrompt((await resolveSet()).id, input, scoped(scope)),
      ...refreshed(scope),
    }),
  update: (scope: ProjectScope) =>
    mutationOptions({
      mutationFn: ({ promptId, input }: { promptId: string; input: PromptUpdateRequest }) =>
        promptsApi.updatePrompt(promptId, input, scoped(scope)),
      ...refreshed(scope),
    }),
  remove: (scope: ProjectScope) =>
    mutationOptions({
      mutationFn: (promptId: string) => promptsApi.deletePrompt(promptId, scoped(scope)),
      ...refreshed(scope),
    }),
  import: (scope: ProjectScope, resolveSet: SetResolver) =>
    mutationOptions({
      mutationFn: async (rows: PromptImportRowRequest[]) =>
        promptsApi.importRows((await resolveSet()).id, rows, scoped(scope)),
      ...refreshed(scope),
    }),
  /**
   * A generation run. The caller owns the idempotency key so a retry of the
   * same request replays the staged run. A failed response can still follow a
   * completed run, so the library is re-read either way.
   */
  generate: (scope: ProjectScope, resolveSet: SetResolver) =>
    mutationOptions({
      mutationFn: async ({
        input,
        idempotencyKey,
      }: {
        input: PromptGenerateRequest;
        idempotencyKey: string;
      }) =>
        promptsApi.generate((await resolveSet()).id, input, {
          ...scoped(scope),
          idempotencyKey,
        }),
      onSettled: (_data, _error, _vars, _result, { client }) =>
        refreshPromptLibrary(client, scope.projectId),
    }),
  /** Accept or reject candidates; accepting adds tracked prompts. */
  reviewCandidates: (scope: ProjectScope) =>
    mutationOptions({
      mutationFn: ({
        promptSetId,
        input,
      }: {
        promptSetId: string;
        input: PromptCandidateReviewRequest;
      }) => promptsApi.reviewCandidates(promptSetId, input, scoped(scope)),
      ...refreshed(scope),
    }),
};
