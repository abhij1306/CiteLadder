/**
 * Agent query-key namespace: the project's chats, one chat's persisted state,
 * its output revisions, the skill catalog and the project instructions.
 */
export const agentKeys = {
  all: ['agent'] as const,
  chats: (projectId: string, filters: { q: string | null; actionId: string | null }) =>
    ['agent', 'chats', projectId, filters] as const,
  chatLists: (projectId: string) => ['agent', 'chats', projectId] as const,
  chat: (chatId: string) => ['agent', 'chat', chatId] as const,
  revisions: (chatId: string) => ['agent', 'revisions', chatId] as const,
  skills: () => ['agent', 'skills'] as const,
  instructions: (projectId: string) => ['agent', 'instructions', projectId] as const,
};
