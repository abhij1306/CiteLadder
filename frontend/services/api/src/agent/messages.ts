import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { z } from 'zod';
import { agentAttachmentSchema } from '@citeladder/contracts/agent';
import type { Database } from '../db/database.ts';
import { notFound } from '../errors.ts';
import type { Chat, Json, Run, Scope } from './contracts.ts';

export async function workspaceChat(db: Database, workspaceId: string, id: string): Promise<Chat> {
  const chat = await db
    .selectFrom('agent_chats')
    .selectAll()
    .where('id', '=', id)
    .where('workspace_id', '=', workspaceId)
    .executeTakeFirst();
  if (!chat) throw notFound('Chat');
  return chat;
}
export async function getChat(db: Database, scope: Scope, id: string, lock = false): Promise<Chat> {
  let query = db
    .selectFrom('agent_chats')
    .selectAll()
    .where('id', '=', id)
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId);
  if (lock) query = query.forUpdate();
  const chat = await query.executeTakeFirst();
  if (!chat) throw notFound('Chat');
  return chat;
}
export async function appendMessage(
  db: Database,
  chat: Chat,
  input: {
    role: 'user' | 'agent';
    content: string;
    userId?: string;
    replyTo?: string;
    skillId?: string | null;
    skillSource?: string | null;
    evidence?: string[];
    webSources?: { url: string; title: string }[];
    steps?: Json[];
    mentions?: Json[];
    attachments?: Json[];
    proposals?: Json[];
    views?: Json[];
  },
) {
  const previous = await db
    .selectFrom('agent_messages')
    .select(sql<number>`coalesce(max(sequence), 0)`.as('last'))
    .where('workspace_id', '=', chat.workspace_id)
    .where('chat_id', '=', chat.id)
    .executeTakeFirstOrThrow();
  return db
    .insertInto('agent_messages')
    .values({
      id: randomUUID(),
      workspace_id: chat.workspace_id,
      project_id: chat.project_id,
      chat_id: chat.id,
      sequence: previous.last + 1,
      role: input.role,
      content: input.content,
      author_user_id: input.userId ?? null,
      reply_to_message_id: input.replyTo ?? null,
      skill_id: input.skillId ?? null,
      skill_source: input.skillSource ?? null,
      evidence_refs: JSON.stringify(input.evidence ?? []),
      web_sources: JSON.stringify(input.webSources ?? []),
      steps: JSON.stringify(input.steps ?? []),
      mentions: JSON.stringify(input.mentions ?? []),
      attachments: JSON.stringify(input.attachments ?? []),
      proposals: JSON.stringify(input.proposals ?? []),
      views: JSON.stringify(input.views ?? []),
      created_at: new Date(),
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}
export async function turnRequest(db: Database, chat: Chat, messageId: string) {
  const messages = await db
    .selectFrom('agent_messages')
    .select(['id', 'content', 'attachments'])
    .where('workspace_id', '=', chat.workspace_id)
    .where('chat_id', '=', chat.id)
    .where('role', '=', 'user')
    .execute();
  const parsed = messages.map((message) => ({
    id: message.id,
    text: message.content,
    attachments: z.array(agentAttachmentSchema).parse(message.attachments),
  }));
  const request = parsed.find((message) => message.id === messageId);
  if (!request) throw new Error('The turn has no request message');
  return {
    request: { text: request.text, attachments: request.attachments },
    written: parsed.flatMap((message) => [
      message.text,
      ...message.attachments.map((attachment) => attachment.text),
    ]),
  };
}
const RECOVERY: Record<string, string> = {
  stopped_at_limit:
    'I reached this turn’s step limit before I could finish. Nothing was saved. Narrow the request and try again.',
  output_too_long:
    'The model ran out of room to finish this step, even after a second, shorter attempt, so nothing was saved. Ask for one part at a time.',
  context_too_long:
    'This chat is now longer than the model can read at once, so nothing was saved. Start a new chat to continue.',
  context_size_limit:
    'This request and its selected evidence are too large for one turn. Remove some references or ask about one part at a time.',
  skills_changed:
    'CiteLadder was updated while this request was waiting. Nothing was saved; send it again.',
  model_unavailable:
    'The Agent model is not configured. Set DEFAULT_AGENT_API_KEY, DEFAULT_AGENT_BASE_URL and DEFAULT_AGENT_MODEL, then restart. Nothing was saved.',
  model_changed:
    'The AI model changed while this request was waiting. Nothing was saved; send it again.',
  provider_error:
    'The AI model did not respond after several attempts. Nothing was saved; try again in a moment.',
  cancelled: 'Stopped. Nothing from this turn was saved.',
  interrupted:
    'The page closed before I finished, so this turn stopped. Nothing was saved; send it again.',
  turn_timeout:
    'This turn ran past its time limit, so it stopped. Nothing was saved. Narrow the request and try again.',
  internal_error:
    'Something went wrong on our side while finishing this request. Nothing was saved; try again in a moment.',
  model_refused:
    'The AI model declined to answer this request, so nothing was saved. Rephrase it, or ask about one part at a time.',
};
const GENERIC_RECOVERY =
  'I couldn’t complete this request. Nothing was saved; your messages and existing work are still here. Try again in this chat.';
export function recoveryReply(code: string) {
  return RECOVERY[code] ?? GENERIC_RECOVERY;
}
export function touchChat(db: Database, workspaceId: string, chatId: string) {
  const now = new Date();
  return db
    .updateTable('agent_chats')
    .set({ last_activity_at: now, updated_at: now })
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', chatId)
    .returningAll()
    .executeTakeFirstOrThrow();
}
export async function appendRecoveryReply(db: Database, run: Run, code: string) {
  const chat = await touchChat(db, run.workspace_id, run.chat_id);
  await appendMessage(db, chat, {
    role: 'agent',
    replyTo: run.user_message_id,
    content: recoveryReply(code),
  });
}
