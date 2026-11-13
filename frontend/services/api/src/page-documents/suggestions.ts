/**
 * Suggestions on a page document (content optimization phase 2, PR 2): the
 * insert-only findings, their append-only events, and where each one's text
 * is in the document's latest revision.
 *
 * A suggestion is made against one revision. Each event that leaves its text
 * in a revision (`open`, `applied`, `reverted`) records that revision and the
 * span there; every later revision moves it through the diff of each revision
 * against its predecessor. An open suggestion holds only while its span still
 * maps and still reads its exact quote, its field still equals the value it
 * was made against, and nothing it depends on changed since that revision.
 * Every revision a person or the Agent appends rechecks the open suggestions
 * and marks the ones that no longer hold `stale`; reads only report.
 */
import { randomUUID } from 'node:crypto';
import type { Selectable } from 'kysely';
import { z } from 'zod';
import {
  agentPageFieldsSchema,
  agentSuggestionAnchorSchema,
  agentSuggestionDependencySchema,
  agentSuggestionSchema,
  agentSuggestionStaleReasonSchema,
} from '@citeladder/contracts/agent';
import type { Database } from '../db/database.ts';
import type {
  AgentOutputSuggestionEvents,
  AgentOutputSuggestions,
} from '../generated/db-schema.ts';
import { bodyChanges, mapSpan, overlaps, quoteOf, type Span } from './anchors.ts';
import { ruleGuidance } from './content-rules.ts';

export type Anchor = z.infer<typeof agentSuggestionAnchorSchema>;
export type Dependency = z.infer<typeof agentSuggestionDependencySchema>;
export type StaleReason = z.infer<typeof agentSuggestionStaleReasonSchema>;
export type PageField = keyof z.infer<typeof agentPageFieldsSchema>;
type PageFields = z.infer<typeof agentPageFieldsSchema>;
type Status = z.infer<typeof agentSuggestionSchema>['status'];
type EventRow = Selectable<AgentOutputSuggestionEvents>;
type EventStatus = 'open' | 'applied' | 'dismissed' | 'reverted' | 'stale';

/** One suggestion with its parsed anchor and dependencies and its events in order. */
export type Suggestion = {
  row: Selectable<AgentOutputSuggestions>;
  anchor: Anchor;
  dependsOn: Dependency[];
  events: EventRow[];
};
/** Who changed a suggestion: a person, the Agent's turn, or CiteLadder itself. */
export type Actor =
  | { actor: 'user'; userId: string }
  | { actor: 'agent'; runId: string | null }
  | { actor: 'system' };
/** A revision as the checks read it. */
export type RevisionText = { id: string; number: number; body: string; fields: PageFields | null };
type Owner = { workspaceId: string; projectId: string };

const dependencies = z.array(agentSuggestionDependencySchema);
const fieldsSchema = agentPageFieldsSchema.nullable();

const statusSchema = agentSuggestionSchema.shape.status;
/** Its status: the last event's, where `reverted` is open again. */
export function statusOf(suggestion: Suggestion): Status {
  const last = suggestion.events.at(-1)?.status ?? 'open';
  return last === 'reverted' ? 'open' : statusSchema.parse(last);
}

/** `ready` carries text to apply, `needs_input` asks the person, `advice` has neither. */
export function readinessOf(suggestion: Suggestion) {
  if (suggestion.row.replacement !== null) return 'ready' as const;
  return suggestion.row.needs_input === null ? ('advice' as const) : ('needs_input' as const);
}

/** The latest event that left the suggestion's text in a revision, with its span there. */
function lastPlaced(suggestion: Suggestion, statuses: readonly string[]) {
  const event = suggestion.events.findLast(
    (item) => item.revision_id !== null && statuses.includes(item.status),
  );
  if (!event?.revision_id) return null;
  const position =
    event.position_start === null || event.position_end === null
      ? null
      : { start: event.position_start, end: event.position_end };
  return { revisionId: event.revision_id, position };
}

/**
 * The document's revisions from the oldest one a suggestion still refers to,
 * in order; each revision's diff against its predecessor is computed once.
 */
