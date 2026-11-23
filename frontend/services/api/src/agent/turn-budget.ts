import type { z } from 'zod';
import type { agentStepSchema } from '@citeladder/contracts/agent';
import type { AgentView } from '@citeladder/contracts/agent-views';
import type { ConversationBlock, ConversationMessage } from '../models/conversation.ts';
import type { DocumentState } from './builtin-tools.ts';
import type { StoredProposal } from './change-proposals.ts';
import { AgentError, type Budget } from './contracts.ts';
import type { AgentModel } from './model-calls.ts';
import { refused, type ToolOutcome } from './tools.ts';

type StepRecord = z.input<typeof agentStepSchema>;
export type TurnState = DocumentState & {
  read: string[];
  web: Map<string, string>;
  queries: Map<string, string>;
  waiting: boolean;
  searches: number;
  steps: StepRecord[];
  proposals: StoredProposal[];
  views: AgentView[];
  toolsUsed: number;
  messages: ConversationMessage[];
  contextHash: string;
};
export function readLimit(budget: Budget, toolsUsed: number, parallel: number): ToolOutcome | null {
  if (toolsUsed >= budget.max_tool_calls)
    return refused(
      'tool_budget_spent',
      'The read budget for this turn is spent. Answer from what you have read.',
    );
  if (parallel >= budget.max_parallel_tool_calls)
    return refused(
      'parallel_limit',
      `At most ${budget.max_parallel_tool_calls} reads run in one step. Make this call in your next step.`,
    );
  return null;
}
function searchAllowance(budget: Budget, used: number, waiting: boolean, last: boolean) {
  const left = last ? 0 : Math.max(0, budget.max_web_searches - used);
  const allowed = Math.min(left, budget.max_web_searches_per_call);
  return waiting ? Math.max(1, allowed) : allowed;
}
export function retryEffort(effort: Budget['reasoning_effort'], ordinal: number, budget: Budget) {
  if (effort === 'low' || ordinal === budget.max_model_calls)
    throw new AgentError('output_too_long');
  return 'low' as const;
}
export function noReply(reads: number) {
  const read = reads === 1 ? 'one read' : `${reads} reads`;
  return reads
    ? `I completed ${read} but reached this turn’s limit before writing an answer. Nothing was saved. Narrow the request to one page, prompt or date range and ask again.`
    : 'I reached this turn’s limit before writing an answer. Nothing was saved. Narrow the request and ask again.';
}
function reminder(
  budget: Budget,
  ordinal: number,
  state: Pick<TurnState, 'toolsUsed' | 'searches'>,
) {
  const left = budget.max_model_calls - ordinal;
  if (left === 1)
    return 'This is the last step of the turn: answer now from what you have read and name anything still missing. Tool calls will be refused.';
  const notes = [
    left <= budget.limit_reminder_calls ? `${left} steps are left in this turn.` : '',
    state.toolsUsed >= budget.max_tool_calls
      ? 'The read budget for this turn is spent: answer from what you have read.'
      : '',
    budget.max_web_searches > 0 && state.searches >= budget.max_web_searches
      ? 'The web search budget for this turn is spent.'
      : '',
  ].filter(Boolean);
  return notes.join(' ');
}
export function nextSearches(model: AgentModel, budget: Budget, state: TurnState, ordinal: number) {
  if (model.adapter !== 'anthropic') return 0;
  return searchAllowance(budget, state.searches, state.waiting, ordinal === budget.max_model_calls);
}
export function resultsMessage(
  budget: Budget,
  state: TurnState,
  { ordinal, last, results }: { ordinal: number; last: boolean; results: ConversationBlock[] },
): ConversationMessage {
  const note = last || state.waiting ? '' : reminder(budget, ordinal, state);
  return { role: 'user', content: [...results, ...(note ? [{ type: 'text', text: note }] : [])] };
}
