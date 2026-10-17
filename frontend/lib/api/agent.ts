/**
 * Agent endpoints + query/mutation options.
 *
 * Chats are the saved work: messages are append-only, a chat owns at most one
 * output with immutable revisions, and reads never execute a turn — the UI
 * shows a run's streamed progress and polls persisted state when no stream is
 * open. Writes that queue a turn carry an idempotency key bound to the full
 * request, so a retried send replays the same run instead of queueing a
 * second one.
 */
import { infiniteQueryOptions, mutationOptions, queryOptions } from '@tanstack/react-query';
import type { z } from 'zod';

import { AGENT_CHAT_PAGE_SIZE } from '@/lib/config/agent';

import { apiClient, type ApiRequestOptions } from './client';
import { queryKeys } from './query-keys';
import {
  agentChatDetailSchema,
  agentChatSummarySchema,
  agentChatsPageSchema,
  agentInstructionsSchema,
  agentMessageSchema,
  agentOutputSchema,
  agentRevisionSchema,
  agentRevisionsPageSchema,
  agentRunSchema,
  agentSkillCatalogSchema,
  agentSkillSchema,
  agentTurnAcceptedSchema,
  agentWorkflowSchema,
} from '@citeladder/contracts/agent';
import { strictValidate } from '@citeladder/contracts/validation';
import { definedQuery, withQuery } from './shared';
import { startLiveTurn } from '@/lib/agent/live-turns';

export type AgentRun = z.infer<typeof agentRunSchema>;
export type AgentRevision = z.infer<typeof agentRevisionSchema>;
export type AgentOutput = z.infer<typeof agentOutputSchema>;
export type AgentMessage = z.infer<typeof agentMessageSchema>;
export type AgentChatSummary = z.infer<typeof agentChatSummarySchema>;
export type AgentChatDetail = z.infer<typeof agentChatDetailSchema>;
export type AgentSkill = z.infer<typeof agentSkillSchema>;
export type AgentWorkflow = z.infer<typeof agentWorkflowSchema>;
export type AgentCatalog = z.infer<typeof agentSkillCatalogSchema>;

/**
 * Typed evidence a new chat starts from. The server resolves and authorizes
 * every identifier on each run; the browser never sends evidence content.
 */
export type AgentContextRefs = {
  target_url?: string;
  target_site_url_id?: string;
  opportunity_id?: string;
  demand_signal_id?: string;
  site_health_reference?: {
    project_id: string;
    crawl_id: string;
    site_url_id: string;
    source_analysis_id: string;
    dimension: string;
    checkpoint_ids: string[];
  };
  search_intelligence_reference?: { dataset_id: string; row_ids: string[] };
  issue_group_reference?: { crawl_id: string; group_id: string; site_url_id?: string };
  site_facts_reference?: { crawl_id: string };
  output_revision_reference?: { output_id: string; revision_id: string };
};

export type NewChatInput = {
  message: string;
  skill_id?: string | null;
  /** A defined workflow pins its skill and format on the server. */
  workflow_id?: string;
  action_id?: string;
  context?: AgentContextRefs;
  /** Actions the message @-mentions; authorized server-side. */
  mentions?: string[];
};

const withKey = (idempotencyKey: string, options?: ApiRequestOptions): ApiRequestOptions => ({
  ...options,
  idempotencyKey,
  retryNetworkFailures: true,
});

async function admitTurn(
  path: string,
  input: unknown,
  idempotencyKey: string,
  options?: ApiRequestOptions,
) {
  const accepted = strictValidate(
    agentTurnAcceptedSchema,
    await apiClient.post(path, input, withKey(idempotencyKey, options)),
    'agent.turn',
  );
  // The same interactive request, streamed so the turn is shown as it is written.
  startLiveTurn(accepted.chat_id, accepted.run.id, options?.workspaceId ?? null);
  return accepted;
}

const agentApi = {
  skills: async (options?: ApiRequestOptions) =>
    strictValidate(
      agentSkillCatalogSchema,
      await apiClient.get('/agent/skills', options),
      'agent.skills',
    ),
  listChats: async (
    projectId: string,
    params: { q?: string; action_id?: string; cursor?: string; limit?: number },
    options?: ApiRequestOptions,
  ) =>
    strictValidate(
      agentChatsPageSchema,
      await apiClient.get(
        withQuery(`/projects/${projectId}/agent/chats`, definedQuery(params)),
        options,
      ),
      'agent.listChats',
    ),
  createChat: async (
    projectId: string,
    input: NewChatInput,
    idempotencyKey: string,
    options?: ApiRequestOptions,
  ) => admitTurn(`/projects/${projectId}/agent/chats`, input, idempotencyKey, options),
  getChat: async (chatId: string, options?: ApiRequestOptions) =>
    strictValidate(
      agentChatDetailSchema,
      await apiClient.get(`/agent/chats/${chatId}`, options),
      'agent.getChat',
    ),
  sendMessage: async (
    chatId: string,
    input: { message: string; skill_id?: string | null; mentions?: string[] },
    idempotencyKey: string,
    options?: ApiRequestOptions,
  ) => admitTurn(`/agent/chats/${chatId}/messages`, input, idempotencyKey, options),
  cancelRun: async (chatId: string, runId: string, options?: ApiRequestOptions) =>
    strictValidate(
      agentRunSchema,
      await apiClient.post(`/agent/chats/${chatId}/runs/${runId}/cancel`, {}, options),
      'agent.cancelRun',
    ),
  revisions: async (chatId: string, options?: ApiRequestOptions) =>
    strictValidate(
      agentRevisionsPageSchema,
      await apiClient.get(`/agent/chats/${chatId}/output/revisions`, options),
      'agent.revisions',
    ),
  editOutput: async (
    chatId: string,
    input: { base_revision_id: string; title: string; body: string },
    options?: ApiRequestOptions,
  ) =>
    strictValidate(
      agentRevisionSchema,
      await apiClient.post(`/agent/chats/${chatId}/output/revisions`, input, options),
      'agent.editOutput',
    ),
  restoreRevision: async (chatId: string, revisionId: string, options?: ApiRequestOptions) =>
    strictValidate(
      agentRevisionSchema,
      await apiClient.post(
        `/agent/chats/${chatId}/output/revisions/${revisionId}/restore`,
        {},
        options,
      ),
      'agent.restoreRevision',
    ),
  approveOutline: async (
    chatId: string,
    revisionId: string,
    idempotencyKey: string,
    options?: ApiRequestOptions,
  ) =>
    admitTurn(
      `/agent/chats/${chatId}/output/approve-outline`,
      { revision_id: revisionId },
      idempotencyKey,
      options,
    ),
  instructions: async (projectId: string, options?: ApiRequestOptions) =>
    strictValidate(
      agentInstructionsSchema,
      await apiClient.get(`/projects/${projectId}/agent/instructions`, options),
      'agent.instructions',
    ),
  saveInstructions: async (projectId: string, text: string, options?: ApiRequestOptions) =>
    strictValidate(
      agentInstructionsSchema,
      await apiClient.put(`/projects/${projectId}/agent/instructions`, { text }, options),
      'agent.saveInstructions',
    ),
};

