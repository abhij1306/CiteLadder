import { randomUUID } from 'node:crypto';
import { sql, type Selectable } from 'kysely';
import { z } from 'zod';
import type { Database } from '../db/database.ts';
import type { AgentOutputRevisions, AgentOutputs as OutputTable } from '../generated/db-schema.ts';
import type { WebSource } from '../models/conversation.ts';
import { recheckOpen } from '../page-documents/suggestions.ts';
import { authorize } from './access.ts';
import {
  agentPolicy,
  AgentError,
  outputPayloadSchema,
  outputSchema,
  type Chat,
  type OutputBounds,
  type OutputPayload,
  type Scope,
} from './contracts.ts';
import { getChat, touchChat } from './messages.ts';
import { requireIdle } from './store.ts';

type Output = Selectable<OutputTable>;
type Revision = Selectable<AgentOutputRevisions>;
export type ChatDocument = { output: Output; revision: Revision };

export async function chatDocuments(db: Database, chat: Chat): Promise<ChatDocument[]> {
  const outputs = await db
    .selectFrom('agent_outputs')
    .selectAll()
    .where('workspace_id', '=', chat.workspace_id)
    .where('project_id', '=', chat.project_id)
    .where('chat_id', '=', chat.id)
    .orderBy('number')
    .execute();
  if (!outputs.length) return [];
  const revisions = await db
    .selectFrom('agent_output_revisions')
    .selectAll()
    .distinctOn('output_id')
    .where('workspace_id', '=', chat.workspace_id)
    .where(
      'output_id',
      'in',
      outputs.map((output) => output.id),
    )
    .orderBy('output_id')
    .orderBy('number', 'desc')
    .execute();
  const latest = new Map(revisions.map((revision) => [revision.output_id, revision]));
  return outputs.map((output) => {
    const revision = latest.get(output.id);
    if (!revision) throw new TypeError('Agent output has no revision');
    return { output, revision };
  });
}

export function latestDocument(documents: readonly ChatDocument[]) {
  return documents.reduce<ChatDocument | null>(
    (latest, document) =>
      !latest || document.output.updated_at > latest.output.updated_at ? document : latest,
    null,
  );
}

export async function chatDocument(db: Database, chat: Chat, outputId: string) {
  const documents = await chatDocuments(db, chat);
  return documents.find((document) => document.output.id === outputId) ?? null;
}

export type AttachTarget = (
  db: Database,
  chat: Chat,
  output: Output,
  payload: OutputPayload,
  userId: string,
) => Promise<void>;

