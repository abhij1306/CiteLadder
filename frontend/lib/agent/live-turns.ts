'use client';

/**
 * Turns this tab started. Admission opens one streamed request per accepted
 * run, and the turn runs inside that request: it lives in this module, so
 * moving around the app keeps it running, while closing the tab ends the turn
 * as interrupted. Its events show the agent's calls and reads, its thinking
 * summary, and the reply and document as they are written; the persisted chat
 * read stays the record.
 */
import { useSyncExternalStore } from 'react';
import type { z } from 'zod';

import { agentTurnEventSchema } from '@citeladder/contracts/agent';
import { API_BASE_URL } from '@/lib/config/operational';
import { readSseResponse, streamHeaders } from '@/lib/sse/use-event-stream';

export type TurnEvent = z.infer<typeof agentTurnEventSchema>;
type ToolEvent = Extract<TurnEvent, { type: 'tool' }>;
/** One call's latest state; calls from one model response run together. */
type LiveTool = Omit<ToolEvent, 'type'>;
/** Text built from one model call's deltas; a later call's text replaces it. */
type Written = { ordinal: number; text: string };

export type LiveTurn = {
  startedAt: number;
  /** True while the stream is open; polling resumes when it closes. */
  connected: boolean;
  /** The ordinal of the newest model call. */
  step: number | null;
  /** The reply so far, kept through later calls until a newer call writes or the saved reply arrives. */
  reply: Written | null;
  /** The document being saved, so far. */
  document: { title: string | null; body: string | null } | null;
  /** Every call this turn, in the order they started. */
  tools: LiveTool[];
  /** The newest call's thinking summary. */
  thinking: Written | null;
};

export function liveTurn(startedAt: number): LiveTurn {
  return {
    startedAt,
    connected: true,
    step: null,
    reply: null,
    document: null,
    tools: [],
    thinking: null,
  };
}

function appended(current: Written | null, { ordinal, text }: Written): Written {
  return current?.ordinal === ordinal ? { ordinal, text: current.text + text } : { ordinal, text };
}

// Turns this tab is showing; only the most recent few are kept.
const KEEP = 20;
const turns = new Map<string, LiveTurn>();
const listeners = new Set<() => void>();

function update(runId: string, change: (turn: LiveTurn) => LiveTurn) {
  const current = turns.get(runId);
  if (!current) return;
  turns.set(runId, change(current));
  for (const listener of listeners) listener();
}

/** Folds one stream event into the turn's live view. */
export function applyTurnEvent(turn: LiveTurn, event: TurnEvent): LiveTurn {
  switch (event.type) {
    // Text stays through later steps, so a reply never blanks while the agent continues.
    case 'step':
      return { ...turn, step: event.ordinal };
    case 'reply_delta':
      return { ...turn, reply: appended(turn.reply, event) };
    case 'thinking':
      return { ...turn, thinking: appended(turn.thinking, event) };
    case 'document_delta':
      return { ...turn, document: { title: event.title, body: event.body } };
    case 'tool': {
      const tool = {
        ordinal: event.ordinal,
        call_id: event.call_id,
        tool: event.tool,
        status: event.status,
      };
      const known = turn.tools.some((item) => item.call_id === tool.call_id);
      return {
        ...turn,
        tools: known
          ? turn.tools.map((item) => (item.call_id === tool.call_id ? tool : item))
          : [...turn.tools, tool],
      };
    }
    // The stream closes after either; the persisted run read then shows how
    // the turn ended, including a failure, so neither changes the live view.
    case 'done':
    case 'error':
      return turn;
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

async function read(response: Response, onEvent: (event: TurnEvent) => void) {
  if (!response.body) return;
  await readSseResponse(
    response.body,
    () => false,
    ({ data }) => {
      if (!data) return;
      try {
        const parsed = agentTurnEventSchema.safeParse(JSON.parse(data));
        if (parsed.success) onEvent(parsed.data);
      } catch {
        // An unreadable frame is skipped; the persisted read still arrives.
      }
    },
  );
}

/** Opens the run's stream; the server's turn limit bounds it, so it has no timeout of its own. */
export function startLiveTurn(chatId: string, runId: string, workspaceId: string | null) {
  if (turns.has(runId)) return;
  turns.set(runId, liveTurn(Date.now()));
  for (const stale of [...turns.keys()].slice(0, Math.max(0, turns.size - KEEP)))
    turns.delete(stale);
  void fetch(`${API_BASE_URL}/agent/chats/${chatId}/runs/${runId}/run`, {
    method: 'POST',
    credentials: 'include',
    cache: 'no-store',
    headers: streamHeaders(workspaceId, null),
  })
    .then((response) =>
      read(response, (event) => update(runId, (turn) => applyTurnEvent(turn, event))),
    )
    .catch(() => undefined)
    .finally(() => update(runId, (turn) => ({ ...turn, connected: false })));
  for (const listener of listeners) listener();
}

/** Whether this tab holds an open stream for the run, so polling can wait. */
export function isLiveTurnConnected(runId: string | null | undefined) {
  return Boolean(runId && turns.get(runId)?.connected);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Re-renders only when the run's stream opens or closes, not on every event. */
export function useLiveTurnConnected(runId: string | null | undefined): boolean | undefined {
  return useSyncExternalStore(
    subscribe,
    () => (runId ? turns.get(runId)?.connected : undefined),
    () => undefined,
  );
}

export function useLiveTurn(runId: string | null | undefined): LiveTurn | undefined {
  return useSyncExternalStore(
    subscribe,
    () => (runId ? turns.get(runId) : undefined),
    () => undefined,
  );
}