export class RevisionChain {
  readonly revisions: readonly RevisionText[];
  readonly latest: RevisionText;
  private readonly index: Map<string, number>;
  private readonly steps = new Map<number, ReturnType<typeof bodyChanges>>();
  constructor(revisions: readonly RevisionText[]) {
    const latest = revisions.at(-1);
    if (!latest) throw new TypeError('A page document has at least one revision');
    this.revisions = revisions;
    this.latest = latest;
    this.index = new Map(revisions.map((revision, at) => [revision.id, at]));
  }
  revision(id: string) {
    const at = this.index.get(id);
    return at === undefined ? null : (this.revisions[at] ?? null);
  }
  private step(at: number) {
    let changes = this.steps.get(at);
    if (!changes) {
      changes = bodyChanges(this.revisions[at - 1]!.body, this.revisions[at]!.body);
      this.steps.set(at, changes);
    }
    return changes;
  }
  /** A span of one revision moved to the latest, or null when any later revision changed its text. */
  mapToLatest(revisionId: string, span: Span): Span | null {
    const from = this.index.get(revisionId);
    if (from === undefined) return null;
    let mapped: Span | null = span;
    for (let at = from + 1; mapped && at < this.revisions.length; at++)
      mapped = mapSpan(this.step(at), mapped);
    return mapped;
  }
}

/** Where an open suggestion's text is now, or why it no longer holds. */
export type Located =
  | { ok: true; position: Span | null; section: Span | null }
  | { ok: false; reason: StaleReason };
const stale = (reason: StaleReason): Located => ({ ok: false, reason });

type Held = { ok: true; position: Span | null } | { ok: false; reason: StaleReason };
/** The anchor's own check: the span still reads its quote, or the field still has its value. */
function anchorHolds(
  suggestion: Suggestion,
  chain: RevisionChain,
  base: { revisionId: string; position: Span | null },
): Held {
  const { anchor } = suggestion;
  if (anchor.kind === 'field')
    return chain.latest.fields?.[anchor.field] === anchor.expected
      ? { ok: true, position: null }
      : { ok: false, reason: 'field_changed' };
  if (anchor.kind === 'page') return { ok: true, position: null };
  const mapped = base.position ? chain.mapToLatest(base.revisionId, base.position) : null;
  if (!mapped || chain.latest.body.slice(mapped.start, mapped.end) !== anchor.quote.exact)
    return { ok: false, reason: 'span_changed' };
  return { ok: true, position: mapped };
}

/** The section a span's judgement read, at the base revision: the same extent around the span. */
function baseSection(
  anchor: Anchor,
  dependency: Extract<Dependency, { kind: 'section' }>,
  at: Span,
  body: string,
): Span {
  if (anchor.kind !== 'span') return { start: 0, end: body.length };
  const before = anchor.position.start - dependency.start;
  const after = dependency.end - anchor.position.end;
  return { start: Math.max(0, at.start - before), end: Math.min(body.length, at.end + after) };
}

/** Whether one dependency is unchanged since the base revision; a section reports where it is now. */
function dependencyHolds(
  suggestion: Suggestion,
  dependency: Dependency,
  chain: RevisionChain,
  base: { revision: RevisionText; position: Span | null },
): { ok: boolean; section?: Span } {
  switch (dependency.kind) {
    case 'span':
      return { ok: true };
    case 'body':
      return { ok: base.revision.body === chain.latest.body };
    case 'field':
      return {
        ok: base.revision.fields?.[dependency.field] === chain.latest.fields?.[dependency.field],
      };
    case 'section': {
      if (!base.position) return { ok: base.revision.body === chain.latest.body };
      const region = baseSection(suggestion.anchor, dependency, base.position, base.revision.body);
      const section = chain.mapToLatest(base.revision.id, region);
      return section ? { ok: true, section } : { ok: false };
    }
    default: {
      const _exhaustive: never = dependency;
      return _exhaustive;
    }
  }
}

/** Checks an open suggestion against the latest revision: its anchor, then each dependency. */
export function locate(suggestion: Suggestion, chain: RevisionChain): Located {
  const base = lastPlaced(suggestion, ['open', 'reverted']);
  const revision = base ? chain.revision(base.revisionId) : null;
  if (!base || !revision) return stale('span_changed');
  const held = anchorHolds(suggestion, chain, base);
  if (!held.ok) return held;
  let section: Span | null = null;
  for (const dependency of suggestion.dependsOn) {
    const result = dependencyHolds(suggestion, dependency, chain, {
      revision,
      position: base.position,
    });
    if (!result.ok) return stale('dependency_changed');
    section = result.section ?? section;
  }
  return { ok: true, position: held.position, section };
}

