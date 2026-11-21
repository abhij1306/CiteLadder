/**
 * Prompts domain endpoints: prompt-set CRUD, individual prompt edits,
 * import of browser-parsed CSV rows and AI generation via the
 * app-level default agent, with their query and mutation descriptors. Every response passes through
 * `strictValidate`.
 */
import { z } from 'zod';
import { mutationOptions, queryOptions, skipToken, type QueryClient } from '@tanstack/react-query';

import { PROMPT_GENERATION_REQUEST_TIMEOUT_MS } from '@/lib/config/operational';

import { apiClient, type ApiRequestOptions } from './client';
import { mainPromptSet } from '@/lib/prompts/prompt-sets';

import { queryKeys } from './query-keys';
import type { ProjectScope } from './query-keys/scope';
import {
  promptBulkResultSchema,
  promptCandidateReviewResponseSchema,
  promptCandidateSchema,
  promptGenerateResponseSchema,
  promptSchema,
  promptSetListSchema,
  promptSetSchema,
} from '@citeladder/contracts/project';
import type {
  PromptBulkDeleteRequest,
  PromptBulkStatusRequest,
  PromptBulkTopicRequest,
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
  PromptStatus,
} from '@citeladder/contracts';

const promptCandidateListSchema = z.array(promptCandidateSchema);

