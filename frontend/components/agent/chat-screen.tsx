'use client';

import { useParams } from 'react-router-dom';

import {
  ChatConversation,
  JumpToLatest,
  ReplyComposer,
  useChatThread,
} from '@/components/agent/chat-thread';
import { OutputPane } from '@/components/agent/output-pane';
import { useFollowLatest } from '@/components/agent/use-follow-latest';
import { useChatDetail } from '@/components/agent/use-chat-turns';
import { ListScreen } from '@/components/layout/page-shell';
import { ProjectLink } from '@/components/layout/scoped-link';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Stack } from '@/components/ui/layout';
import { QueryState } from '@/components/ui/query-state';
import type { AgentChatDetail } from '@/lib/api/agent';
import { useProjectContext, useWorkspaceCapability } from '@/lib/project/project-context';

/** One chat: a single thread with its output inline and the composer pinned below. */
export function ChatScreen() {
  const { chatId = '' } = useParams();
  const { activeProjectId, activeWorkspaceId } = useProjectContext();
  const workspaceId = activeWorkspaceId ?? '';
  const query = useChatDetail(workspaceId, chatId);

  // A failed background refresh keeps the chat on screen; only a first load fails the page.
  if (query.isError && !query.data)
    return (
      <ListScreen>
        <QueryState
          kind="error"
          error={query.error}
          fallback="This chat could not be loaded."
          onRetry={() => void query.refetch()}
          pending={query.isFetching}
        />
      </ListScreen>
    );
  if (!query.data)
    return (
      <ListScreen>
        <QueryState kind="loading" />
      </ListScreen>
    );
  if (query.data.chat.project_id !== activeProjectId)
    return (
      <ListScreen>
        <Alert tone="danger">This chat belongs to another project.</Alert>
      </ListScreen>
    );
  return (
    <ChatView key={`${workspaceId}:${chatId}`} detail={query.data} workspaceId={workspaceId} />
  );
}

function ChatView({
  detail,
  workspaceId,
}: Readonly<{ detail: AgentChatDetail; workspaceId: string }>) {
  const chatId = detail.chat.id;
  const canEdit = useWorkspaceCapability('run');
  const thread = useChatThread(workspaceId, detail);
  const { endRef, showJump, jumpToLatest } = useFollowLatest(detail);

  return (
    <ListScreen
      measure="workflow"
      // Fill the viewport below the shell chrome so the composer sits at the
      // bottom of a short thread. Kept identical in chat- and new-chat-screen.
      fill
      actions={<ChatHeaderActions detail={detail} />}
    >
      <Stack gap="workspace" className="min-w-0 flex-1 content-start">
        <ChatConversation
          thread={thread}
          detail={detail}
          output={
            detail.output ? (
              <OutputPane
                workspaceId={workspaceId}
                chatId={chatId}
                output={detail.output}
                runActive={thread.runActive}
                canEdit={canEdit}
                canSend={thread.access.canSend && !thread.turn.pending}
                onRevise={(message) => thread.turn.send(message)}
              />
            ) : null
          }
        />
      </Stack>
      {/* The composer stays at the bottom of the window while the thread scrolls. */}
      <div className="bg-panel z-sticky sticky bottom-0 pt-2 pb-4">
        <JumpToLatest show={showJump} onJump={jumpToLatest} />
        <ReplyComposer
          id="chat-message"
          thread={thread}
          detail={detail}
          placeholder={
            detail.output?.latest_revision
              ? 'Ask about the work or request a change. / picks a skill, @ mentions an Action.'
              : 'Ask a follow-up. / picks a skill, @ mentions an Action.'
          }
        />
      </div>
      <div ref={endRef} />
    </ListScreen>
  );
}

function ChatHeaderActions({ detail }: Readonly<{ detail: AgentChatDetail }>) {
  if (!detail.chat.action_id) return null;
  return (
    <Button asChild variant="ghost">
      <ProjectLink href={`/agent/actions/${detail.chat.action_id}`}>Open Action</ProjectLink>
    </Button>
  );
}
