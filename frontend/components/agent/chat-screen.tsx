import { lazy } from 'react';
import { useParams } from 'react-router-dom';

import { ChatConversation, ReplyComposer, useChatThread } from '@/components/agent/chat-thread';
import { OutputPane } from '@/components/agent/output-pane';
import { useFollowLatest } from '@/components/agent/use-follow-latest';
import { useChatDetail } from '@/components/agent/use-chat-turns';
import { NotFoundScreen } from '@/components/templates/not-found-screen';
import { ThreadPage, ThreadPageLoading } from '@/components/templates/thread-page';
import { WorkbenchPage } from '@/components/templates/workbench-page';
import { IslandUnavailable, LazyIsland } from '@/components/ui/lazy-island';
import { ActionButton } from '@/components/ui/actions';
import { ComposerDock } from '@/components/ui/chat-dock';
import { Stack } from '@/components/ui/layout';
import { textRole } from '@/components/ui/typography';
import type { AgentChatDetail } from '@/lib/api/agent';
import { isNotFound } from '@/lib/api/errors';
import { useProjectScope } from '@/lib/project/active-project-scope';
import { useWorkspaceCapability } from '@/lib/project/project-context';
import { Notice, readErrorProps } from '@/components/ui/notice';
import { StateBlock } from '@/components/ui/state-block';

const PAGE_OUTPUT_KIND = 'page';

const PageWorkspace = lazy(() =>
  import('./workspace/page-workspace').then(({ PageWorkspace }) => ({ default: PageWorkspace })),
);

export function ChatScreen() {
  const { chatId = '' } = useParams();
  const { workspaceId, projectId } = useProjectScope();
  const query = useChatDetail(workspaceId, chatId);

  if (isNotFound(query.error)) return <NotFoundScreen />;
  if (query.isError && !query.data)
    return (
      <ThreadPage>
        <StateBlock
          kind="error"
          {...readErrorProps(query)}
          title="Couldn't load this chat"
          fallback="This chat could not be loaded."
        />
      </ThreadPage>
    );
  if (!query.data) return <ThreadPageLoading />;
  if (query.data.chat.project_id !== projectId)
    return (
      <ThreadPage>
        <Notice tone="negative">This chat belongs to another project.</Notice>
      </ThreadPage>
    );
  const page = query.data.outputs.find((output) => output.kind === PAGE_OUTPUT_KIND);
  if (page)
    return (
      <LazyIsland
        label="Page workspace"
        defects="surface"
        loading={
          <WorkbenchPage title={query.data.chat.title}>
            <StateBlock
              kind="loading"
              label="Loading the page workspace…"
              shape={{ kind: 'list' }}
            />
          </WorkbenchPage>
        }
        failed={
          <WorkbenchPage title={query.data.chat.title}>
            <IslandUnavailable message="Couldn't load the page workspace. Reload the page to try again." />
          </WorkbenchPage>
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
    <ThreadPage
      title={detail.chat.title}
      scrollRef={scrollRef}
      scrollLabel="Agent conversation"
      composer={
        <ComposerDock onJumpToLatest={showJump ? jumpToLatest : null}>
          <ReplyComposer
            id="chat-message"
            thread={thread}
            detail={detail}
            placeholder={
              detail.outputs.length > 0
                ? 'Ask about the work or request a change'
                : 'Ask a follow-up'
            }
          />
        </ComposerDock>
      }
      actions={<ChatHeaderActions detail={detail} />}
    >
      <Stack gap="workspace" className="min-w-0 flex-1 content-start">
        <p aria-hidden className={textRole('heading', 'desktop:hidden')}>
          {detail.chat.title}
        </p>
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
    </ThreadPage>
  );
}

function ChatHeaderActions({ detail }: Readonly<{ detail: AgentChatDetail }>) {
  if (!detail.chat.action_id) return null;
  return <ActionButton action="openAction" href={`/actions/${detail.chat.action_id}`} />;
}
