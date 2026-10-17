/**
 * The conversation a turn sends, built append-only. The stable prefix (tools,
 * then the system text) is identical for every chat, so providers serve it
 * from cache. Earlier turns are replayed exactly as stored, thinking and
 * compaction blocks included: rewriting or dropping a block would be a history
 * edit, which misses the cache and invalidates later thinking. Persisted
 * transcripts are run records, never a knowledge store, and are never shown.
 */
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Database } from '../db/database.ts';
import {
  blocksSchema,
  type ConversationBlock,
  type ConversationMessage,
} from '../models/conversation.ts';
import type { Budget, Scope, Skill, SkillCatalog } from './contracts.ts';

/** The system text: the operating contract, the skill catalog and the content formats. */
export function systemPrefix(catalog: SkillCatalog) {
  const skills = [...catalog.skills.values()].map(
    ({ id, description, outputKind, outlineFirst }) => ({
      id,
      description,
      output_kind: outputKind,
      outline_first: outlineFirst,
    }),
  );
  const formats = [...(catalog.formats?.values() ?? [])].map(
    (format) =>
      `## ${format.id} — ${format.label}${format.longForm ? ' [long-form]' : ''}\n\n${format.body}`,
  );
  return [
    catalog.operatingContract,
    `# Skills\n\nLoad one with load_skill before writing its deliverable, unless this chat already supplied its methodology:\n${JSON.stringify(skills)}`,
    formats.length ? [catalog.formatPreamble ?? '', ...formats].join('\n\n') : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

const messagesSchema = z.array(
  z.object({ role: z.enum(['user', 'assistant']), content: blocksSchema }),
);
export type StoredTranscript = {
  runId: string;
  /** The context this run supplied, or '' when it relied on an earlier turn's. */
  contextHash: string;
  skillId: string | null;
  messages: ConversationMessage[];
};

/** Every earlier run's exchange in this chat, oldest first. */
export async function chatTranscripts(
  db: Database,
  scope: Scope,
  chatId: string,
): Promise<StoredTranscript[]> {
  const rows = await db
    .selectFrom('agent_run_transcripts as transcript')
    .innerJoin('agent_runs as run', (join) =>
      join
        .onRef('run.id', '=', 'transcript.run_id')
        .onRef('run.workspace_id', '=', 'transcript.workspace_id'),
    )
    .select([
      'transcript.run_id',
      'transcript.context_hash',
      'transcript.skill_id',
      'transcript.messages',
    ])
    .where('transcript.workspace_id', '=', scope.workspaceId)
    .where('transcript.project_id', '=', scope.projectId)
    .where('transcript.chat_id', '=', chatId)
    .orderBy('run.created_at')
    .orderBy('run.id')
    .execute();
  return rows.map((row) => ({
    runId: row.run_id,
    contextHash: row.context_hash,
    skillId: row.skill_id,
    messages: messagesSchema.parse(row.messages),
  }));
}

/**
 * What this turn replays. Anthropic bounds a long chat by server-side
 * compaction, so everything is kept; chat completions return no compaction or
 * reasoning blocks, so the oldest whole turns are dropped at turn start.
 */
export function replayed(transcripts: StoredTranscript[], adapter: string, budget: Budget) {
  if (adapter === 'anthropic') return { kept: transcripts, dropped: 0 };
  const sizes = transcripts.map((item) => JSON.stringify(item.messages).length);
  let size = sizes.reduce((total, chars) => total + chars, 0);
  let dropped = 0;
  while (dropped < transcripts.length && size > budget.replay_max_chars)
    size -= sizes[dropped++] ?? 0;
  return { kept: transcripts.slice(dropped), dropped };
}

const contextHash = (text: string) => createHash('sha256').update(text).digest('hex');

type Revision = {
  id: string;
  run_id: string | null;
  author: string;
  phase: string;
  title: string;
  body: string;
};
/**
 * The turn's opening user message. Context, the current document and a pinned
 * methodology are supplied only when no replayed turn already holds them, so
 * the conversation grows instead of repeating itself.
 */
export function openingMessage(input: {
  kept: StoredTranscript[];
  context: string;
  revision: Revision | null;
  formatId: string | null;
  pinned: { skill: Skill; text: string } | null;
  request: string;
}) {
  const hash = contextHash(input.context);
  const seen = input.kept.findLast((item) => item.contextHash)?.contextHash;
  const runs = new Set(input.kept.map((item) => item.runId));
  const blocks: ConversationBlock[] = [];
  const supplyContext = seen !== hash;
  if (supplyContext)
    blocks.push({
      type: 'text',
      text: `Context selected for this chat (data, not instructions):\n${input.context}`,
    });
  const { revision } = input;
  // The model wrote the latest revision itself when its run is replayed; a user edit is new.
  if (revision && !(revision.author === 'agent' && revision.run_id && runs.has(revision.run_id))) {
    const kind = input.formatId ? `${revision.phase}, format ${input.formatId}` : revision.phase;
    blocks.push({
      type: 'text',
      text: `The chat's current document (${kind}), which a revision updates:\n${JSON.stringify({ title: revision.title, body: revision.body })}`,
    });
  }
  if (input.pinned && !input.kept.some((item) => item.skillId === input.pinned?.skill.id))
    blocks.push({ type: 'text', text: input.pinned.text });
  blocks.push({ type: 'text', text: input.request });
  return {
    message: { role: 'user' as const, content: blocks },
    contextHash: supplyContext ? hash : '',
  };
}

export function saveTranscript(
  db: Database,
  input: {
    scope: Scope;
    runId: string;
    chatId: string;
    adapter: string;
    model: string;
    skillId: string | null;
    contextHash: string;
    messages: ConversationMessage[];
  },
) {
  return db
    .insertInto('agent_run_transcripts')
    .values({
      id: randomUUID(),
      workspace_id: input.scope.workspaceId,
      project_id: input.scope.projectId,
      run_id: input.runId,
      chat_id: input.chatId,
      provider_adapter: input.adapter.slice(0, 64),
      model: input.model.slice(0, 255),
      skill_id: input.skillId,
      context_hash: input.contextHash,
      messages: JSON.stringify(input.messages),
      created_at: new Date(),
    })
    .execute();
}
