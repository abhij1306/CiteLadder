/**
 * A person's Apply, Dismiss, Revert, Apply all and Dismiss all on a page
 * document's suggestions (content optimization §3, phase 2 E4). Each names the
 * latest revision the person saw: a newer one is a conflict, never a silent
 * rebase. Each runs with the chat locked and idle. A suggestion whose span,
 * field or dependencies changed is marked stale instead of applied, and an
 * applied change appends one user revision, after which every other open
 * suggestion is rechecked against it.
 */
import { z } from 'zod';
import {
  agentSuggestionResultSchema,
  agentSuggestionsAppliedSchema,
} from '@citeladder/contracts/agent';
import { agentPolicy, AgentError, type Chat, type Scope } from '../agent/contracts.ts';
import {
  appendUserRevision,
  changeIdleChat,
  chatDocument,
  type PageFields,
} from '../agent/outputs.ts';
import { revisionView } from '../agent/reads.ts';
import type { Database } from '../db/database.ts';
import { notFound } from '../errors.ts';
import { overlaps, replaceSpans, type Span } from './anchors.ts';
import { documentBoard, suggestionView, type Entry } from './suggestion-views.ts';
import {
  appendEvent,
  appliedPosition,
  locate,
  readinessOf,
  recheckOpen,
  type Actor,
  type PageField,
  type RevisionChain,
  type StaleReason,
  type Suggestion,
} from './suggestions.ts';

type Result = z.input<typeof agentSuggestionResultSchema>;
type Revision = Awaited<ReturnType<typeof appendUserRevision>>;
/** One replacement to make: a body span or an SEO field. */
type Edit =
  | { kind: 'span'; at: Span; text: string }
  | { kind: 'field'; field: PageField; text: string };

/** The latest revision with the edits made, and where each span edit's text now sits. */
function edited(chain: RevisionChain, title: string, edits: readonly Edit[]) {
  const spans = edits.flatMap((edit) => (edit.kind === 'span' ? [edit] : []));
  const { body, placed } = replaceSpans(chain.latest.body, spans);
  if (!body.trim() || body.length > agentPolicy.output_body_max_chars)
    throw new AgentError('suggestion_too_long');
  let fields: PageFields | null = chain.latest.fields;
  for (const edit of edits)
    if (edit.kind === 'field' && fields) fields = { ...fields, [edit.field]: edit.text };
  const positions = new Map(spans.map((span, index) => [span, placed[index] ?? null]));
  return {
    content: { title, body, fields },
    positionOf: (edit: Edit) => (edit.kind === 'span' ? (positions.get(edit) ?? null) : null),
  };
}

/** The replacement that applies a ready suggestion where it is now. */
function applying(suggestion: Suggestion, at: Span | null): Edit {
  const text = suggestion.row.replacement ?? '';
  const { anchor } = suggestion;
  if (anchor.kind === 'field') return { kind: 'field', field: anchor.field, text };
  if (anchor.kind === 'span' && at) return { kind: 'span', at, text };
  throw new AgentError('suggestion_not_ready');
}

/** The replacement that puts an applied suggestion's original text back, or null when that text was edited since. */
function reverting(suggestion: Suggestion, chain: RevisionChain): Edit | null {
  const { anchor, row } = suggestion;
  if (anchor.kind === 'field')
    return chain.latest.fields?.[anchor.field] === row.replacement
      ? { kind: 'field', field: anchor.field, text: anchor.expected }
      : null;
  if (anchor.kind !== 'span') return null;
  const at = appliedPosition(suggestion, chain);
  return at ? { kind: 'span', at, text: anchor.quote.exact } : null;
}

/** Whether an earlier edit in the same Apply all changed something this suggestion depends on. */
function dependsOnBatch(entry: Entry, batch: readonly Edit[]) {
  const section = entry.located?.ok ? entry.located.section : null;
  return entry.suggestion.dependsOn.some((dependency) => {
    if (dependency.kind === 'body') return batch.some((edit) => edit.kind === 'span');
    if (dependency.kind === 'field')
      return batch.some((edit) => edit.kind === 'field' && edit.field === dependency.field);
    if (dependency.kind === 'section' && section)
      return batch.some((edit) => edit.kind === 'span' && overlaps(section, edit.at));
    return false;
  });
}

