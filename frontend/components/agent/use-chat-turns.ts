import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { useComposerCommands } from '@/components/agent/use-composer-commands';
import { agentWriteFailure } from '@/lib/agent/errors';
import { newIdempotencyKey, useRequestKey } from '@/lib/agent/idempotency';
import { isLiveTurnConnected, startLiveTurn, useLiveTurnConnected } from '@/lib/agent/live-turns';
import { fetchedTurnToStart, isPageReading, isRunActive, runPollMs } from '@/lib/agent/run-state';
import { AGENT_PAGE_FETCH_POLL_MS } from '@/lib/config/agent';
import {
  agentMutations,
  agentQueries,
  type AgentChatDetail,
  type AgentMessage,
} from '@/lib/api/agent';
import type { AgentAttachment, AgentContextRefs } from '@citeladder/contracts/agent';

export function useChatDetail(workspaceId: string, chatId: string) {
  const query = useQuery({
    ...agentQueries.chat(workspaceId, chatId),
    enabled: Boolean(workspaceId && chatId),
    refetchInterval: (state) => {
      if (isPageReading(state.state.data?.page_fetch)) return AGENT_PAGE_FETCH_POLL_MS;
      const run = state.state.data?.latest_run;
      return run && isRunActive(run) && !isLiveTurnConnected(run.id) ? runPollMs(run) : false;
    },
  });
  const closed = useLiveTurnConnected(query.data?.latest_run?.id) === false;
  const { refetch } = query;
  useEffect(() => {
    if (closed) void refetch();
  }, [closed, refetch]);
  const fetchedTurn = fetchedTurnToStart(query.data);
  useEffect(() => {
    if (fetchedTurn) startLiveTurn(chatId, fetchedTurn, workspaceId);
  }, [chatId, fetchedTurn, workspaceId]);
  return query;
}

export type NewChatInput = {
  message: string;
  skillId: string | null | undefined;
  workflowId?: string;
  actionId?: string;
  context: AgentContextRefs;
  mentions?: string[];
  attachments?: AgentAttachment[];
};

export function useCreateChat(
  workspaceId: string,
  projectId: string,
  onCreated: (chatId: string) => void,
) {
  const requestKey = useRequestKey();
  const mutation = useMutation(agentMutations.createChat(workspaceId));
  const start = ({
    message,
    skillId,
    workflowId,
    actionId,
    context,
    mentions = [],
    attachments = [],
  }: NewChatInput) => {
    const input = {
      message: message.trim(),
      skill_id: skillId,
      ...(workflowId ? { workflow_id: workflowId } : {}),
      action_id: actionId,
      context,
      ...(mentions.length > 0 ? { mentions } : {}),
      ...(attachments.length > 0 ? { attachments } : {}),
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
    failure: mutation.isError ? agentWriteFailure(mutation.error, 'start the chat') : null,
  };
}

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
  const composer = useRef({ draft, mentions: commands.mentions, pastes: commands.pastes.items });
  useEffect(() => {
    composer.current = { draft, mentions: commands.mentions, pastes: commands.pastes.items };
  });
  type Turn = Parameters<typeof mutation.mutate>[0];
  const userMessages = detail.messages.filter((message) => message.role === 'user').length;
  const [sentAt, setSentAt] = useState(userMessages);
  const awaitingSaved = mutation.isSuccess && userMessages <= sentAt;
  const submit = (turn: Turn) => {
    setSentAt(userMessages);
    mutation.mutate(turn, {
      onSuccess: (_accepted, variables) => {
        requestKey.accepted();
        const { draft: current, mentions, pastes } = composer.current;
        const submittedMentions = variables.mentions ?? [];
        const unchangedMentions =
          mentions.length === submittedMentions.length &&
          mentions.every((mention, index) => mention.id === submittedMentions[index]);
        const submittedPastes = variables.attachments ?? [];
        const unchangedPastes =
          pastes.length === submittedPastes.length &&
          pastes.every((paste, index) => paste.text === submittedPastes[index]?.text);
        if (current.trim() === variables.message && unchangedMentions && unchangedPastes) {
          setDraft('');
          commands.clear();
        }
      },
    });
  };
  const skillFor = (message: AgentMessage) => {
    if (message.skill_source === 'user') return message.skill_id;
    return message.skill_source === 'automatic' ? null : undefined;
  };
  const request = (
    message: string,
    skill: string | null | undefined,
    sent: { mentions: string[]; attachments: AgentAttachment[] },
  ) => ({
    chatId,
    message,
    skillId: skill,
    ...(sent.mentions.length > 0 ? { mentions: sent.mentions } : {}),
    ...(sent.attachments.length > 0 ? { attachments: sent.attachments } : {}),
  });
  const send = (message: string) => {
    const text = message.trim();
    if (!text) return;
    commands.prepare({ message: text, edit: setDraft }, (prepared) => {
      setLastMessage(prepared.message);
      const typed = request(prepared.message, skillId, prepared);
      submit({ ...typed, idempotencyKey: requestKey.keyFor(typed) });
    });
  };
  return {
    draft,
    setDraft,
    suggest: (instruction: string) =>
      setDraft((current) => (current.trim() ? `${current}\n\n${instruction}` : instruction)),
    recover: (message: AgentMessage) => {
      setDraft(message.content);
      setSkillId(skillFor(message));
      commands.restore({ mentions: message.mentions, pastes: message.attachments });
    },
    resend: (message: AgentMessage) =>
      submit({
        ...request(message.content, skillFor(message), {
          mentions: message.mentions.map((mention) => mention.id),
          attachments: message.attachments,
        }),
        idempotencyKey: newIdempotencyKey(),
      }),
    pendingMessage:
      mutation.isPending || awaitingSaved ? (mutation.variables?.message ?? null) : null,
    skillId,
    setSkillId,
    lastMessage,
    send,
    commands,
    pending: mutation.isPending || commands.resolving,
    failure: mutation.isError ? agentWriteFailure(mutation.error, 'send the message') : null,
    failedMessage: mutation.isError ? (mutation.variables?.message ?? null) : null,
    retrySubmission: () => {
      if (mutation.variables) submit(mutation.variables);
    },
  };
}

export type FollowUp = ReturnType<typeof useFollowUp>;

export function useCancelRun(workspaceId: string) {
  return useMutation(agentMutations.cancelRun(workspaceId));
}
