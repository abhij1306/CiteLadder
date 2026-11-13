/**
 * A page document's suggestions as the person and the model see them against
 * its latest revision: each one's status, where its text is now, and whether
 * it competes with another open suggestion. Reads compute this from the
 * persisted revisions and events and never write; a suggestion that no longer
 * holds is marked stale only by the next write.
 */
import { z } from 'zod';
import {
  agentSuggestionGuidanceSchema,
  agentSuggestionSchema,
  agentSuggestionsPageSchema,
} from '@citeladder/contracts/agent';
import type { Scope } from '../agent/contracts.ts';
import { workspaceChat } from '../agent/messages.ts';
import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { notFound } from '../errors.ts';
import type { Span } from './anchors.ts';
import {
  appliedPosition,
  competing,
  loadChain,
  loadSuggestions,
  locate,
  readinessOf,
  statusOf,
  type Located,
  type RevisionChain,
  type Suggestion,
} from './suggestions.ts';

const p = policy.content_optimization.suggestions;
const iso = (date: Date) => date.toISOString();
const guidanceSchema = agentSuggestionGuidanceSchema.nullable();

/** One suggestion against the latest revision. `located` is set for an open one only. */
export type Entry = {
  suggestion: Suggestion;
  status: ReturnType<typeof statusOf>;
  located: Located | null;
  position: Span | null;
  chooseOne: boolean;
};

const FIELD_ORDER = ['title', 'meta_description', 'json_ld'];
/** Body spans in position order, then SEO fields, then page-wide suggestions; ties by creation. */
function rank(entry: Entry): [number, number] {
  const { anchor } = entry.suggestion;
  if (entry.position) return [0, entry.position.start];
  if (anchor.kind === 'span') return [0, anchor.position.start];
  if (anchor.kind === 'field') return [1, FIELD_ORDER.indexOf(anchor.field)];
  return [2, 0];
}
function byPosition(left: Entry, right: Entry) {
  const [a, b] = [rank(left), rank(right)];
  return (
    a[0] - b[0] ||
    a[1] - b[1] ||
    left.suggestion.row.created_at.getTime() - right.suggestion.row.created_at.getTime()
  );
}

const holds = (entry: Entry) => entry.status === 'open' && entry.located?.ok === true;

/** Every suggestion of the document against the chain's latest revision, in position order. */
function board(suggestions: readonly Suggestion[], chain: RevisionChain): Entry[] {
  const entries = suggestions.map((suggestion): Entry => {
    const status = statusOf(suggestion);
    const located = status === 'open' ? locate(suggestion, chain) : null;
    let position = located?.ok ? located.position : null;
    if (status === 'applied') position = appliedPosition(suggestion, chain);
    return { suggestion, status, located, position, chooseOne: false };
  });
  const live = entries
    .filter(holds)
    .map((entry) => ({ entry, anchor: entry.suggestion.anchor, at: entry.position }));
  for (const item of live)
    item.entry.chooseOne =
      readinessOf(item.entry.suggestion) === 'ready' &&
      live.some((other) => other !== item && competing(item, other));
  return entries.toSorted(byPosition);
}

/** One entry as the API returns it. */
export function suggestionView(entry: Entry): z.infer<typeof agentSuggestionSchema> {
  const { row, anchor, dependsOn, events } = entry.suggestion;
  return agentSuggestionSchema.parse({
    id: row.id,
    output_id: row.output_id,
    revision_id: row.revision_id,
    source: row.source,
    category: row.category,
    rule_id: row.rule_id,
    // As stored when it was made; a later catalog change never rewrites it.
    guidance: guidanceSchema.parse(row.rule_guidance),
    rationale: row.rationale,
    anchor,
    depends_on: dependsOn,
    replacement: row.replacement,
    needs_input: row.needs_input,
    status: entry.status,
    readiness: readinessOf(entry.suggestion),
    position: entry.position,
    choose_one: entry.chooseOne,
    events: events.map((event) => ({
      status: event.status,
      actor: event.actor,
      revision_id: event.revision_id,
      reason: event.reason,
      created_at: iso(event.created_at),
    })),
    created_at: iso(row.created_at),
  });
}

