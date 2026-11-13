import { lazy } from 'react';
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
import { ListScreen, RouteLoadingScreen } from '@/components/layout/page-shell';
import { IslandUnavailable, LazyIsland } from '@/components/ui/lazy-island';
import { ProjectLink } from '@/components/ui/project-link';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { ComposerDock } from '@/components/ui/chat-dock';
import { Stack } from '@/components/ui/layout';
import { QueryState } from '@/components/ui/query-state';
import type { AgentChatDetail } from '@/lib/api/agent';
import { useProjectScope } from '@/lib/project/active-project-scope';
import { useWorkspaceCapability } from '@/lib/project/project-context';

/** A chat working on a page (`optimize_page`) has this document, and opens as its workspace (E1). */
const PAGE_OUTPUT_KIND = 'page';

// The workspace carries the editor (CodeMirror), so it loads only for a page chat.
const PageWorkspace = lazy(() =>
  import('./workspace/page-workspace').then(({ PageWorkspace }) => ({ default: PageWorkspace })),
);

/**
 * One chat: a single thread with its documents inline and the composer pinned
 * below, or, once a page chat has its page, the page workspace.
 */
export function ChatScreen() {
  const { chatId = '' } = useParams();
  const { workspaceId, projectId } = useProjectScope();
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
  if (query.data.chat.project_id !== projectId)
    return (
      <ListScreen>
        <Callout tone="negative">This chat belongs to another project.</Callout>
      </ListScreen>
    );
  const page = query.data.outputs.find((output) => output.kind === PAGE_OUTPUT_KIND);
  if (page)
    return (
      <LazyIsland
        label="Page workspace"
        defects="surface"
        loading={<RouteLoadingScreen />}
        failed={
          <ListScreen>
            <IslandUnavailable message="The page workspace could not load. Reload the page to try again." />
          </ListScreen>
        }
      >
        <PageWorkspace
          key={`${workspaceId}:${chatId}`}
          detail={query.data}
          output={page}
          workspaceId={workspaceId}
        />
      </LazyIsland>
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
  const { scrollRef, showJump, jumpToLatest } = useFollowLatest();

  return (
    <ListScreen
      title={detail.chat.title}
      // Fill the viewport below the shell chrome: only the thread scrolls and
      // the composer stays under it. Kept identical in chat- and new-chat-screen.
      fill
      scrollRef={scrollRef}
      scrollLabel="Agent conversation"
      dock={
        <ComposerDock floating={showJump ? <JumpToLatest onJump={jumpToLatest} /> : null}>
          <ReplyComposer
            id="chat-message"
            thread={thread}
            detail={detail}
            placeholder={
              detail.outputs.length > 0
                ? 'Ask about the work or request a change. / picks a skill, @ mentions an Action.'
                : 'Ask a follow-up. / picks a skill, @ mentions an Action.'
            }
          />
        </ComposerDock>
      }
      actions={<ChatHeaderActions detail={detail} />}
    >
      <Stack gap="workspace" className="min-w-0 flex-1 content-start">
        <ChatConversation
          thread={thread}
          detail={detail}
          renderOutput={(output) => (
            <OutputPane
              workspaceId={workspaceId}
              chatId={chatId}
              output={output}
              runActive={thread.runActive}
              canEdit={canEdit}
              canSend={thread.access.canSend && !thread.turn.pending}
              onRevise={(message) => thread.turn.send(message)}
            />
          )}
        />
      </Stack>
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