export const promptsApi = {
  listPromptSets: async (projectId: string, options?: ApiRequestOptions) => {
    const res = await apiClient.get<PromptSetList>(
      `/prompt-sets?project_id=${encodeURIComponent(projectId)}`,
      options,
    );
    return strictValidate(promptSetListSchema, res, 'prompts.listPromptSets');
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
  bulkTopic: async (
    projectId: string,
    input: PromptBulkTopicRequest,
    options?: ApiRequestOptions,
  ) => {
    const res = await apiClient.post<unknown>(
      `/projects/${projectId}/prompts/bulk-topic`,
      input,
      options,
    );
    return strictValidate(promptBulkResultSchema, res, 'prompts.bulkTopic');
  },
  bulkDelete: async (
    projectId: string,
    input: PromptBulkDeleteRequest,
    options?: ApiRequestOptions,
  ) => {
    const res = await apiClient.post<unknown>(
      `/projects/${projectId}/prompts/bulk-delete`,
      input,
      options,
    );
    return strictValidate(promptBulkResultSchema, res, 'prompts.bulkDelete');
  },
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
  listCandidates: async (promptSetId: string, options?: ApiRequestOptions) => {
    const res = await apiClient.get<PromptCandidate[]>(
      `/prompt-sets/${promptSetId}/candidates`,
      options,
    );
    return strictValidate(promptCandidateListSchema, res, 'prompts.listCandidates');
  },
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
};

const scoped = (scope: ProjectScope) => ({ workspaceId: scope.workspaceId });

export const promptsQueries = {
  sets: (scope: ProjectScope) =>
    queryOptions({
      queryKey: queryKeys.prompts.sets(scope),
      queryFn: ({ signal }) =>
        promptsApi.listPromptSets(scope.projectId, { signal, ...scoped(scope) }),
    }),
  candidates: (scope: ProjectScope, promptSetId: string | null) =>
    queryOptions({
      queryKey: queryKeys.prompts.candidates(scope, promptSetId),
      queryFn: promptSetId
        ? ({ signal }) => promptsApi.listCandidates(promptSetId, { signal, ...scoped(scope) })
        : skipToken,
    }),
};

export async function refreshPromptLibrary(client: QueryClient, projectId: string) {
  await Promise.all([
    client.invalidateQueries({ queryKey: queryKeys.prompts.project(projectId) }),
    client.invalidateQueries({ queryKey: queryKeys.topics.project(projectId) }),
    client.invalidateQueries({ queryKey: queryKeys.projects.all }),
  ]);
}

export type PromptBulkChange =
  | { kind: 'status'; status: PromptStatus }
  | { kind: 'topic'; topicId: string | null }
  | { kind: 'delete' };

type SetResolver = () => Promise<PromptSet>;
const refreshed = (scope: ProjectScope) => ({
  onSuccess: (
    _data: unknown,
    _vars: unknown,
    _result: unknown,
    { client }: { client: QueryClient },
  ) => refreshPromptLibrary(client, scope.projectId),
});

export const promptsMutations = {
  ensureSet: (scope: ProjectScope) =>
    mutationOptions({
      scope: { id: `ensure-prompt-set:${scope.workspaceId}:${scope.projectId}` },
      mutationFn: async (_vars: void, { client }) => {
        const available = await client.fetchQuery({
          ...promptsQueries.sets(scope),
          staleTime: 0,
        });
        const main = mainPromptSet(available.prompt_sets);
        if (main) return main;
        return promptsApi.createPromptSet(
          { project_id: scope.projectId, name: 'Default prompt set' },
          scoped(scope),
        );
      },
      onSuccess: async (created, _vars, _result, { client }) => {
        client.setQueryData<PromptSetList>(queryKeys.prompts.sets(scope), (prev) =>
          prev && !prev.prompt_sets.some((set) => set.id === created.id)
            ? { ...prev, prompt_sets: [created, ...prev.prompt_sets] }
            : prev,
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
  setEnabled: (scope: ProjectScope) => {
    const queryKey = queryKeys.prompts.sets(scope);
    return mutationOptions({
      mutationFn: ({ promptId, enabled }: { promptId: string; enabled: boolean }) =>
        promptsApi.updatePrompt(promptId, { enabled }, scoped(scope)),
      onMutate: async ({ promptId, enabled }, { client }) => {
        await client.cancelQueries({ queryKey });
        const previous = client.getQueryData<PromptSetList>(queryKey);
        client.setQueryData<PromptSetList>(queryKey, (current) =>
          current
            ? {
                ...current,
                prompt_sets: current.prompt_sets.map((set) => ({
                  ...set,
                  prompts: set.prompts.map((prompt) =>
                    prompt.id === promptId ? { ...prompt, enabled } : prompt,
                  ),
                })),
              }
            : current,
        );
        return { previous };
      },
      onError: (_error, _vars, result, { client }) => {
        if (result?.previous) client.setQueryData(queryKey, result.previous);
      },
      onSettled: (_data, _error, _vars, _result, { client }) =>
        refreshPromptLibrary(client, scope.projectId),
    });
  },
  remove: (scope: ProjectScope) =>
    mutationOptions({
      mutationFn: (promptId: string) => promptsApi.deletePrompt(promptId, scoped(scope)),
      ...refreshed(scope),
    }),
  bulk: (scope: ProjectScope) =>
    mutationOptions({
      mutationFn: async ({
        change,
        prompts,
      }: {
        change: PromptBulkChange;
        prompts: readonly Pick<Prompt, 'id' | 'prompt_set_id'>[];
      }): Promise<number> => {
        const prompt_ids = prompts.map((prompt) => prompt.id);
        switch (change.kind) {
          case 'status': {
            const bySet = new Map<string, string[]>();
            for (const prompt of prompts)
              bySet.set(prompt.prompt_set_id, [
                ...(bySet.get(prompt.prompt_set_id) ?? []),
                prompt.id,
              ]);
            const settled = await Promise.allSettled(
              [...bySet].map(([setId, ids]) =>
                promptsApi.bulkStatus(
                  setId,
                  { prompt_ids: ids, status: change.status },
                  scoped(scope),
                ),
              ),
            );
            const failed = settled.find((result) => result.status === 'rejected');
            if (failed) throw failed.reason;
            return prompt_ids.length;
          }
          case 'topic':
            return (
              await promptsApi.bulkTopic(
                scope.projectId,
                { prompt_ids, topic_id: change.topicId },
                scoped(scope),
              )
            ).count;
          case 'delete':
            return (await promptsApi.bulkDelete(scope.projectId, { prompt_ids }, scoped(scope)))
              .count;
          default: {
            const unhandled: never = change;
            return unhandled;
          }
        }
      },
      onSettled: (_data, _error, _vars, _result, { client }) =>
        refreshPromptLibrary(client, scope.projectId),
    }),
  import: (scope: ProjectScope, resolveSet: SetResolver) =>
    mutationOptions({
      mutationFn: async (rows: PromptImportRowRequest[]) =>
        promptsApi.importRows((await resolveSet()).id, rows, scoped(scope)),
      ...refreshed(scope),
    }),
  generate: (scope: ProjectScope, resolveSet: SetResolver) =>
    mutationOptions({
      mutationKey: queryKeys.prompts.generate(scope),
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
