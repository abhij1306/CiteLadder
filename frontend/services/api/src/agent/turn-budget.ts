import type { ConversationBlock, ConversationMessage } from '../models/conversation.ts';
import type { DocumentState } from './builtin-tools.ts';
import { AgentError, type Budget } from './contracts.ts';
import type { AgentModel } from './model-calls.ts';
import { refused, type ToolOutcome } from './tools.ts';

type StepRecord = {
  kind: 'model' | 'skill' | 'document' | 'suggestion' | 'tool' | 'search';
  ordinal?: number;
  skill_id?: string;
  tool?: string;
  status?: string;
  call_id?: string;
  /** A web search's query, as the model wrote it. */
  query?: string;
};
export type TurnState = DocumentState & {
  /** Records this turn's reads supplied to the model: the reply's sources. */
  read: string[];
  /** Web pages this turn's searches returned, by URL: sources apart from CiteLadder records. */
  web: Map<string, string>;
  /** Each web search's query by call id, until its result arrives. */
  queries: Map<string, string>;
  /** The last response left a provider-hosted search for the next call to continue. */
  waiting: boolean;
  /** Web searches the provider ran this turn, discarded responses included. */
  searches: number;
  steps: StepRecord[];
  toolsUsed: number;
  /** This turn's messages, appended in order and persisted as its transcript. */
  messages: ConversationMessage[];
  contextHash: string;
};
/** Why a read cannot run in this step, or null when it may. */
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
/**
 * The web searches the next call may run, and is held for: what is left of the
 * turn's budget, at most the per-call cap. None left offers no search tool. A
 * search the previous response left waiting (beside a read, or paused) runs
 * in the next call, which must offer the tool, so at least one is offered then.
 * The last call starts no new search: one left waiting there could never run.
 */
function searchAllowance(budget: Budget, used: number, waiting: boolean, last: boolean) {
  const left = last ? 0 : Math.max(0, budget.max_web_searches - used);
  const allowed = Math.min(left, budget.max_web_searches_per_call);
  return waiting ? Math.max(1, allowed) : allowed;
}
/**
 * Thinking shares the output cap, so a cut-off call is discarded and asked
 * once more with low effort as the next call of the turn; a cut-off retry, or
 * a cut-off last call, ends the turn.
 */
export function retryEffort(effort: Budget['reasoning_effort'], ordinal: number, budget: Budget) {
  if (effort === 'low' || ordinal === budget.max_model_calls)
    throw new AgentError('output_too_long');
  return 'low' as const;
}
/** A turn never ends without a reply, even when the model wrote none. */
export function noReply(reads: number) {
  const read = reads === 1 ? 'one read' : `${reads} reads`;
  return reads
    ? `I completed ${read} but reached this turn’s limit before writing an answer. Nothing was saved. Narrow the request to one page, prompt or date range and ask again.`
    : 'I reached this turn’s limit before writing an answer. Nothing was saved. Narrow the request and ask again.';
}
/** Appended after a step's tool results, never deleted, so the cached history stays exact. */
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
/**
 * The searches call `ordinal` may run; the turn's last call starts none.
 * Provider-hosted search exists only on the Messages API.
 */
export function nextSearches(model: AgentModel, budget: Budget, state: TurnState, ordinal: number) {
  if (model.adapter !== 'anthropic') return 0;
  return searchAllowance(budget, state.searches, state.waiting, ordinal === budget.max_model_calls);
}
/** One step's tool results, with the step's reminder unless a search waits on them. */
export function resultsMessage(
  budget: Budget,
  state: TurnState,
  { ordinal, last, results }: { ordinal: number; last: boolean; results: ConversationBlock[] },
): ConversationMessage {
  // A search waiting on these results needs a message of results only.
  const note = last || state.waiting ? '' : reminder(budget, ordinal, state);
  return { role: 'user', content: [...results, ...(note ? [{ type: 'text', text: note }] : [])] };
}
