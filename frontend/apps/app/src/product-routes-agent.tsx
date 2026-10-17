import { ActionDetailScreen } from '@/components/agent/action-detail-screen';
import { ActionsScreen } from '@/components/agent/actions-screen';
import { ChatScreen } from '@/components/agent/chat-screen';
import { ContextScreen } from '@/components/agent/context-screen';
import { NewChatScreen } from '@/components/agent/new-chat-screen';
import { SkillsScreen } from '@/components/agent/skills-screen';

/** `/agent`: New chat — composer, starters and the top recommended Actions. */
export function NewChatRouteElement() {
  return <NewChatScreen />;
}

/** `/agent/chats/:chatId`: the conversation and its output pane. */
export function ChatRouteElement() {
  return <ChatScreen />;
}

/** `/agent/actions`: Actions by deterministic priority, filterable. */
export function ActionsRouteElement() {
  return <ActionsScreen />;
}

/** `/agent/actions/:actionId`: diagnosis, members and linked chats. */
export function ActionDetailRouteElement() {
  return <ActionDetailScreen />;
}

/** `/agent/skills`: the read-only skill list. */
export function SkillsRouteElement() {
  return <SkillsScreen />;
}

/** `/agent/context`: company facts, competitors and Agent instructions. */
export function ContextRouteElement() {
  return <ContextScreen />;
}
