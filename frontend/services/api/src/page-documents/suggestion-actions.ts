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
type Edit =
  | { kind: 'span'; at: Span; text: string }
  | { kind: 'field'; field: PageField; text: string };

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

function applying(suggestion: Suggestion, at: Span | null): Edit {
  const text = suggestion.row.replacement ?? '';
  const { anchor } = suggestion;
  if (anchor.kind === 'field') return { kind: 'field', field: anchor.field, text };
  if (anchor.kind === 'span' && at) return { kind: 'span', at, text };
  throw new AgentError('suggestion_not_ready');
}

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
          await /* NOSONAR -- One transaction connection: events append in order. */ appendEvent(
            db,
            context.scope,
            entry.suggestion,
            { status: 'stale', by: context.by, reason: 'dependency_changed' },
          );
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
          await /* NOSONAR -- One transaction connection: events append in order. */ appendEvent(
            db,
            context.scope,
            entry.suggestion,
            {
              status: 'applied',
              by: context.by,
              revisionId: revised.revision.id,
              position: revised.positionOf(edit),
            },
          );
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

  dismissAll(scope: Scope, target: Omit<Target, 'suggestionId'>) {
    return this.change(scope, target, async (db, context) => {
      const open = context.entries.filter((entry) => entry.status === 'open');
      for (const entry of open)
        await /* NOSONAR -- One transaction connection: events append in order. */ appendEvent(
          db,
          context.scope,
          entry.suggestion,
          {
            status: 'dismissed',
            by: context.by,
          },
        );
      return { dismissed: open.length };
    });
  }

  private async staleBroken(db: Database, context: Context) {
    let staled = 0;
    for (const entry of context.entries)
      if (entry.located && !entry.located.ok) {
        await /* NOSONAR -- One transaction connection: events append in order. */ appendEvent(
          db,
          context.scope,
          entry.suggestion,
          {
            status: 'stale',
            by: context.by,
            reason: entry.located.reason,
          },
        );
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