/** Where an applied span's replacement is now, or null once it was edited. */
export function appliedPosition(suggestion: Suggestion, chain: RevisionChain): Span | null {
  const placed = lastPlaced(suggestion, ['applied']);
  if (!placed?.position || suggestion.row.replacement === null) return null;
  const mapped = chain.mapToLatest(placed.revisionId, placed.position);
  if (!mapped) return null;
  return chain.latest.body.slice(mapped.start, mapped.end) === suggestion.row.replacement
    ? mapped
    : null;
}

/** The document's suggestions, oldest first, each with its events in order. */
export async function loadSuggestions(
  db: Database,
  workspaceId: string,
  outputId: string,
): Promise<Suggestion[]> {
  const rows = await db
    .selectFrom('agent_output_suggestions')
    .selectAll()
    .where('workspace_id', '=', workspaceId)
    .where('output_id', '=', outputId)
    .orderBy('created_at')
    .orderBy('id')
    .execute();
  if (!rows.length) return [];
  const events = await db
    .selectFrom('agent_output_suggestion_events')
    .selectAll()
    .where('workspace_id', '=', workspaceId)
    .where(
      'suggestion_id',
      'in',
      rows.map((row) => row.id),
    )
    .orderBy('suggestion_id')
    .orderBy('sequence')
    .execute();
  return rows.map((row) => ({
    row,
    anchor: agentSuggestionAnchorSchema.parse(row.anchor),
    dependsOn: dependencies.parse(row.depends_on),
    events: events.filter((event) => event.suggestion_id === row.id),
  }));
}

/** The revisions the suggestions refer to, from the oldest one onwards, through the latest. */
export async function loadChain(
  db: Database,
  workspaceId: string,
  outputId: string,
  suggestions: readonly Suggestion[],
) {
  const referenced = new Set(
    suggestions.flatMap((suggestion) =>
      suggestion.events.flatMap((event) => (event.revision_id ? [event.revision_id] : [])),
    ),
  );
  const numbers = referenced.size
    ? await db
        .selectFrom('agent_output_revisions')
        .select('number')
        .where('workspace_id', '=', workspaceId)
        .where('output_id', '=', outputId)
        .where('id', 'in', [...referenced])
        .execute()
    : [];
  const oldest = Math.min(...numbers.map((row) => row.number));
  let query = db
    .selectFrom('agent_output_revisions')
    .select(['id', 'number', 'body', 'fields'])
    .where('workspace_id', '=', workspaceId)
    .where('output_id', '=', outputId);
  // Without a referenced revision only the latest is read.
  query = Number.isFinite(oldest)
    ? query.where('number', '>=', oldest).orderBy('number')
    : query.orderBy('number', 'desc').limit(1);
  const rows = await query.execute();
  return new RevisionChain(
    rows
      .map((row) => ({ ...row, fields: fieldsSchema.parse(row.fields) }))
      .toSorted((left, right) => left.number - right.number),
  );
}

