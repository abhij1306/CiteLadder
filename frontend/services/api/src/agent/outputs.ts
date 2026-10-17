import { randomUUID } from 'node:crypto';
import type { Selectable } from 'kysely';
import { agentOutputPhaseSchema } from '@citeladder/contracts/agent';
import { z } from 'zod';
import type { Database } from '../db/database.ts';
import type { AgentOutputRevisions, AgentOutputs as OutputTable } from '../generated/db-schema.ts';
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
  type Skill,
} from './contracts.ts';
import { getChat, touchChat } from './messages.ts';
import { requireIdle } from './store.ts';

type Output = Selectable<OutputTable>;
type Revision = Selectable<AgentOutputRevisions>;
export async function currentOutput(db: Database, chat: Chat) {
  const output = await db
    .selectFrom('agent_outputs')
    .selectAll()
    .where('workspace_id', '=', chat.workspace_id)
    .where('project_id', '=', chat.project_id)
    .where('chat_id', '=', chat.id)
    .executeTakeFirst();
  const revision = output
    ? await db
        .selectFrom('agent_output_revisions')
        .selectAll()
        .where('workspace_id', '=', chat.workspace_id)
        .where('output_id', '=', output.id)
        .orderBy('number', 'desc')
        .limit(1)
        .executeTakeFirst()
    : undefined;
  if (output && !revision) throw new TypeError('Agent output has no revision');
  const approved = output
    ? await db
        .selectFrom('agent_output_revisions')
        .select('id')
        .where('workspace_id', '=', chat.workspace_id)
        .where('output_id', '=', output.id)
        .where('phase', '=', 'outline')
        .where('approved_at', 'is not', null)
        .executeTakeFirst()
    : undefined;
  return { output: output ?? null, revision: revision ?? null, outlineApproved: Boolean(approved) };
}
/** Existing Action owner attaches targets in the same terminal transaction.
 * Required even for untargeted replies: no second Action writer lives here. */
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
    skill: Skill;
    payload: OutputPayload;
    baseRevisionId: string | null;
    runId: string;
    messageId: string;
    userId: string;
    refs: string[];
    /** The runtime's format-aware outline rule (long-form content, prompt portfolios). */
    outlineRequired: boolean;
    bounds?: OutputBounds;
  },
  attach: AttachTarget,
) {
  const payload = outputSchema(input.bounds).parse(input.payload);
  const current = await currentOutput(db, chat);
  if ((current.revision?.id ?? null) !== input.baseRevisionId)
    throw new AgentError('output_conflict');
  if (current.output && current.output.kind !== input.skill.outputKind)
    throw new AgentError('output_conflict');
  const phase = input.outlineRequired && !current.outlineApproved ? 'outline' : payload.phase;
  const now = new Date();
  const output =
    current.output ??
    (await db
      .insertInto('agent_outputs')
      .values({
        id: randomUUID(),
        workspace_id: chat.workspace_id,
        project_id: chat.project_id,
        chat_id: chat.id,
        action_id: chat.action_id,
        kind: input.skill.outputKind,
        skill_id: input.skill.id,
        phase,
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
    .set({ phase, updated_at: now, format_id: payload.format_id ?? output.format_id })
    .where('workspace_id', '=', chat.workspace_id)
    .where('id', '=', output.id)
    .execute();
  return appendRevision(db, chat, output, current.revision, {
    author: 'agent',
    run_id: input.runId,
    message_id: input.messageId,
    author_user_id: null,
    phase,
    title: payload.title,
    body: payload.body,
    source_refs: [...new Set(input.refs)],
  });
}
function appendRevision(
  db: Database,
  chat: Chat,
  output: Output,
  parent: Revision | null,
  content: Pick<
    Revision,
    | 'author'
    | 'author_user_id'
    | 'run_id'
    | 'message_id'
    | 'phase'
    | 'title'
    | 'body'
    | 'source_refs'
  >,
) {
  agentOutputPhaseSchema.parse(content.phase);
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
      source_refs: JSON.stringify(revisionRefs(content.source_refs)),
      approved_at: null,
      approved_by_user_id: null,
      created_at: new Date(),
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export class AgentOutputs {
  readonly db: Database;
  constructor(db: Database) {
    this.db = db;
  }
  private mutate<T>(
    scope: Scope,
    chatId: string,
    action: (db: Database, chat: Chat) => Promise<T>,
  ) {
    return this.db.transaction().execute(async (trx) => {
      await authorize(trx, scope);
      const chat = await getChat(trx, scope, chatId, true);
      await requireIdle(trx, chat);
      const result = await action(trx, chat);
      await touchChat(trx, scope.workspaceId, chat.id);
      return result;
    });
  }
  edit(scope: Scope, chatId: string, baseId: string, title: string, body: string) {
    return this.mutate(scope, chatId, async (db, chat) => {
      const current = await currentOutput(db, chat);
      if (current.revision?.id !== baseId || !current.output)
        throw new AgentError('output_conflict');
      const payload = outputPayloadSchema.parse({ title, body, phase: current.revision.phase });
      return appendRevision(db, chat, current.output, current.revision, {
        author: 'user',
        author_user_id: scope.userId,
        run_id: null,
        message_id: null,
        ...payload,
        source_refs: current.revision.source_refs,
      });
    });
  }
  restore(scope: Scope, chatId: string, revisionId: string) {
    return this.mutate(scope, chatId, async (db, chat) => {
      const current = await currentOutput(db, chat);
      if (!current.output || !current.revision) throw new AgentError('output_conflict');
      const source = await db
        .selectFrom('agent_output_revisions')
        .selectAll()
        .where('workspace_id', '=', scope.workspaceId)
        .where('output_id', '=', current.output.id)
        .where('id', '=', revisionId)
        .executeTakeFirst();
      if (!source) throw new AgentError('output_conflict');
      await db
        .updateTable('agent_outputs')
        .set({ phase: source.phase, updated_at: new Date() })
        .where('workspace_id', '=', scope.workspaceId)
        .where('id', '=', current.output.id)
        .execute();
      return appendRevision(db, chat, current.output, current.revision, {
        author: 'user',
        author_user_id: scope.userId,
        run_id: null,
        message_id: null,
        phase: source.phase,
        title: source.title,
        body: source.body,
        source_refs: source.source_refs,
      });
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
        .forUpdate()
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
export function revisionRefs(value: unknown) {
  return z.array(z.string()).parse(value);
}
