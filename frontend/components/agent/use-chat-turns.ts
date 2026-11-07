'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { useComposerCommands } from '@/components/agent/use-composer-commands';
import { agentWriteFailure } from '@/lib/agent/errors';
import { newIdempotencyKey, useRequestKey } from '@/lib/agent/idempotency';
import { isLiveTurnConnected, useLiveTurnConnected } from '@/lib/agent/live-turns';
import { isRunActive, runPollMs } from '@/lib/agent/run-state';
import {
  agentMutations,
  agentQueries,
  type AgentChatDetail,
  type AgentMessage,
} from '@/lib/api/agent';
import type { AgentContextRefs } from '@citeladder/contracts/agent';

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
  const requestKey = useRequestKey();
  // The descriptor reads the saved conversation before success resolves, so
  // the current composer stays until the chat can render.
  const mutation = useMutation(agentMutations.createChat(workspaceId));
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
    mutation.mutate(
      { projectId, idempotencyKey: requestKey.keyFor({ projectId, input }), input },
      {
        onSuccess: (accepted) => {
          requestKey.accepted();
          onCreated(accepted.chat_id);
        },
      },
    );
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
  const projectId = detail.chat.project_id;
  const commands = useComposerCommands({ workspaceId, projectId });
  const mutation = useMutation(agentMutations.sendMessage({ workspaceId, projectId }));
  // The composer as it is when a send is accepted, not as it was when sent:
  // typing during the round trip must survive the acceptance.
  const composer = useRef({ draft, mentions: commands.mentions });
  useEffect(() => {
    composer.current = { draft, mentions: commands.mentions };
  });
  type Turn = Parameters<typeof mutation.mutate>[0];
  /**
   * Every send goes through here: an accepted turn retires its request key,
   * and clears the composer only if it still holds what was sent.
   */
  const submit = (turn: Turn) =>
    mutation.mutate(turn, {
      onSuccess: (_accepted, variables) => {
        requestKey.accepted();
        const { draft: current, mentions } = composer.current;
        const submittedMentions = variables.mentions ?? [];
        const unchangedMentions =
          mentions.length === submittedMentions.length &&
          mentions.every((mention, index) => mention.id === submittedMentions[index]);
        if (current.trim() === variables.message && unchangedMentions) {
          setDraft('');
          commands.clear();
        }
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
    submit({ ...typed, idempotencyKey: requestKey.keyFor(typed) });
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
      submit({
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
      if (mutation.variables) submit(mutation.variables);
    },
  };
}

export type FollowUp = ReturnType<typeof useFollowUp>;

export function useCancelRun(workspaceId: string) {
  return useMutation(agentMutations.cancelRun(workspaceId));
}
