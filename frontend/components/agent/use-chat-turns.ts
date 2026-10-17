'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { useComposerCommands } from '@/components/agent/use-composer-commands';
import { agentWriteFailure } from '@/lib/agent/errors';
import { newIdempotencyKey, useRequestKey } from '@/lib/agent/idempotency';
import { isLiveTurnConnected, useLiveTurnConnected } from '@/lib/agent/live-turns';
import { isRunActive, runPollMs } from '@/lib/agent/run-state';
import {
  agentMutations,
  agentQueries,
  type AgentChatDetail,
  type AgentContextRefs,
  type AgentMessage,
} from '@/lib/api/agent';
import { queryKeys } from '@/lib/api/query-keys';

/**
 * The persisted chat. Reads never run the agent. While a turn is active its
 * stream shows progress; without an open stream (another tab, a reload, a
 * dropped connection) the chat is polled until the run reaches a terminal
 * state, and it is read again the moment a stream closes.
 */
export function useChatDetail(workspaceId: string, chatId: string) {
  const query = useQuery({
    ...agentQueries.chat(workspaceId, chatId),
    enabled: Boolean(workspaceId && chatId),
    refetchInterval: (state) => {
      const run = state.state.data?.latest_run;
      return run && isRunActive(run) && !isLiveTurnConnected(run.id) ? runPollMs(run) : false;
    },
  });
  const closed = useLiveTurnConnected(query.data?.latest_run?.id) === false;
  const { refetch } = query;
  useEffect(() => {
    if (closed) void refetch();
  }, [closed, refetch]);
  return query;
}

export type NewChatInput = {
  message: string;
  skillId: string | null | undefined;
  /** A defined workflow; the server pins its skill and format. */
  workflowId?: string;
  actionId?: string;
  context: AgentContextRefs;
  mentions?: string[];
};

/** Starts a chat once per accepted request; `onCreated` receives its id. */
export function useCreateChat(
  workspaceId: string,
  projectId: string,
  onCreated: (chatId: string) => void,
) {
  const queryClient = useQueryClient();
  const requestKey = useRequestKey();
  const mutation = useMutation({
    ...agentMutations.createChat(workspaceId),
    onSuccess: async (accepted) => {
      requestKey.accepted();
      void queryClient.invalidateQueries({ queryKey: queryKeys.agent.chatLists(projectId) });
      // Keep the current composer until the saved conversation is available.
      // prefetchQuery contains read failures; an accepted send stays accepted.
      await queryClient.prefetchQuery(agentQueries.chat(workspaceId, accepted.chat_id));
      onCreated(accepted.chat_id);
    },
  });
  const start = ({
    message,
    skillId,
    workflowId,
    actionId,
    context,
    mentions = [],
  }: NewChatInput) => {
    const input = {
      message: message.trim(),
      skill_id: skillId,
      ...(workflowId ? { workflow_id: workflowId } : {}),
      action_id: actionId,
      context,
      ...(mentions.length > 0 ? { mentions } : {}),
    };
    mutation.mutate({ projectId, idempotencyKey: requestKey.keyFor({ projectId, input }), input });
  };
  return {
    start,
    pending: mutation.isPending,
    failure: mutation.isError ? agentWriteFailure(mutation.error) : null,
  };
}

/** An ordinary follow-up; only requested work creates an output revision. */
export function useFollowUp(workspaceId: string, detail: AgentChatDetail) {
  const chatId = detail.chat.id;
  const [draft, setDraft] = useState('');
  const [skillId, setSkillId] = useState<string | null | undefined>(undefined);
  const [lastMessage, setLastMessage] = useState('');
  const requestKey = useRequestKey();
  const queryClient = useQueryClient();
  const commands = useComposerCommands({
    workspaceId,
    projectId: detail.chat.project_id,
  });
  const mutation = useMutation({
    ...agentMutations.sendMessage(workspaceId),
    onSuccess: (accepted, variables) => {
      requestKey.accepted();
      const submittedMentions = variables.mentions ?? [];
      const unchangedMentions =
        commands.mentions.length === submittedMentions.length &&
        commands.mentions.every((mention, index) => mention.id === submittedMentions[index]);
      if (draft.trim() === variables.message && unchangedMentions) {
        setDraft('');
        commands.clear();
      }
      queryClient.setQueryData<AgentChatDetail>(queryKeys.agent.chat(chatId), (current) =>
        current ? { ...current, latest_run: accepted.run } : current,
      );
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.agent.chat(chatId) }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.agent.chatLists(detail.chat.project_id),
        }),
      ]);
    },
  });
  /** The skill choice a recorded request was sent with, as the picker's tri-state. */
  const skillFor = (message: AgentMessage) => {
    if (message.skill_source === 'user') return message.skill_id;
    return message.skill_source === 'automatic' ? null : undefined;
  };
  const request = (message: string, skill: string | null | undefined, mentions: string[]) => ({
    chatId,
    message,
    skillId: skill,
    ...(mentions.length > 0 ? { mentions } : {}),
  });
  const send = (message: string) => {
    const text = message.trim();
    if (!text) return;
    setLastMessage(text);
    const typed = request(
      text,
      skillId,
      commands.mentions.map((mention) => mention.id),
    );
    mutation.mutate({ ...typed, idempotencyKey: requestKey.keyFor(typed) });
  };
  return {
    draft,
    setDraft,
    suggest: (instruction: string) =>
      setDraft((current) => (current.trim() ? `${current}\n\n${instruction}` : instruction)),
    recover: (message: AgentMessage) => {
      setDraft(message.content);
      setSkillId(skillFor(message));
      commands.restore(message.mentions);
    },
    /** Sends a recorded request again as a new turn, leaving the draft alone. */
    resend: (message: AgentMessage) =>
      mutation.mutate({
        ...request(
          message.content,
          skillFor(message),
          message.mentions.map((mention) => mention.id),
        ),
        idempotencyKey: newIdempotencyKey(),
      }),
    /** The message being sent, shown in the thread before the server accepts it. */
    pendingMessage: mutation.isPending ? (mutation.variables?.message ?? null) : null,
    skillId,
    setSkillId,
    lastMessage,
    send,
    commands,
    pending: mutation.isPending,
    failure: mutation.isError ? agentWriteFailure(mutation.error) : null,
    retrySubmission: () => {
      if (mutation.variables) mutation.mutate(mutation.variables);
    },
  };
}

export type FollowUp = ReturnType<typeof useFollowUp>;

export function useCancelRun(workspaceId: string, chatId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    ...agentMutations.cancelRun(workspaceId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.agent.chat(chatId) }),
  });
}