export async function saveAgentOutput(
  db: Database,
  chat: Chat,
  input: {
    number: number;
    kind: string;
    skillId: string;
    payload: OutputPayload;
    baseRevisionId: string | null;
    runId: string;
    messageId: string;
    userId: string;
    refs: string[];
    webSources: WebSource[];
    bounds?: OutputBounds;
  },
  attach: AttachTarget,
) {
  const payload = outputSchema(input.bounds).parse(input.payload);
  const documents = await chatDocuments(db, chat);
  const current = documents.find((document) => document.output.number === input.number) ?? null;
  if ((current?.revision.id ?? null) !== input.baseRevisionId)
    throw new AgentError('output_conflict');
  if (current && current.output.kind !== input.kind) throw new AgentError('output_conflict');
  const now = new Date();
  const output =
    current?.output ??
    (await db
      .insertInto('agent_outputs')
      .values({
        id: randomUUID(),
        workspace_id: chat.workspace_id,
        project_id: chat.project_id,
        chat_id: chat.id,
        number: input.number,
        action_id: chat.action_id,
        kind: input.kind,
        skill_id: input.skillId,
        format_id: null,
        target_kind: null,
        target_label: null,
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow());
  await attach(db, chat, output, payload, input.userId);
  await db
    .updateTable('agent_outputs')
    .set({ updated_at: now, format_id: payload.format_id ?? output.format_id })
    .where('workspace_id', '=', chat.workspace_id)
    .where('id', '=', output.id)
    .execute();
  const revision = await appendRevision(db, chat, output, current?.revision ?? null, {
    author: 'agent',
    run_id: input.runId,
    message_id: input.messageId,
    author_user_id: null,
    title: payload.title,
    body: payload.body,
    fields: pageFields(current?.revision.fields ?? null),
    source_refs: [...new Set(input.refs)],
    web_sources: input.webSources,
  });
  await recheckOpen(db, ownerOf(chat), output.id, { actor: 'agent', runId: input.runId });
  return revision;
}

const ownerOf = (chat: Chat) => ({ workspaceId: chat.workspace_id, projectId: chat.project_id });

const pageFieldsSchema = z.strictObject({
  title: z.string(),
  meta_description: z.string(),
  json_ld: z.string(),
});
export type PageFields = z.infer<typeof pageFieldsSchema>;
function pageFields(value: unknown): PageFields | null {
  return value === null ? null : pageFieldsSchema.parse(value);
}

type RevisionContent = Pick<
  Revision,
  'author' | 'author_user_id' | 'run_id' | 'message_id' | 'title' | 'body' | 'source_refs'
> & { web_sources: unknown; fields: PageFields | null };
function appendRevision(
  db: Database,
  chat: Chat,
  output: Output,
  parent: Revision | null,
  content: RevisionContent,
) {
  return db
    .insertInto('agent_output_revisions')
    .values({
      id: randomUUID(),
      workspace_id: chat.workspace_id,
      project_id: chat.project_id,
      output_id: output.id,
      number: (parent?.number ?? 0) + 1,
      parent_revision_id: parent?.id ?? null,
      ...content,
      fields: content.fields === null ? null : JSON.stringify(content.fields),
      source_refs: JSON.stringify(revisionRefs(content.source_refs)),
      web_sources: JSON.stringify(revisionWebSources(content.web_sources)),
      created_at: new Date(),
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export async function createFetchedDocument(
  db: Database,
  chat: Chat,
  input: {
    kind: string;
    skillId: string;
    snapshotId: string;
    title: string;
    body: string;
    fields: PageFields;
  },
) {
  const now = new Date();
  const last = await db
    .selectFrom('agent_outputs')
    .select(sql<number>`coalesce(max(number), 0)`.as('number'))
    .where('workspace_id', '=', chat.workspace_id)
    .where('chat_id', '=', chat.id)
    .executeTakeFirstOrThrow();
  const output = await db
    .insertInto('agent_outputs')
    .values({
      id: randomUUID(),
      workspace_id: chat.workspace_id,
      project_id: chat.project_id,
      chat_id: chat.id,
      number: last.number + 1,
      action_id: chat.action_id,
      kind: input.kind,
      skill_id: input.skillId,
      format_id: null,
      target_kind: null,
      target_label: null,
      snapshot_id: input.snapshotId,
      created_at: now,
      updated_at: now,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  const revision = await appendRevision(db, chat, output, null, {
    author: 'fetch',
    author_user_id: null,
    run_id: null,
    message_id: null,
    title: input.title,
    body: input.body,
    fields: pageFieldsSchema.parse(input.fields),
    source_refs: [],
    web_sources: [],
  });
  return { output, revision };
}

export function changeIdleChat<T>(
  database: Database,
  scope: Scope,
  chatId: string,
  action: (db: Database, chat: Chat) => Promise<T>,
) {
  return database.transaction().execute(async (trx) => {
    await authorize(trx, scope);
    const chat = await getChat(trx, scope, chatId, true);
    await requireIdle(trx, chat);
    const result = await action(trx, chat);
    await touchChat(trx, scope.workspaceId, chat.id);
    return result;
  });
}

export async function appendUserRevision(
  db: Database,
  scope: Scope,
  chat: Chat,
  current: ChatDocument,
  content: { title: string; body: string; fields: PageFields | null },
) {
  await touchOutput(db, scope, current.output.id);
  return appendRevision(db, chat, current.output, current.revision, {
    author: 'user',
    author_user_id: scope.userId,
    run_id: null,
    message_id: null,
    ...content,
    source_refs: current.revision.source_refs,
    web_sources: current.revision.web_sources,
  });
}

export class AgentOutputs {
  readonly db: Database;
  constructor(db: Database) {
    this.db = db;
  }
  edit(
    scope: Scope,
    chatId: string,
    outputId: string,
    edit: { baseId: string; title: string; body: string },
  ) {
    return changeIdleChat(this.db, scope, chatId, async (db, chat) => {
      const current = await chatDocument(db, chat, outputId);
      if (current?.revision.id !== edit.baseId || !current) throw new AgentError('output_conflict');
      const payload = outputPayloadSchema.parse({ title: edit.title, body: edit.body });
      const revision = await appendUserRevision(db, scope, chat, current, {
        ...payload,
        fields: pageFields(current.revision.fields),
      });
      await recheckOpen(db, scope, current.output.id, { actor: 'user', userId: scope.userId });
      return revision;
    });
  }
  restore(scope: Scope, chatId: string, outputId: string, revisionId: string) {
    return changeIdleChat(this.db, scope, chatId, async (db, chat) => {
      const current = await chatDocument(db, chat, outputId);
      if (!current) throw new AgentError('output_conflict');
      const source = await db
        .selectFrom('agent_output_revisions')
        .selectAll()
        .where('workspace_id', '=', scope.workspaceId)
        .where('output_id', '=', current.output.id)
        .where('id', '=', revisionId)
        .executeTakeFirst();
      if (!source) throw new AgentError('output_conflict');
      await touchOutput(db, scope, current.output.id);
      const revision = await appendRevision(db, chat, current.output, current.revision, {
        author: 'user',
        author_user_id: scope.userId,
        run_id: null,
        message_id: null,
        title: source.title,
        body: source.body,
        fields: pageFields(source.fields),
        source_refs: source.source_refs,
        web_sources: source.web_sources,
      });
      await recheckOpen(db, scope, current.output.id, { actor: 'user', userId: scope.userId });
      return revision;
    });
  }
  saveInstructions(scope: Scope, text: string) {
    const validated = z.string().max(agentPolicy.instructions_max_chars).parse(text);
    return this.db.transaction().execute(async (trx) => {
      await authorize(trx, scope);
      await trx
        .selectFrom('projects')
        .select('id')
        .where('workspace_id', '=', scope.workspaceId)
        .where('id', '=', scope.projectId)
        .forNoKeyUpdate()
        .executeTakeFirstOrThrow();
      const last = await trx
        .selectFrom('agent_instruction_revisions')
        .select('revision')
        .where('workspace_id', '=', scope.workspaceId)
        .where('project_id', '=', scope.projectId)
        .orderBy('revision', 'desc')
        .limit(1)
        .executeTakeFirst();
      return trx
        .insertInto('agent_instruction_revisions')
        .values({
          id: randomUUID(),
          workspace_id: scope.workspaceId,
          project_id: scope.projectId,
          created_by_user_id: scope.userId,
          revision: (last?.revision ?? 0) + 1,
          text: validated,
          created_at: new Date(),
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    });
  }
}
function touchOutput(db: Database, scope: Scope, outputId: string) {
  return db
    .updateTable('agent_outputs')
    .set({ updated_at: new Date() })
    .where('workspace_id', '=', scope.workspaceId)
    .where('id', '=', outputId)
    .execute();
}
export function revisionRefs(value: unknown) {
  return z.array(z.string()).parse(value);
}
const webSourceSchema = z.object({ url: z.string(), title: z.string() });
export function revisionWebSources(value: unknown): WebSource[] {
  return z.array(webSourceSchema).parse(value);
}
