import { useEffect } from 'react';

import { ChatConversation, ReplyComposer, type ChatThread } from '@/components/agent/chat-thread';
import { useFollowLatest } from '@/components/agent/use-follow-latest';
import { EditorDock } from '@/components/ui/editor-workspace';
import type { AgentChatDetail } from '@/lib/api/agent';

/** The composer's id, so Ask AI and Add to context can put the reader in it. */
const WORKSPACE_COMPOSER_ID = 'page-chat-message';

/**
 * Today's conversation and composer, docked in the workspace's rail. The page
 * is the document, so the thread does not repeat it; it follows the newest
 * reply while the reader is at its end. `focusRequest` moves focus into the
 * composer each time it changes (after Ask AI or Add to context wrote into it).
 */
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
          placeholder="Ask about the page or request a change. / picks a skill, @ mentions an Action."
        />
      }
    >
      <ChatConversation thread={thread} detail={detail} />
    </EditorDock>
  );
}
