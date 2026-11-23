import { useSyncExternalStore } from 'react';
import type { z } from 'zod';

import { agentTurnEventSchema } from '@citeladder/contracts/agent';
import { retryAfterSeconds } from '@citeladder/contracts/retry-after';
import {
  AGENT_RUN_RETRY,
  AGENT_STREAM_IDLE_MS,
  AGENT_STREAM_NOTIFY_FALLBACK_MS,
} from '@/lib/config/agent';
import { API_BASE_URL } from '@/lib/config/operational';
import { openSseStream, readSseResponse } from '@/lib/sse/use-event-stream';

export type TurnEvent = z.infer<typeof agentTurnEventSchema>;
type ToolEvent = Extract<TurnEvent, { type: 'tool' }>;
type LiveTool = Omit<ToolEvent, 'type'>;
type Written = { ordinal: number; text: string };

export type LiveTurn = {
  startedAt: number;
  connected: boolean;
  step: number | null;
  reply: Written[];
  document: { title: string | null; body: string | null } | null;
  tools: LiveTool[];
  thinking: Written[];
};

export function liveTurn(startedAt: number): LiveTurn {
  return {
    startedAt,
    connected: true,
    step: null,
    reply: [],
    document: null,
    tools: [],
    thinking: [],
  };
}

function appended(segments: readonly Written[], { ordinal, text }: Written): Written[] {
  const last = segments.at(-1);
  return last?.ordinal === ordinal
    ? [...segments.slice(0, -1), { ordinal, text: last.text + text }]
    : [...segments, { ordinal, text }];
}

const KEEP = 20;
const turns = new Map<string, LiveTurn>();
const chatOf = new Map<string, string>();
const listeners = new Set<() => void>();
const closeListeners = new Set<() => void>();
let frame: number | undefined;
let fallback: ReturnType<typeof setTimeout> | undefined;

function notify() {
  if (frame !== undefined) cancelAnimationFrame(frame);
  clearTimeout(fallback);
  frame = undefined;
  fallback = undefined;
  for (const listener of listeners) listener();
}

function notifyNextFrame() {
  if (fallback !== undefined) return;
  frame = requestAnimationFrame(notify);
  fallback = setTimeout(notify, AGENT_STREAM_NOTIFY_FALLBACK_MS);
}

function update(runId: string, change: (turn: LiveTurn) => LiveTurn) {
  const current = turns.get(runId);
  if (current) turns.set(runId, change(current));
}

function withDocument(turn: LiveTurn, event: Extract<TurnEvent, { type: 'document_delta' }>) {
  if (event.from === 0) return { ...turn, document: { title: event.title, body: event.text } };
  const body = turn.document?.body;
  if (body?.length !== event.from) return turn;
  return { ...turn, document: { title: event.title, body: body + (event.text ?? '') } };
}

export function applyTurnEvent(turn: LiveTurn, event: TurnEvent): LiveTurn {
  switch (event.type) {
    case 'step':
      return { ...turn, step: event.ordinal };
    case 'reply_delta':
      return { ...turn, reply: appended(turn.reply, event) };
    case 'thinking':
      return { ...turn, thinking: appended(turn.thinking, event) };
    case 'document_delta':
      return withDocument(turn, event);
    case 'tool': {
      const tool = {
        ordinal: event.ordinal,
        call_id: event.call_id,
        tool: event.tool,
        status: event.status,
        target: event.target,
      };
      const known = turn.tools.some((item) => item.call_id === tool.call_id);
      return {
        ...turn,
        tools: known
          ? turn.tools.map((item) => (item.call_id === tool.call_id ? tool : item))
          : [...turn.tools, tool],
      };
    }
    case 'done':
    case 'error':
      return turn;
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

async function read(
  response: Response,
  controller: AbortController,
  onEvent: (event: TurnEvent) => void,
) {
  if (!response.body) return;
  let idle: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    clearTimeout(idle);
    idle = setTimeout(() => controller.abort(), AGENT_STREAM_IDLE_MS);
  };
  arm();
  try {
    await readSseResponse(
      response.body,
      () => false,
      ({ data }) => {
        arm();
        if (!data) return;
        try {
          const parsed = agentTurnEventSchema.safeParse(JSON.parse(data));
          if (parsed.success) onEvent(parsed.data);
        } catch {}
      },
    );
  } finally {
    clearTimeout(idle);
  }
}

function retryDelayMs(response: Response): number {
  const seconds = retryAfterSeconds(response.headers.get('retry-after'));
  return seconds === undefined ? AGENT_RUN_RETRY.defaultDelayMs : Math.ceil(seconds) * 1000;
}

async function runStream(url: string, workspaceId: string | null, runId: string) {
  for (let attempt = 1; ; attempt += 1) {
    const controller = new AbortController();
    const response = await openSseStream({
      url,
      method: 'POST',
      workspaceId,
      lastEventId: null,
      signal: controller.signal,
    });
    if (response.status === 429 && attempt < AGENT_RUN_RETRY.maxAttempts) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, retryDelayMs(response));
      });
      continue;
    }
    if (!response.ok) return;
    await read(response, controller, (event) => {
      update(runId, (turn) => applyTurnEvent(turn, event));
      notifyNextFrame();
    });
    return;
  }
}

export function startLiveTurn(chatId: string, runId: string, workspaceId: string | null) {
  if (turns.has(runId)) return;
  turns.set(runId, liveTurn(Date.now()));
  chatOf.set(runId, chatId);
  for (const stale of [...turns.keys()].slice(0, Math.max(0, turns.size - KEEP))) {
    turns.delete(stale);
    chatOf.delete(stale);
  }
  void runStream(`${API_BASE_URL}/agent/chats/${chatId}/runs/${runId}/run`, workspaceId, runId)
    .catch(() => undefined)
    .finally(() => {
      update(runId, (turn) => ({ ...turn, connected: false }));
      notify();
      for (const listener of closeListeners) listener();
    });
  notify();
}

export function isLiveTurnConnected(runId: string | null | undefined) {
  return Boolean(runId && turns.get(runId)?.connected);
}

export function isChatLiveTurnConnected(chatId: string) {
  for (const [runId, chat] of chatOf)
    if (chat === chatId && isLiveTurnConnected(runId)) return true;
  return false;
}

export function onLiveTurnClosed(listener: () => void) {
  closeListeners.add(listener);
  return () => {
    closeListeners.delete(listener);
  };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useLiveTurnConnected(runId: string | null | undefined): boolean | undefined {
  return useSyncExternalStore(
    subscribe,
    () => (runId ? turns.get(runId)?.connected : undefined),
    () => undefined,
  );
}

export function useLiveDocumentBody(runId: string | null | undefined): string | null {
  return useSyncExternalStore(
    subscribe,
    () => (runId ? (turns.get(runId)?.document?.body ?? null) : null),
    () => null,
  );
}

export function useLiveTurn(runId: string | null | undefined): LiveTurn | undefined {
  return useSyncExternalStore(
    subscribe,
    () => (runId ? turns.get(runId) : undefined),
    () => undefined,
  );
}
