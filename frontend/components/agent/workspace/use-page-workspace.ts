import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, useSyncExternalStore } from 'react';

import { agentWriteFailure, isOutputConflict } from '@/lib/agent/errors';
import { useLiveTurn } from '@/lib/agent/live-turns';
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

export type RailTab = 'suggestions' | 'outline' | 'seo';
export type StackTab = 'page' | RailTab | 'chat';

/** Below 1024px the rail becomes tabs under the page (E1). */
const NARROW_QUERY = '(max-width: 1023px)';

function subscribeNarrow(onChange: () => void) {
  const media = globalThis.matchMedia?.(NARROW_QUERY);
  media?.addEventListener('change', onChange);
  return () => media?.removeEventListener('change', onChange);
}

function useNarrowWorkspace(): boolean {
  return useSyncExternalStore(
    subscribeNarrow,
    () => globalThis.matchMedia?.(NARROW_QUERY).matches ?? false,
    () => false,
  );
}

const EDIT_CONFLICT =
  'The page changed since you started editing, so your edits were not saved. Copy what you need, then discard them to see the latest version.';

/** The person's unsaved edit of the page, bound to the revision it started from. */
export function usePageDraft(workspaceId: string, output: AgentOutput, chatId: string) {
  const revision = output.latest_revision;
  const client = useQueryClient();
  const [draft, setDraft] = useState<{ base: string; text: string } | null>(null);
  const save = useMutation(agentMutations.editOutput(workspaceId));
  return {
    draft,
    /** The base moved on: the server will refuse this draft. */
    moved: draft !== null && draft.base !== revision.id,
    edit: (text: string) =>
      setDraft((current) => {
        const base = current?.base ?? revision.id;
        // Typed back to the revision it started from: nothing left to save.
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

/** Why a page save failed; a conflict with a newer revision says so in its own words. */
function saveFailure(error: unknown) {
  const failure = agentWriteFailure(error, 'save the page');
  return isOutputConflict(error) ? { ...failure, message: EDIT_CONFLICT } : failure;
}

export type PageDraft = ReturnType<typeof usePageDraft>;

/** The suggestions of the revision on screen, read again after each revision or turn. */
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
  // Positions are offsets in one revision; an older read never places a highlight.
  const page = query.data?.revision_id === revision.id ? query.data : null;
  return { query, page };
}

/** The Action this page chat works on, for Mark implemented and the coverage gaps. */
export function useChatAction(workspaceId: string, actionId: string | null) {
  const query = useQuery({
    ...actionsQueries.detail(workspaceId, actionId ?? ''),
    enabled: actionId !== null,
  });
  return actionId ? (query.data ?? null) : null;
}

/** What the page column says about the text on screen. */
function pageStatus(revision: AgentRevision, streaming: boolean, editing: boolean): string {
  if (streaming) return 'The agent is editing the page…';
  if (editing) return 'Unsaved changes';
  return `Revision ${revision.number}`;
}

/**
 * The text on screen: the person's unsaved edit, else the Agent's edit as it
 * streams while a turn runs (the page is read-only then), else the revision.
 */
export function usePageText(detail: AgentChatDetail, revision: AgentRevision, draft: PageDraft) {
  const run = isRunActive(detail.latest_run) ? detail.latest_run : null;
  const streamed = useLiveTurn(run?.id ?? null)?.document?.body ?? null;
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

/**
 * Which tab shows: the rail's on a wide screen, and below 1024px the stack's,
 * where the page, each rail panel and the chat are tabs of their own.
 */
export function useWorkspaceTabs() {
  const narrow = useNarrowWorkspace();
  const [stackTab, setStackTab] = useState<StackTab>('page');
  const [railTab, setRailTab] = useState<RailTab>('suggestions');
  return {
    narrow,
    stackTab,
    setStackTab,
    railTab,
    setRailTab,
    /** In the narrow form, the page tab shows before the editor scrolls. */
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