export const agentQueries = {
  skills: (workspaceId: string) =>
    queryOptions({
      queryKey: queryKeys.agent.skills(),
      queryFn: ({ signal }) => agentApi.skills({ signal, workspaceId }),
      staleTime: Infinity,
    }),
  chats: (workspaceId: string, projectId: string, filters: { q?: string; actionId?: string }) =>
    infiniteQueryOptions({
      queryKey: queryKeys.agent.chats(projectId, {
        q: filters.q || null,
        actionId: filters.actionId ?? null,
      }),
      initialPageParam: undefined as string | undefined,
      queryFn: ({ signal, pageParam }) =>
        agentApi.listChats(
          projectId,
          {
            q: filters.q || undefined,
            action_id: filters.actionId,
            cursor: pageParam,
            limit: AGENT_CHAT_PAGE_SIZE,
          },
          { signal, workspaceId },
        ),
      getNextPageParam: (page) => page.next_cursor ?? undefined,
    }),
  chat: (workspaceId: string, chatId: string) =>
    queryOptions({
      queryKey: queryKeys.agent.chat(chatId),
      queryFn: ({ signal }) => agentApi.getChat(chatId, { signal, workspaceId }),
    }),
  revisions: (workspaceId: string, chatId: string, latestRevisionId: string) =>
    queryOptions({
      queryKey: [...queryKeys.agent.revisions(chatId), latestRevisionId],
      queryFn: ({ signal }) => agentApi.revisions(chatId, { signal, workspaceId }),
    }),
  instructions: (workspaceId: string, projectId: string) =>
    queryOptions({
      queryKey: queryKeys.agent.instructions(projectId),
      queryFn: ({ signal }) => agentApi.instructions(projectId, { signal, workspaceId }),
    }),
};

export const agentMutations = {
  createChat: (workspaceId: string) =>
    mutationOptions({
      mutationFn: (vars: { projectId: string; input: NewChatInput; idempotencyKey: string }) =>
        agentApi.createChat(vars.projectId, vars.input, vars.idempotencyKey, { workspaceId }),
    }),
  sendMessage: (workspaceId: string) =>
    mutationOptions({
      mutationFn: (vars: {
        chatId: string;
        message: string;
        skillId?: string | null;
        mentions?: string[];
        idempotencyKey: string;
      }) =>
        agentApi.sendMessage(
          vars.chatId,
          { message: vars.message, skill_id: vars.skillId, mentions: vars.mentions },
          vars.idempotencyKey,
          { workspaceId },
        ),
    }),
  cancelRun: (workspaceId: string) =>
    mutationOptions({
      mutationFn: (vars: { chatId: string; runId: string }) =>
        agentApi.cancelRun(vars.chatId, vars.runId, { workspaceId }),
    }),
  editOutput: (workspaceId: string) =>
    mutationOptions({
      mutationFn: (vars: { chatId: string; baseRevisionId: string; title: string; body: string }) =>
        agentApi.editOutput(
          vars.chatId,
          { base_revision_id: vars.baseRevisionId, title: vars.title, body: vars.body },
          { workspaceId },
        ),
    }),
  restoreRevision: (workspaceId: string) =>
    mutationOptions({
      mutationFn: (vars: { chatId: string; revisionId: string }) =>
        agentApi.restoreRevision(vars.chatId, vars.revisionId, { workspaceId }),
    }),
  approveOutline: (workspaceId: string) =>
    mutationOptions({
      mutationFn: (vars: { chatId: string; revisionId: string; idempotencyKey: string }) =>
        agentApi.approveOutline(vars.chatId, vars.revisionId, vars.idempotencyKey, {
          workspaceId,
        }),
    }),
  saveInstructions: (workspaceId: string) =>
    mutationOptions({
      mutationFn: (vars: { projectId: string; text: string }) =>
        agentApi.saveInstructions(vars.projectId, vars.text, { workspaceId }),
    }),
};