export class PageSuggestions {
  readonly db: Database;
  constructor(db: Database) {
    this.db = db;
  }

  /** Runs one change on the document the person saw, as its latest revision. */
  private change<T>(
    scope: Scope,
    target: { chatId: string; outputId: string; baseId: string },
    action: (db: Database, context: Context) => Promise<T>,
  ) {
    return changeIdleChat(this.db, scope, target.chatId, async (db, chat) => {
      const document = await chatDocument(db, chat, target.outputId);
      if (!document) throw notFound('Agent output');
      if (document.revision.id !== target.baseId) throw new AgentError('output_conflict');
      const { chain, entries } = await documentBoard(db, scope.workspaceId, document.output.id);
      const by: Actor = { actor: 'user', userId: scope.userId };
      return action(db, { scope, chat, document, chain, entries, by });
    });
  }

  /** Appends the user revision for these edits; the caller records its events, then rechecks. */
  private async revise(db: Database, context: Context, edits: readonly Edit[]) {
    const { content, positionOf } = edited(context.chain, context.document.revision.title, edits);
    const revision = await appendUserRevision(
      db,
      context.scope,
      context.chat,
      context.document,
      content,
    );
    return { revision, positionOf };
  }

  /** The suggestion as it now reads, with the change's outcome. */
  private async result(
    db: Database,
    context: Context,
    suggestionId: string,
    outcome: Result['outcome'],
    extra: { reason?: StaleReason; revision?: Revision },
  ) {
    const fresh = await documentBoard(db, context.scope.workspaceId, context.document.output.id);
    const entry = fresh.entries.find((item) => item.suggestion.row.id === suggestionId)!;
    return agentSuggestionResultSchema.parse({
      outcome,
      reason: extra.reason ?? null,
      suggestion: suggestionView(entry),
      revision: extra.revision ? revisionView(extra.revision) : null,
    });
  }

  apply(scope: Scope, target: Target) {
    return this.change(scope, target, async (db, context) => {
      const entry = find(context.entries, target.suggestionId);
      const { located } = entry;
      if (entry.status !== 'open' || !located) throw new AgentError('suggestion_not_open');
      if (readinessOf(entry.suggestion) !== 'ready') throw new AgentError('suggestion_not_ready');
      if (!located.ok) {
        await appendEvent(db, context.scope, entry.suggestion, {
          status: 'stale',
          by: context.by,
          reason: located.reason,
        });
        return this.result(db, context, target.suggestionId, 'stale', { reason: located.reason });
      }
      const edit = applying(entry.suggestion, located.position);
      const { revision, positionOf } = await this.revise(db, context, [edit]);
      await appendEvent(db, context.scope, entry.suggestion, {
        status: 'applied',
        by: context.by,
        revisionId: revision.id,
        position: positionOf(edit),
      });
      await recheckOpen(db, context.scope, context.document.output.id, context.by);
      return this.result(db, context, target.suggestionId, 'applied', { revision });
    });
  }

  dismiss(scope: Scope, target: Target) {
    return this.change(scope, target, async (db, context) => {
      const entry = find(context.entries, target.suggestionId);
      if (entry.status !== 'open') throw new AgentError('suggestion_not_open');
      await appendEvent(db, context.scope, entry.suggestion, {
        status: 'dismissed',
        by: context.by,
      });
      return this.result(db, context, target.suggestionId, 'dismissed', {});
    });
  }

  /**
   * Returns an applied or dismissed suggestion to open (E4). An applied one's
   * original text is restored only while its replacement is unchanged;
   * otherwise the revert is refused. A dismissed one reopens only if it still
   * holds, and is otherwise marked stale.
   */
  revert(scope: Scope, target: Target) {
    return this.change(scope, target, async (db, context) => {
      const entry = find(context.entries, target.suggestionId);
      if (entry.status === 'applied') return this.revertApplied(db, context, entry.suggestion);
      if (entry.status !== 'dismissed') throw new AgentError('suggestion_not_revertible');
      const located = locate(entry.suggestion, context.chain);
      if (!located.ok) {
        await appendEvent(db, context.scope, entry.suggestion, {
          status: 'stale',
          by: context.by,
          reason: located.reason,
        });
        return this.result(db, context, entry.suggestion.row.id, 'stale', {
          reason: located.reason,
        });
      }
      await appendEvent(db, context.scope, entry.suggestion, {
        status: 'reverted',
        by: context.by,
        revisionId: context.chain.latest.id,
        position: located.position,
      });
      return this.result(db, context, entry.suggestion.row.id, 'reverted', {});
    });
  }

