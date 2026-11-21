import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { agentWriteFailure, isOutputConflict } from '@/lib/agent/errors';
import { useLiveDocumentBody } from '@/lib/agent/live-turns';
import { isRunActive } from '@/lib/agent/run-state';
import { actionsQueries } from '@/lib/api/actions';
import {
  agentMutations,
  agentQueries,
  refreshAgentChat,
  type AgentChatDetail,
  type AgentOutput,
  type AgentRevision,
} from '@/lib/api/agent';
import { useMediaQuery } from '@/lib/use-media-query';

export type RailTab = 'suggestions' | 'outline' | 'seo';
export type StackTab = 'page' | RailTab | 'chat';

const NARROW_QUERY = '(max-width: 1023px)';

const EDIT_CONFLICT =
  'The page changed since you started editing, so your edits were not saved. Copy what you need, then discard them to see the latest version.';

export function usePageDraft(workspaceId: string, output: AgentOutput, chatId: string) {
  const revision = output.latest_revision;
  const client = useQueryClient();
  const [draft, setDraft] = useState<{ base: string; text: string } | null>(null);
  const save = useMutation(agentMutations.editOutput(workspaceId));
  return {
    draft,
    moved: draft !== null && draft.base !== revision.id,
    edit: (text: string) =>
      setDraft((current) => {
        const base = current?.base ?? revision.id;
        return text === revision.body && base === revision.id ? null : { base, text };
      }),
    discard: () => {
      save.reset();
      setDraft(null);
    },
    save: () => {
      if (!draft) return;
      save.mutate(
        {
          chatId,
          outputId: output.id,
          baseRevisionId: draft.base,
          title: revision.title,
          body: draft.text,
        },
        {
          onSuccess: () => setDraft(null),
          onError: (error) => {
            if (isOutputConflict(error)) void refreshAgentChat(client, chatId);
          },
        },
      );
    },
    saving: save.isPending,
    failure: save.isError ? saveFailure(save.error) : null,
  };
}

function saveFailure(error: unknown) {
  const failure = agentWriteFailure(error, 'save the page');
  return isOutputConflict(error) ? { ...failure, message: EDIT_CONFLICT } : failure;
}

export type PageDraft = ReturnType<typeof usePageDraft>;

export function usePageSuggestions(
  workspaceId: string,
  detail: AgentChatDetail,
  output: AgentOutput,
) {
  const revision = output.latest_revision;
  const query = useQuery({
    ...agentQueries.suggestions(
      workspaceId,
      { chatId: detail.chat.id, outputId: output.id },
      { revisionId: revision.id, messageId: detail.messages.at(-1)?.id ?? null },
    ),
    placeholderData: keepPreviousData,
  });
  const page = query.data?.revision_id === revision.id ? query.data : null;
  return { query, page };
}

export function useChatAction(workspaceId: string, actionId: string | null) {
  const query = useQuery({
    ...actionsQueries.detail(workspaceId, actionId ?? ''),
    enabled: actionId !== null,
  });
  return actionId ? (query.data ?? null) : null;
}

function pageStatus(revision: AgentRevision, streaming: boolean, editing: boolean): string {
  if (streaming) return 'The agent is editing the page…';
  if (editing) return 'Unsaved changes';
  return `Revision ${revision.number}`;
}

export function usePageText(detail: AgentChatDetail, revision: AgentRevision, draft: PageDraft) {
  const run = isRunActive(detail.latest_run) ? detail.latest_run : null;
  const streamed = useLiveDocumentBody(run?.id);
  const streaming = run !== null && streamed !== null;
  const shown = streaming ? streamed : revision.body;
  const editing = draft.draft !== null;
  return {
    shown,
    text: draft.draft?.text ?? shown,
    editing,
    status: pageStatus(revision, streaming, editing),
  };
}

export function useWorkspaceTabs() {
  const narrow = useMediaQuery(NARROW_QUERY);
  const [stackTab, setStackTab] = useState<StackTab>('page');
  const [railTab, setRailTab] = useState<RailTab>('suggestions');
  return {
    narrow,
    stackTab,
    setStackTab,
    railTab,
    setRailTab,
    inPage: (act: () => void) => {
      if (!narrow) return act();
      setStackTab('page');
      requestAnimationFrame(act);
    },
    showChat: () => {
      if (narrow) setStackTab('chat');
    },
    showSuggestions: () => {
      setRailTab('suggestions');
      if (narrow) setStackTab('suggestions');
    },
  };
}
