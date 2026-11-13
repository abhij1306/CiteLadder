import { agentPageFieldsSchema } from '@citeladder/contracts/agent';
import {
  hasPendingServerTool,
  webSearchBlocks,
  type ConversationBlock,
} from '../models/conversation.ts';
import { AgentError, type SkillCatalog } from './contracts.ts';
import type { ModelResult } from './model-calls.ts';
import type { chatDocuments } from './outputs.ts';
import type { Turn } from './runtime.ts';
import { fetchesPage } from './skills.ts';
import type { TurnState } from './turn-budget.ts';

/** The chat's page documents, which take suggestions, with their SEO fields. */
export function pageDocuments(documents: Awaited<ReturnType<typeof chatDocuments>>) {
  return documents.flatMap(({ output, revision }) =>
    fetchesPage({ outputKind: output.kind }) && revision.fields !== null
      ? [
          {
            number: output.number,
            outputId: output.id,
            fields: agentPageFieldsSchema.parse(revision.fields),
          },
        ]
      : [],
  );
}
/** The workflow's pinned format, else the latest document's. */
function currentFormat(turn: Turn) {
  return turn.manifest.workflow?.format_id ?? turn.latest?.output.format_id ?? null;
}
/** The web searches a response ran: as the provider reported them, else as its blocks show. */
export function reportedSearches(response: ModelResult) {
  const reported = response.usage.web_search_requests;
  return typeof reported === 'number' ? reported : webSearchBlocks(response.blocks).calls.length;
}
export function initialState(catalog: SkillCatalog, turn: Turn): TurnState {
  const skill = catalog.skills.get(
    turn.run.requested_skill_id ?? turn.latest?.output.skill_id ?? '',
  );
  if (turn.run.requested_skill_id && !skill) throw new AgentError('skills_changed');
  return {
    skill,
    skillSource: turn.run.requested_skill_source ?? (skill ? 'chat' : null),
    formatId: currentFormat(turn),
    documents: turn.documents.map(({ output, revision }) => ({
      number: output.number,
      kind: output.kind,
      skillId: output.skill_id,
      formatId: output.format_id,
      title: revision.title,
      body: revision.body,
    })),
    staged: new Map(),
    personIds: turn.personIds,
    pages: turn.pages,
    rules: turn.rules,
    suggestions: [],
    read: [],
    web: new Map(),
    queries: new Map(),
    waiting: false,
    searches: 0,
    steps: [],
    toolsUsed: 0,
    messages: [],
    contextHash: '',
  };
}
/** Records one response's web searches: a step per result, and the pages each returned. */
function searched(state: TurnState, ordinal: number, blocks: ConversationBlock[]) {
  const { calls, results } = webSearchBlocks(blocks);
  for (const call of calls) state.queries.set(call.id, call.query);
  for (const { callId, sources } of results) {
    state.steps.push({
      kind: 'search',
      ordinal,
      status: sources ? 'completed' : 'failed',
      call_id: callId.slice(0, 64),
      query: (state.queries.get(callId) ?? '').slice(0, 200),
    });
    for (const source of sources ?? [])
      if (!state.web.has(source.url)) state.web.set(source.url, source.title);
  }
}
/** Appends a kept response as the assistant's message and records its step and searches. */
export function accepted(state: TurnState, ordinal: number, response: ModelResult) {
  // An empty assistant message would make every later replay of this chat invalid.
  const blocks = response.blocks.length ? response.blocks : [{ type: 'text', text: '(no answer)' }];
  state.messages.push({ role: 'assistant', content: blocks });
  state.steps.push({ kind: 'model', ordinal });
  searched(state, ordinal, blocks);
  // A paused search loop continues from the unchanged response in the next call.
  state.waiting = response.stop === 'pause_turn' || hasPendingServerTool(blocks);
}