/** Appends one event; the caller holds the chat's lock, so the sequence is the next one. */
export async function appendEvent(
  db: Database,
  owner: Owner,
  suggestion: Suggestion,
  event: {
    status: EventStatus;
    by: Actor;
    revisionId?: string;
    position?: Span | null;
    reason?: StaleReason;
  },
) {
  const row = await db
    .insertInto('agent_output_suggestion_events')
    .values({
      id: randomUUID(),
      workspace_id: owner.workspaceId,
      project_id: owner.projectId,
      suggestion_id: suggestion.row.id,
      sequence: suggestion.events.length + 1,
      status: event.status,
      actor: event.by.actor,
      actor_user_id: event.by.actor === 'user' ? event.by.userId : null,
      run_id: event.by.actor === 'agent' ? event.by.runId : null,
      revision_id: event.revisionId ?? null,
      position_start: event.position?.start ?? null,
      position_end: event.position?.end ?? null,
      reason: event.reason ?? null,
      created_at: new Date(),
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  suggestion.events.push(row);
  return row;
}

/**
 * After a new revision of the document: every open suggestion that no longer
 * holds against it becomes stale. Returns how many did.
 */
export async function recheckOpen(db: Database, owner: Owner, outputId: string, by: Actor) {
  const suggestions = (await loadSuggestions(db, owner.workspaceId, outputId)).filter(
    (suggestion) => statusOf(suggestion) === 'open',
  );
  if (!suggestions.length) return 0;
  const chain = await loadChain(db, owner.workspaceId, outputId, suggestions);
  let staled = 0;
  for (const suggestion of suggestions) {
    const located = locate(suggestion, chain);
    if (located.ok) continue;
    await appendEvent(db, owner, suggestion, { status: 'stale', by, reason: located.reason });
    staled++;
  }
  return staled;
}

/** A finding to store, made against one revision. A span anchor is given by its position there. */
export type NewSuggestion = {
  /** Given before it is stored, so the turn that staged it could name it. */
  id: string;
  anchor: { kind: 'span'; position: Span } | { kind: 'field'; field: PageField } | { kind: 'page' };
  dependsOn: Dependency[];
  replacement: string | null;
  needsInput: string | null;
  /** A content rule catalog id; its category, source and strength are stored with it. */
  ruleId: string;
  rationale: string;
} & (
  | { source: 'model'; runId: string; messageId: string }
  | { source: 'site_health'; snapshotId: string; ruleVersion: string }
);

/** The stored anchor: a span's quote, or a field's value, read from the revision. */
function storedAnchor(anchor: NewSuggestion['anchor'], revision: RevisionText): Anchor {
  switch (anchor.kind) {
    case 'span':
      return {
        kind: 'span',
        position: anchor.position,
        quote: quoteOf(revision.body, anchor.position),
      };
    case 'field':
      return {
        kind: 'field',
        field: anchor.field,
        expected: revision.fields?.[anchor.field] ?? '',
      };
    case 'page':
      return { kind: 'page' };
    default: {
      const _exhaustive: never = anchor;
      return _exhaustive;
    }
  }
}

/** Stores one suggestion against a revision and opens it there. */
export async function insertSuggestion(
  db: Database,
  owner: Owner & { outputId: string; revision: RevisionText; by: Actor },
  input: NewSuggestion,
) {
  const anchor = storedAnchor(input.anchor, owner.revision);
  const { category, guidance } = ruleGuidance(input.ruleId);
  const row = await db
    .insertInto('agent_output_suggestions')
    .values({
      id: input.id,
      workspace_id: owner.workspaceId,
      project_id: owner.projectId,
      output_id: owner.outputId,
      revision_id: owner.revision.id,
      anchor_kind: anchor.kind,
      anchor: JSON.stringify(anchor),
      depends_on: JSON.stringify(input.dependsOn),
      replacement: input.replacement,
      needs_input: input.needsInput,
      category,
      rule_id: input.ruleId,
      rule_guidance: JSON.stringify(guidance),
      rationale: input.rationale,
      source: input.source,
      run_id: input.source === 'model' ? input.runId : null,
      message_id: input.source === 'model' ? input.messageId : null,
      snapshot_id: input.source === 'site_health' ? input.snapshotId : null,
      rule_version: input.source === 'site_health' ? input.ruleVersion : null,
      created_at: new Date(),
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  const suggestion: Suggestion = { row, anchor, dependsOn: input.dependsOn, events: [] };
  await appendEvent(db, owner, suggestion, {
    status: 'open',
    by: owner.by,
    revisionId: owner.revision.id,
    position: anchor.kind === 'span' ? anchor.position : null,
  });
  return suggestion;
}

/** Whether two open suggestions offer alternatives for the same text or the same field. */
export function competing(
  left: { anchor: Anchor; at: Span | null },
  right: { anchor: Anchor; at: Span | null },
) {
  if (left.anchor.kind === 'field' && right.anchor.kind === 'field')
    return left.anchor.field === right.anchor.field;
  return left.at !== null && right.at !== null && overlaps(left.at, right.at);
}
