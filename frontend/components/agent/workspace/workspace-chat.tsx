import { useEffect } from 'react';

import { ChatConversation, ReplyComposer, type ChatThread } from '@/components/agent/chat-thread';
import { useFollowLatest } from '@/components/agent/use-follow-latest';
import { EditorDock } from '@/components/ui/editor-workspace';
import type { AgentChatDetail } from '@/lib/api/agent';

const WORKSPACE_COMPOSER_ID = 'page-chat-message';

export function WorkspaceChat({
  thread,
  detail,
  focusRequest,
}: Readonly<{ thread: ChatThread; detail: AgentChatDetail; focusRequest: number }>) {
  const { scrollRef } = useFollowLatest();
  useEffect(() => {
    if (focusRequest > 0) document.getElementById(WORKSPACE_COMPOSER_ID)?.focus();
  }, [focusRequest]);
  return (
    <EditorDock
      label="Agent conversation"
      scrollRef={scrollRef}
      composer={
        <ReplyComposer
          id={WORKSPACE_COMPOSER_ID}
          thread={thread}
          detail={detail}
          placeholder="Ask about the page or request a change"
        />
      }
    >
      <ChatConversation thread={thread} detail={detail} />
    </EditorDock>
  );
}
