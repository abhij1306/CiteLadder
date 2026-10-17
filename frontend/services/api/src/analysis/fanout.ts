/** Deterministic search-event normalization and settled per-answer fanout. */
import type { visibilityExecutionEvidenceSchema } from '@citeladder/contracts/visibility-evidence';
import type { z } from 'zod';
import { record } from '../db/json.ts';
import { policy } from '../config.ts';
type Item = z.input<typeof visibilityExecutionEvidenceSchema>;
export type SearchEvent = Item['search_events'][number];
type FanoutState = Item['state'];

const EVENT_FIELDS = ['sequence', 'query', 'call_id', 'call_sequence', 'query_sequence'];

function eventInt(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : 0;
  if (typeof value === 'string' && /^\s*[+-]?\d+\s*$/u.test(value)) return Number(value.trim());
  return 0;
}

function eventText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return value === null || value === undefined ? '' : (JSON.stringify(value) ?? '');
}

/**
 * A stored event list, tolerantly: a non-list is no events, an entry with no
 * recognized field is malformed and skipped, and an empty query stays empty.
 */
function normalizeEvents(raw: unknown): SearchEvent[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const event = entry as Record<string, unknown>;
    if (!EVENT_FIELDS.some((field) => Object.hasOwn(event, field))) return [];
    return [
      {
        sequence: eventInt(event.sequence),
        query: eventText(event.query),
        call_id: eventText(event.call_id),
        call_sequence: eventInt(event.call_sequence),
        query_sequence: eventInt(event.query_sequence),
      },
    ];
  });
}

export type EventSource = 'raw_artifact' | 'audit_task' | 'none';

/** The artifact's events when it has any, else the task's copy; never both. */
export function selectEvents(
  artifactEvents: unknown,
  taskEvents: unknown,
): { events: SearchEvent[]; source: EventSource } {
  const fromArtifact = normalizeEvents(artifactEvents);
  if (fromArtifact.length) return { events: fromArtifact, source: 'raw_artifact' };
  const fromTask = normalizeEvents(taskEvents);
  if (fromTask.length) return { events: fromTask, source: 'audit_task' };
  return { events: [], source: 'none' };
}

export function fanoutState(input: {
  events: readonly SearchEvent[];
  searchUsed: boolean;
  searchQueryCount: number;
  providerMetadata: unknown;
}): { queryTextAvailable: boolean; state: FanoutState } {
  if (input.events.some((event) => event.query.trim())) {
    return { queryTextAvailable: true, state: 'queries_available' };
  }
  const availability = record(input.providerMetadata).fanout_availability;
  if (availability === 'unavailable' || availability === 'no_exposed_queries') {
    return { queryTextAvailable: false, state: availability };
  }
  if (input.searchUsed || input.searchQueryCount > 0) {
    return { queryTextAvailable: false, state: 'count_only' };
  }
  return { queryTextAvailable: false, state: 'no_search' };
}

export function fanoutProjection(input: {
  artifactEvents: unknown;
  taskEvents: unknown;
  searchUsed: boolean;
  searchQueryCount: number;
  providerMetadata: unknown;
}) {
  const { events, source } = selectEvents(input.artifactEvents, input.taskEvents);
  return {
    fanout_state: fanoutState({ ...input, events }).state,
    fanout_queries: events.map((event) => event.query.trim()).filter(Boolean),
    fanout_event_count: events.length,
    fanout_event_source: source,
    fanout_projection_version: policy.visibility.fanout_projection_version,
  };
}
