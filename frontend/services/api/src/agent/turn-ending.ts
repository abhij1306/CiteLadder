import { sql } from 'kysely';
import type { Database } from '../db/database.ts';
import { ApiError } from '../errors.ts';
import { ModelError } from '../models/http.ts';
import { withoutPendingServerTools, type ConversationMessage } from '../models/conversation.ts';
import { authorize } from './access.ts';
import { documentLabel } from './builtin-tools.ts';
import { AgentError, type Json } from './contracts.ts';
import { RefusedDispatch } from './model-calls.ts';
import type { TurnState } from './turn-budget.ts';

export function failureCode(error: unknown) {
  if (error instanceof AgentError) return error.code;
  if (error instanceof ApiError && [403, 404].includes(error.status)) return 'access_revoked';
  if (error instanceof ModelError) return 'provider_error';
  // Validation and storage defects are ours, not the model provider's.
  return 'internal_error';
}
export type PromptSummary = Record<string, Json>;
export function bounded(text: string, limit: number, marker: string) {
  return text.length <= limit
    ? text
    : text.slice(0, Math.max(0, limit - marker.length)) + marker.slice(0, limit);
}
/** Merges the last prompt summary into the frozen manifest without rewriting it. */
export function withSummary(summary: PromptSummary) {
  return {
    context_manifest: sql<Json>`context_manifest || jsonb_build_object('prompt_summary', ${JSON.stringify(summary)}::jsonb)`,
  };
}
/** Whether the member may still write to the chat; a refusal answers false, a database error still throws. */
export async function stillAuthorized(db: Database, scope: Parameters<typeof authorize>[1]) {
  try {
    await authorize(db, scope);
    return true;
  } catch (error) {
    if (error instanceof ApiError || error instanceof AgentError) return false;
    throw error;
  }
}
/**
 * The transcript as saved: no later call continues the turn's last response,
 * so a provider-hosted call it left waiting (a paused or read-beside search on
 * the last call) is dropped, and every later replay pairs each tool use.
 */
export function savedTranscript(messages: readonly ConversationMessage[]): ConversationMessage[] {
  const last = messages.findLastIndex((message) => message.role === 'assistant');
  return messages.map((message, index) =>
    index === last ? { ...message, content: withoutPendingServerTools(message.content) } : message,
  );
}
export function savedNotice(number: number, formatLabel: string | null) {
  const format = formatLabel ? ` in ${formatLabel} format` : '';
  return `${documentLabel(number)} saved${format}.`;
}
/** One notice per page document the turn suggested changes to. */
export function suggestedNotices(suggestions: TurnState['suggestions']) {
  const counts = new Map<number, number>();
  for (const { document } of suggestions) counts.set(document, (counts.get(document) ?? 0) + 1);
  return [...counts]
    .toSorted(([left], [right]) => left - right)
    .map(([number, count]) => {
      const added = count === 1 ? 'One suggestion' : `${count} suggestions`;
      return `${added} added to ${documentLabel(number)}.`;
    });
}
export const UNAVAILABLE_REPLY =
  'The Agent model connection changed before I could write a summary.';
export const CLOSED_REPLY = 'The chat was closed before I wrote a summary.';
const unavailable = (error: unknown) => error instanceof RefusedDispatch;
/**
 * Whether the turn can end on the documents it staged: there is one, and the
 * transcript ends on a user message with no search waiting, so a closing reply
 * keeps every later replay well formed (B60, B69).
 */
export function closable(state: TurnState) {
  const staged = state.staged.size > 0 || state.suggestions.length > 0;
  return staged && !state.waiting && state.messages.at(-1)?.role === 'user';
}
/** A turn stopped after it staged a document, which it can still save (B69). */
export type StoppedTurn = { saveDocuments: () => Promise<void> };
/**
 * A call refused for an unavailable model after the turn staged a document answers null,
 * so the turn saves that document with a fixed reply (B60); anything else throws.
 */
export function unlessClosable(state: TurnState) {
  return (error: unknown) => {
    if (unavailable(error) && closable(state)) return null;
    throw error;
  };
}
