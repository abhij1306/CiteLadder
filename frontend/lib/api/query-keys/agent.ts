import { scopedKeys, type ProjectScope } from './scope';

const agent = scopedKeys('agent');
const chatDetail = (chatId: string) => ['agent', 'chat', chatId] as const;
const chatRevisions = (chatId: string) => ['agent', 'revisions', chatId] as const;
const chatSuggestions = (chatId: string) => ['agent', 'suggestions', chatId] as const;

export const agentKeys = {
  ...agent,
  chatLists: (projectId: string) => agent.resource(projectId, 'chats'),
  chats: (scope: ProjectScope, filters: { q: string | null; actionId: string | null }) =>
    agent.read('chats', scope, filters),
  instructions: (scope: ProjectScope) => agent.read('instructions', scope),
  chatDetail,
  chatRevisions,
  chat: (workspaceId: string | null, chatId: string) =>
    [...chatDetail(chatId), workspaceId] as const,
  revisions: (
    workspaceId: string | null,
    chatId: string,
    outputId: string,
    latestRevisionId: string,
  ) => [...chatRevisions(chatId), workspaceId, outputId, latestRevisionId] as const,
  chatSuggestions,
  suggestions: (
    workspaceId: string | null,
    chatId: string,
    outputId: string,
    marker: Readonly<{ revisionId: string; messageId: string | null }>,
  ) =>
    [
      ...chatSuggestions(chatId),
      workspaceId,
      outputId,
      marker.revisionId,
      marker.messageId,
    ] as const,
  skills: (workspaceId: string | null) => ['agent', 'skills', workspaceId] as const,
};
