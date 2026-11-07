/**
 * Agent query-key namespace: the project's chats and instructions (scoped
 * keys), one chat's persisted state and its output revisions, and the
 * workspace's skill catalog.
 */
import { scopedKeys, type ProjectScope } from './scope';

const agent = scopedKeys('agent');
/** One chat's persisted state, in every workspace: the prefix a turn or an edit refreshes. */
const chatDetail = (chatId: string) => ['agent', 'chat', chatId] as const;
/** Every output's revision list in one chat, in every workspace. */
const chatRevisions = (chatId: string) => ['agent', 'revisions', chatId] as const;

export const agentKeys = {
  ...agent,
  /** Every page of every chat-list filter for the project: a new turn reorders them all. */
  chatLists: (projectId: string) => agent.resource(projectId, 'chats'),
  chats: (scope: ProjectScope, filters: { q: string | null; actionId: string | null }) =>
    agent.read('chats', scope, filters),
  instructions: (scope: ProjectScope) => agent.read('instructions', scope),
  // A chat page knows only its chat id, so a chat's reads are keyed by the
  // chat; the workspace follows so the chat prefix reaches every workspace's copy.
  chatDetail,
  chatRevisions,
  chat: (workspaceId: string | null, chatId: string) =>
    [...chatDetail(chatId), workspaceId] as const,
  /** Keyed by the latest revision too, so a new revision reads a fresh list. */
  revisions: (
    workspaceId: string | null,
    chatId: string,
    outputId: string,
    latestRevisionId: string,
  ) => [...chatRevisions(chatId), workspaceId, outputId, latestRevisionId] as const,
  // The catalog the workspace's plan offers; never reused across workspaces.
  skills: (workspaceId: string | null) => ['agent', 'skills', workspaceId] as const,
};
