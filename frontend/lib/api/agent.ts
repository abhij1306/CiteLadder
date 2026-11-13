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
import {
  infiniteQueryOptions,
  mutationOptions,
  queryOptions,
  type QueryClient,
} from '@tanstack/react-query';
import type { z } from 'zod';

import { AGENT_CHAT_PAGE_SIZE } from '@/lib/config/agent';

import { apiClient, type ApiRequestOptions } from './client';
import { queryKeys } from './query-keys';
import type { ProjectScope } from './query-keys/scope';
import {
  agentChatCreatedSchema,
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
  agentSuggestionResultSchema,
  agentSuggestionSchema,
  agentSuggestionsAppliedSchema,
  agentSuggestionsDismissedSchema,
  agentSuggestionsPageSchema,
  agentTurnAcceptedSchema,
  agentWorkflowSchema,
  type AgentChatCreateRequest,
  type AgentMessageRequest,
  type AgentOutputEditRequest,
  type AgentOutputTargetRequest,
} from '@citeladder/contracts/agent';
import { strictValidate } from '@citeladder/contracts/validation';
import { definedQuery, withQuery } from './shared';
import { startLiveTurn } from '@/lib/agent/live-turns';

export type AgentRun = z.infer<typeof agentRunSchema>;
export type AgentRevision = z.infer<typeof agentRevisionSchema>;
export type AgentOutput = z.infer<typeof agentOutputSchema>;
/** One of a chat's documents, addressed for edits and restores. */
export type AgentDocumentRef = { chatId: string; outputId: string; number: number };
export type AgentMessage = z.infer<typeof agentMessageSchema>;
export type AgentWebSource = AgentMessage['web_sources'][number];
export type AgentChatSummary = z.infer<typeof agentChatSummarySchema>;
export type AgentChatDetail = z.infer<typeof agentChatDetailSchema>;
export type AgentSkill = z.infer<typeof agentSkillSchema>;
export type AgentWorkflow = z.infer<typeof agentWorkflowSchema>;
export type AgentCatalog = z.infer<typeof agentSkillCatalogSchema>;
export type AgentSuggestion = z.infer<typeof agentSuggestionSchema>;
export type AgentSuggestionsPage = z.infer<typeof agentSuggestionsPageSchema>;
/** A page chat's finished fetch, with its page-local checks. */
export type AgentPageFetchDone = Extract<
  NonNullable<AgentChatDetail['page_fetch']>,
  { status: 'done' }