  private async revertApplied(db: Database, context: Context, suggestion: Suggestion) {
    const edit = reverting(suggestion, context.chain);
    if (!edit) throw new AgentError('suggestion_revert_refused');
    const { revision, positionOf } = await this.revise(db, context, [edit]);
    await appendEvent(db, context.scope, suggestion, {
      status: 'reverted',
      by: context.by,
      revisionId: revision.id,
      position: positionOf(edit),
    });
    await recheckOpen(db, context.scope, context.document.output.id, context.by);
    return this.result(db, context, suggestion.row.id, 'reverted', { revision });
  }

  /**
   * Applies every open ready suggestion that holds and competes with no other
   * open one, in position order, in one revision. One whose dependency an
   * earlier one in the batch changed goes stale instead. Competing ones stay
   * open for the person to choose; those needing input are skipped.
   */
  applyAll(scope: Scope, target: Omit<Target, 'suggestionId'>) {
    return this.change(scope, target, async (db, context) => {
      let staled = await this.staleBroken(db, context);
      const batch: { entry: Entry; edit: Edit }[] = [];
      for (const entry of context.entries) {
        if (!entry.located?.ok || entry.chooseOne || readinessOf(entry.suggestion) !== 'ready')
          continue;
        if (
          dependsOnBatch(
            entry,
            batch.map((item) => item.edit),
          )
        ) {
          await appendEvent(db, context.scope, entry.suggestion, {
            status: 'stale',
            by: context.by,
            reason: 'dependency_changed',
          });
          staled++;
          continue;
        }
        batch.push({ entry, edit: applying(entry.suggestion, entry.located.position) });
      }
      let revision: Revision | null = null;
      if (batch.length) {
        const revised = await this.revise(
          db,
          context,
          batch.map((item) => item.edit),
        );
        revision = revised.revision;
        for (const { entry, edit } of batch)
          await appendEvent(db, context.scope, entry.suggestion, {
            status: 'applied',
            by: context.by,
            revisionId: revised.revision.id,
            position: revised.positionOf(edit),
          });
        staled += await recheckOpen(db, context.scope, context.document.output.id, context.by);
      }
      const { entries } = await documentBoard(db, scope.workspaceId, context.document.output.id);
      const after = entries.filter((entry) => entry.status === 'open');
      return agentSuggestionsAppliedSchema.parse({
        applied: batch.length,
        left_to_choose: after.filter((entry) => entry.chooseOne).length,
        needs_input: after.filter((entry) => readinessOf(entry.suggestion) === 'needs_input')
          .length,
        stale: staled,
        revision: revision ? revisionView(revision) : null,
      });
    });
  }

  /** Dismisses every open suggestion of the document. */
  dismissAll(scope: Scope, target: Omit<Target, 'suggestionId'>) {
    return this.change(scope, target, async (db, context) => {
      const open = context.entries.filter((entry) => entry.status === 'open');
      for (const entry of open)
        await appendEvent(db, context.scope, entry.suggestion, {
          status: 'dismissed',
          by: context.by,
        });
      return { dismissed: open.length };
    });
  }

  /** Marks every open suggestion that no longer holds stale; returns how many. */
  private async staleBroken(db: Database, context: Context) {
    let staled = 0;
    for (const entry of context.entries)
      if (entry.located && !entry.located.ok) {
        await appendEvent(db, context.scope, entry.suggestion, {
          status: 'stale',
          by: context.by,
          reason: entry.located.reason,
        });
        staled++;
      }
    return staled;
  }
}

type Target = { chatId: string; outputId: string; suggestionId: string; baseId: string };
type Context = {
  scope: Scope;
  chat: Chat;
  document: NonNullable<Awaited<ReturnType<typeof chatDocument>>>;
  chain: RevisionChain;
  entries: Entry[];
  by: Actor;
};

function find(entries: readonly Entry[], suggestionId: string) {
  const entry = entries.find((item) => item.suggestion.row.id === suggestionId);
  if (!entry) throw notFound('Suggestion');
  return entry;
}
