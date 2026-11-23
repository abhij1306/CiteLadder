import { agentPageFieldsSchema } from '@citeladder/contracts/agent';
import {
  hasPendingServerTool,
  webSearchBlocks,
  type ConversationBlock,
} from '../models/conversation.ts';
import { AgentError, type SkillCatalog } from './contracts.ts';
import { stepText } from './sources.ts';
import type { ModelResult } from './model-calls.ts';
import type { chatDocuments } from './outputs.ts';
import type { Turn } from './runtime.ts';
import { fetchesPage } from './skills.ts';
import type { TurnState } from './turn-budget.ts';

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
function currentFormat(turn: Turn) {
  return turn.manifest.workflow?.format_id ?? turn.latest?.output.format_id ?? null;
}
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
    proposals: [],
    views: [],
    toolsUsed: 0,
    messages: [],
    contextHash: '',
  };
}
export function documentStep(
  turn: Turn,
  state: TurnState,
  { number, edit }: { number: number; edit: boolean },
) {
  let action: 'created' | 'replaced' | 'edited' = 'created';
  if (edit) action = 'edited';
  else if (turn.documents.some(({ output }) => output.number === number)) action = 'replaced';
  const title = stepText(state.staged.get(number)?.payload.title ?? '');
  return { kind: 'document', action, number, title } as const;
}
function searched(state: TurnState, ordinal: number, blocks: ConversationBlock[]) {
  const { calls, results } = webSearchBlocks(blocks);
  for (const call of calls) state.queries.set(call.id, call.query);
  for (const { callId, sources } of results) {
    state.steps.push({
      kind: 'search',
      ordinal,
      status: sources ? 'completed' : 'failed',
      call_id: callId.slice(0, 64),
      query: stepText(state.queries.get(callId) ?? ''),
    });
    for (const source of sources ?? [])
      if (!state.web.has(source.url)) state.web.set(source.url, source.title);
  }
}
export function accepted(state: TurnState, ordinal: number, response: ModelResult) {
  const blocks = response.blocks.length ? response.blocks : [{ type: 'text', text: '(no answer)' }];
  state.messages.push({ role: 'assistant', content: blocks });
  state.steps.push({ kind: 'model', ordinal });
  searched(state, ordinal, blocks);
  state.waiting = response.stop === 'pause_turn' || hasPendingServerTool(blocks);
}