>;
/** A change to one suggestion of a page document. */
export type SuggestionChange = 'apply' | 'dismiss' | 'revert';
/** One suggestion of one page document, addressed for a change. */
type SuggestionRef = { chatId: string; outputId: string; suggestionId: string };
const outputPath = (document: { chatId: string; outputId: string }) =>
  `/agent/chats/${document.chatId}/outputs/${document.outputId}`;

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
  /**
   * A new chat. A page chat answers with no turn: the server queues it once
   * the page is read, and the chat screen opens its stream then.
   */
  createChat: async (
    projectId: string,
    input: AgentChatCreateRequest,
    idempotencyKey: string,
    options?: ApiRequestOptions,
  ) => {
    const accepted = strictValidate(
      agentChatCreatedSchema,
      await apiClient.post(
        `/projects/${projectId}/agent/chats`,
        input,
        withKey(idempotencyKey, options),
      ),
      'agent.createChat',
    );
    if (accepted.run)
      startLiveTurn(accepted.chat_id, accepted.run.id, options?.workspaceId ?? null);
    return accepted;
  },
  getChat: async (chatId: string, options?: ApiRequestOptions) =>
    strictValidate(
      agentChatDetailSchema,
      await apiClient.get(`/agent/chats/${chatId}`, options),
      'agent.getChat',
    ),
  sendMessage: async (
    chatId: string,
    input: AgentMessageRequest,
    idempotencyKey: string,
    options?: ApiRequestOptions,
  ) => admitTurn(`/agent/chats/${chatId}/messages`, input, idempotencyKey, options),
  cancelRun: async (chatId: string, runId: string, options?: ApiRequestOptions) =>
    strictValidate(
      agentRunSchema,
      await apiClient.post(`/agent/chats/${chatId}/runs/${runId}/cancel`, {}, options),
      'agent.cancelRun',
    ),
  revisions: async (chatId: string, outputId: string, options?: ApiRequestOptions) =>
    strictValidate(
      agentRevisionsPageSchema,
      await apiClient.get(`/agent/chats/${chatId}/outputs/${outputId}/revisions`, options),
      'agent.revisions',
    ),
  editOutput: async (
    document: { chatId: string; outputId: string },
    input: AgentOutputEditRequest,
    options?: ApiRequestOptions,
  ) =>
    strictValidate(
      agentRevisionSchema,
      await apiClient.post(
        `/agent/chats/${document.chatId}/outputs/${document.outputId}/revisions`,
        input,
        options,
      ),
      'agent.editOutput',
    ),
  restoreRevision: async (
    document: { chatId: string; outputId: string },
    revisionId: string,
    options?: ApiRequestOptions,
  ) =>
    strictValidate(
      agentRevisionSchema,
      await apiClient.post(
        `/agent/chats/${document.chatId}/outputs/${document.outputId}/revisions/${revisionId}/restore`,
        {},
        options,
      ),
      'agent.restoreRevision',
    ),
  suggestions: async (
    document: { chatId: string; outputId: string },
    options?: ApiRequestOptions,
  ) =>
    strictValidate(
      agentSuggestionsPageSchema,
      await apiClient.get(`${outputPath(document)}/suggestions`, options),
      'agent.suggestions',
    ),
  /** Apply, Dismiss or Revert, against the revision the person saw. */
  changeSuggestion: async (
    target: SuggestionRef,
    change: SuggestionChange,
    baseRevisionId: string,
    options?: ApiRequestOptions,
  ) =>
    strictValidate(
      agentSuggestionResultSchema,
      await apiClient.post(
        `${outputPath(target)}/suggestions/${target.suggestionId}/${change}`,
        { base_revision_id: baseRevisionId },
        options,
      ),
      'agent.changeSuggestion',
    ),
  applyAllSuggestions: async (
    document: { chatId: string; outputId: string },
    baseRevisionId: string,
    options?: ApiRequestOptions,
  ) =>
    strictValidate(
      agentSuggestionsAppliedSchema,
      await apiClient.post(
        `${outputPath(document)}/suggestions/apply-all`,
        { base_revision_id: baseRevisionId },
        options,
      ),
      'agent.applyAllSuggestions',
    ),
  dismissAllSuggestions: async (
    document: { chatId: string; outputId: string },
    baseRevisionId: string,
    options?: ApiRequestOptions,
  ) =>
    strictValidate(
      agentSuggestionsDismissedSchema,
      await apiClient.post(
        `${outputPath(document)}/suggestions/dismiss-all`,
        { base_revision_id: baseRevisionId },
        options,
      ),
      'agent.dismissAllSuggestions',
    ),
  /** Link a document to the page it names, or keep it with its Action; answers the chat. */
  chooseOutputTarget: async (
    document: { chatId: string; outputId: string },
    input: AgentOutputTargetRequest,
    options?: ApiRequestOptions,
  ) =>
    strictValidate(
      agentChatDetailSchema,
      await apiClient.post(`${outputPath(document)}/target`, input, options),
      'agent.chooseOutputTarget',
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

/** Agent reads: the skill catalog, the project's chats and instructions, one chat. */
export const agentQueries = {
  skills: (workspaceId: string | null) =>
    queryOptions({
      queryKey: queryKeys.agent.skills(workspaceId),
      queryFn: ({ signal }) => agentApi.skills({ signal, workspaceId }),
      staleTime: Infinity,
    }),
  chats: (scope: ProjectScope, filters: { q?: string; actionId?: string }) =>
    infiniteQueryOptions({
      queryKey: queryKeys.agent.chats(scope, {
        q: filters.q || null,
        actionId: filters.actionId ?? null,
      }),
      initialPageParam: undefined as string | undefined,
      queryFn: ({ signal, pageParam }) =>
        agentApi.listChats(
          scope.projectId,
          {
            q: filters.q || undefined,
            action_id: filters.actionId,
            cursor: pageParam,
            limit: AGENT_CHAT_PAGE_SIZE,
          },
          { signal, workspaceId: scope.workspaceId },
        ),
      getNextPageParam: (page) => page.next_cursor ?? undefined,
    }),
  chat: (workspaceId: string | null, chatId: string) =>
    queryOptions({
      queryKey: queryKeys.agent.chat(workspaceId, chatId),
      queryFn: ({ signal }) => agentApi.getChat(chatId, { signal, workspaceId }),
    }),
  revisions: (
    workspaceId: string | null,
    chatId: string,
    outputId: string,
    latestRevisionId: string,
  ) =>
    queryOptions({
      queryKey: queryKeys.agent.revisions(workspaceId, chatId, outputId, latestRevisionId),
      queryFn: ({ signal }) => agentApi.revisions(chatId, outputId, { signal, workspaceId }),
    }),
  /** A page document's suggestions, read again after each revision or turn. */
  suggestions: (
    workspaceId: string | null,
    document: { chatId: string; outputId: string },
    marker: { revisionId: string; messageId: string | null },
  ) =>
    queryOptions({
      queryKey: queryKeys.agent.suggestions(
        workspaceId,
        document.chatId,
        document.outputId,
        marker,
      ),
      queryFn: ({ signal }) => agentApi.suggestions(document, { signal, workspaceId }),
    }),
  instructions: (scope: ProjectScope) =>
    queryOptions({
      queryKey: queryKeys.agent.instructions(scope),
      queryFn: ({ signal }) =>
        agentApi.instructions(scope.projectId, { signal, workspaceId: scope.workspaceId }),
    }),
};

/** One chat's persisted state, after a turn, a cancel or a stream moved it. */
export const refreshAgentChat = (client: QueryClient, chatId: string) =>
  client.invalidateQueries({ queryKey: queryKeys.agent.chatDetail(chatId) });

/** A chat's output and its revision list, after a new revision was written. */
const refreshAgentOutput = (client: QueryClient, chatId: string) =>
  Promise.all([
    refreshAgentChat(client, chatId),
    client.invalidateQueries({ queryKey: queryKeys.agent.chatRevisions(chatId) }),
  ]);

/**
 * A page document after a suggestion change, or after one was refused because
 * the page or a suggestion moved on: the chat (its latest revision) and the
 * suggestions both read again.
 */
const refreshPageDocument = (client: QueryClient, chatId: string) =>
  Promise.all([
    refreshAgentOutput(client, chatId),
    client.invalidateQueries({ queryKey: queryKeys.agent.chatSuggestions(chatId) }),
  ]);

/** Every chat list of the project: a new chat or turn reorders and relabels them. */
const refreshAgentChatLists = (client: QueryClient, projectId: string) =>
  client.invalidateQueries({ queryKey: queryKeys.agent.chatLists(projectId) });

/** Agent writes; each success refreshes every read it changes. */
export const agentMutations = {
  /**
   * A new chat. The chat lists refresh in the background; the saved
   * conversation is read before success resolves so the screen keeps its
   * composer until the chat can render (prefetchQuery contains read failures,
   * so an accepted send stays accepted).
   */
  createChat: (workspaceId: string | null) =>
    mutationOptions({
      mutationFn: (vars: {
        projectId: string;
        input: AgentChatCreateRequest;
        idempotencyKey: string;
      }) => agentApi.createChat(vars.projectId, vars.input, vars.idempotencyKey, { workspaceId }),
      onSuccess: async (accepted, vars, _result, { client }) => {
        void refreshAgentChatLists(client, vars.projectId);
        await client.prefetchQuery(agentQueries.chat(workspaceId, accepted.chat_id));
      },
    }),
  /**
   * A follow-up turn. The accepted run is written into the chat at once so
   * the thread shows it running before the refetch lands.
   */
  sendMessage: (scope: ProjectScope) =>
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
          { workspaceId: scope.workspaceId },
        ),
      onSuccess: (accepted, vars, _result, { client }) => {
        client.setQueryData<AgentChatDetail>(
          queryKeys.agent.chat(scope.workspaceId, vars.chatId),
          (current) => (current ? { ...current, latest_run: accepted.run } : current),
        );
        void Promise.all([
          refreshAgentChat(client, vars.chatId),
          refreshAgentChatLists(client, scope.projectId),
        ]);
      },
    }),
  cancelRun: (workspaceId: string | null) =>
    mutationOptions({
      mutationFn: (vars: { chatId: string; runId: string }) =>
        agentApi.cancelRun(vars.chatId, vars.runId, { workspaceId }),
      onSuccess: (_run, vars, _result, { client }) => void refreshAgentChat(client, vars.chatId),
    }),
  editOutput: (workspaceId: string | null) =>
    mutationOptions({
      mutationFn: (vars: {
        chatId: string;
        outputId: string;
        baseRevisionId: string;
        title: string;
        body: string;
      }) =>
        agentApi.editOutput(
          vars,
          { base_revision_id: vars.baseRevisionId, title: vars.title, body: vars.body },
          { workspaceId },
        ),
      onSuccess: (_revision, vars, _result, { client }) => refreshAgentOutput(client, vars.chatId),
    }),
  restoreRevision: (workspaceId: string | null) =>
    mutationOptions({
      mutationFn: (vars: { chatId: string; outputId: string; revisionId: string }) =>
        agentApi.restoreRevision(vars, vars.revisionId, { workspaceId }),
      onSuccess: (_revision, vars, _result, { client }) => refreshAgentOutput(client, vars.chatId),
    }),
  /**
   * Link a document to the page it names or keep it with its Action. The
   * answer is the chat as now saved; a refusal reads the chat again. Either
   * Action's status may move; the chat keeps its own Action.
   */
  chooseOutputTarget: (workspaceId: string | null) =>
    mutationOptions({
      mutationFn: (vars: { chatId: string; outputId: string; decision: 'link' | 'keep' }) =>
        agentApi.chooseOutputTarget(vars, { decision: vars.decision }, { workspaceId }),
      onSuccess: (detail, vars, _result, { client }) => {
        client.setQueryData(queryKeys.agent.chat(workspaceId, vars.chatId), detail);
      },
      onError: (_error, vars, _context, { client }) => void refreshAgentChat(client, vars.chatId),
      onSettled: (_result, _error, _vars, _context, { client }) =>
        client.invalidateQueries({ queryKey: queryKeys.actions.all }),
    }),
  /** Apply, Dismiss or Revert one suggestion; any answer reads the page again. */
  changeSuggestion: (workspaceId: string | null) =>
    mutationOptions({
      mutationFn: (vars: SuggestionRef & { change: SuggestionChange; baseRevisionId: string }) =>
        agentApi.changeSuggestion(vars, vars.change, vars.baseRevisionId, { workspaceId }),
      onSettled: (_result, _error, vars, _context, { client }) =>
        refreshPageDocument(client, vars.chatId),
    }),
  applyAllSuggestions: (workspaceId: string | null) =>
    mutationOptions({
      mutationFn: (vars: { chatId: string; outputId: string; baseRevisionId: string }) =>
        agentApi.applyAllSuggestions(vars, vars.baseRevisionId, { workspaceId }),
      onSettled: (_result, _error, vars, _context, { client }) =>
        refreshPageDocument(client, vars.chatId),
    }),
  dismissAllSuggestions: (workspaceId: string | null) =>
    mutationOptions({
      mutationFn: (vars: { chatId: string; outputId: string; baseRevisionId: string }) =>
        agentApi.dismissAllSuggestions(vars, vars.baseRevisionId, { workspaceId }),
      onSettled: (_result, _error, vars, _context, { client }) =>
        refreshPageDocument(client, vars.chatId),
    }),
  /** The saved instructions become the cached read: no refetch of what was just written. */
  saveInstructions: (scope: ProjectScope) =>
    mutationOptions({
      mutationFn: (text: string) =>
        agentApi.saveInstructions(scope.projectId, text, { workspaceId: scope.workspaceId }),
      onSuccess: (saved, _text, _result, { client }) => {
        client.setQueryData(queryKeys.agent.instructions(scope), saved);
      },
    }),
};