/** Counts per status, open needs-input ones, and open ones per category in catalog order. */
function countsOf(entries: readonly Entry[]) {
  const status = (value: Entry['status']) => entries.filter((entry) => entry.status === value);
  const open = status('open');
  return {
    open: open.length,
    applied: status('applied').length,
    dismissed: status('dismissed').length,
    stale: status('stale').length,
    needs_input: open.filter((entry) => readinessOf(entry.suggestion) === 'needs_input').length,
    by_category: policy.content_rules.categories.flatMap((category) => {
      const count = open.filter((entry) => entry.suggestion.row.category === category).length;
      return count ? [{ category, open: count }] : [];
    }),
  };
}

/** A document's suggestions with the chain they were judged against. */
export async function documentBoard(db: Database, workspaceId: string, outputId: string) {
  const suggestions = await loadSuggestions(db, workspaceId, outputId);
  const chain = await loadChain(db, workspaceId, outputId, suggestions);
  return { chain, entries: board(suggestions, chain) };
}

/** `GET …/outputs/{output_id}/suggestions`: open, applied and dismissed ones, and the counts. */
export async function listSuggestions(
  db: Database,
  workspace: Pick<Scope, 'workspaceId'>,
  chatId: string,
  outputId: string,
) {
  const chat = await workspaceChat(db, workspace.workspaceId, chatId);
  const output = await db
    .selectFrom('agent_outputs')
    .select('id')
    .where('workspace_id', '=', chat.workspace_id)
    .where('project_id', '=', chat.project_id)
    .where('chat_id', '=', chat.id)
    .where('id', '=', outputId)
    .executeTakeFirst();
  if (!output) throw notFound('Agent output');
  const { chain, entries } = await documentBoard(db, chat.workspace_id, output.id);
  return agentSuggestionsPageSchema.parse({
    revision_id: chain.latest.id,
    items: entries.filter((entry) => entry.status !== 'stale').map(suggestionView),
    counts: countsOf(entries),
  });
}

const clip = (text: string) =>
  JSON.stringify(
    text.length > p.turn_list_quote_chars ? `${text.slice(0, p.turn_list_quote_chars)}…` : text,
  );

/** What a suggestion targets, as the model reads it. */
function digestTarget(anchor: Entry['suggestion']['anchor']) {
  if (anchor.kind === 'span') return `text ${clip(anchor.quote.exact)}`;
  if (anchor.kind === 'field') return `${anchor.field} ${clip(anchor.expected)}`;
  return 'the page';
}

/** What a suggestion offers: its text, the input it needs, else advice only. */
function digestOffer(row: Entry['suggestion']['row']) {
  if (row.replacement !== null) return `→ ${clip(row.replacement)}`;
  if (row.needs_input !== null) return `asks ${clip(row.needs_input)}`;
  return 'advice';
}

/** One suggestion as a line the model reads: its id, status, what it targets and what it offers. */
function digestLine(entry: Entry) {
  const { row, anchor } = entry.suggestion;
  return `- ${row.id} [${entry.status}] ${row.category}, ${row.rule_id}, ${row.source}: ${digestTarget(anchor)} ${digestOffer(row)}`;
}

/**
 * The document's suggestions for the model at the start of a turn, open ones
 * first, bounded by config; null when it has none.
 */
export function turnDigest(entries: readonly Entry[]) {
  if (!entries.length) return null;
  const ordered = [
    ...entries.filter((entry) => entry.status === 'open'),
    ...entries.filter((entry) => entry.status !== 'open'),
  ];
  const listed = ordered.slice(0, p.turn_list_max).map(digestLine);
  const more = ordered.length - listed.length;
  return [...listed, ...(more > 0 ? [`- and ${more} more`] : [])].join('\n');
}
