/**
 * Search-row projections for the Searches tab.
 *
 * The tab reads as one table under a "Group by" control, so every grouping has
 * to produce the SAME row shape. These fold the loaded execution window into
 * that shape without recomputing anything: a row's occurrence count is how many
 * times the loaded window observed that exact query string, never an estimate
 * of how often the engine ran it.
 */
import type { VisibilityExecutionEvidence } from '@/lib/api/types';
import { groupByPrompt, queryTexts } from '@/lib/visibility/evidence';

/** The `search` bound the fanout endpoint declares (`Query(max_length=512)`). */
export const SEARCH_MAX_LENGTH = 512;

/**
 * The one search value every consumer uses.
 *
 * The table filters in the browser and the totals are counted by the server,
 * and they must be asking the same question. A value past the endpoint's
 * declared bound is rejected as a 422 before it can match anything, so it was
 * truncated on the way to the server only — leaving the table filtering by the
 * full typed string while the server answered about a shorter one, and the
 * "matches elsewhere" note describing a search nobody ran. Normalized ONCE,
 * here, so there is no second spelling to drift from.
 */
export function normalizeSearch(value: string | null): string {
  return (value ?? '').trim().slice(0, SEARCH_MAX_LENGTH);
}

/** One search string, and what was observed running it. */
type SearchRow = {
  query: string;
  /** Logical engines observed running this query, in catalog encounter order. */
  engines: string[];
  /** Times the loaded window observed this exact query. */
  occurrences: number;
};

/** A named set of search rows: one prompt, one topic, or the whole window. */
export type SearchGroup = {
  key: string;
  /** The group heading, or `null` for the ungrouped list. */
  label: string | null;
  rows: SearchRow[];
  /**
   * Executions in this group that ran a search whose wording the model did not
   * expose, or ran none at all. Counted rather than dropped: a group with rows
   * for two of its five answers must not read as though the other three were
   * silent.
   */
  undisclosed: number;
  silent: number;
  unavailable: number;
  noExposedQueries: number;
};

type StateCounts = Pick<SearchGroup, 'undisclosed' | 'silent' | 'unavailable' | 'noExposedQueries'>;

function tallyState(counts: StateCounts, state: VisibilityExecutionEvidence['state']): void {
  if (state === 'count_only') counts.undisclosed += 1;
  if (state === 'no_search') counts.silent += 1;
  if (state === 'unavailable') counts.unavailable += 1;
  if (state === 'no_exposed_queries') counts.noExposedQueries += 1;
}

function addQuery(
  rows: Map<string, SearchRow>,
  query: string,
  engine: VisibilityExecutionEvidence['logical_engine'],
): void {
  const row = rows.get(query);
  if (!row) {
    rows.set(query, { query, engines: engine ? [engine] : [], occurrences: 1 });
    return;
  }
  row.occurrences += 1;
  if (engine && !row.engines.includes(engine)) row.engines.push(engine);
}

function foldRows(executions: readonly VisibilityExecutionEvidence[]): SearchGroup {
  const rows = new Map<string, SearchRow>();
  const counts = { undisclosed: 0, silent: 0, unavailable: 0, noExposedQueries: 0 };
  for (const execution of executions) {
    tallyState(counts, execution.state);
    for (const query of queryTexts(execution)) addQuery(rows, query, execution.logical_engine);
  }
  return {
    key: '',
    label: null,
    // Most-run first; ties keep a stable alphabetical order so the table does
    // not reshuffle between renders of the same data.
    rows: [...rows.values()].sort(
      (a, b) => b.occurrences - a.occurrences || a.query.localeCompare(b.query),
    ),
    ...counts,
  };
}

/** Every observed search in the window, as one ungrouped list. */
export function searchRows(items: readonly VisibilityExecutionEvidence[]): SearchGroup[] {
  return [{ ...foldRows(items), key: 'all', label: null }];
}

/** One group per frozen prompt, in the order the window first mentions it. */
export function searchRowsByPrompt(items: readonly VisibilityExecutionEvidence[]): SearchGroup[] {
  return groupByPrompt(items).map((group) => ({
    ...foldRows(group.executions),
    key: group.promptSnapshotId,
    label: group.promptText,
  }));
}

/**
 * One group per topic.
 *
 * Evidence rows carry no topic of their own, so the caller supplies the
 * prompt-to-topic map the prompt metrics already publish. A prompt the map does
 * not cover is grouped as unclassified rather than silently dropped.
 */
export function searchRowsByTopic(
  items: readonly VisibilityExecutionEvidence[],
  topicOf: ReadonlyMap<string, string>,
): SearchGroup[] {
  const order: string[] = [];
  const buckets = new Map<string, VisibilityExecutionEvidence[]>();
  for (const item of items) {
    const topic =
      topicOf.get(item.prompt_id ?? '') ?? topicOf.get(item.prompt_snapshot_id) ?? 'Unclassified';
    const bucket = buckets.get(topic);
    if (bucket) {
      bucket.push(item);
    } else {
      buckets.set(topic, [item]);
      order.push(topic);
    }
  }
  order.sort((a, b) => a.localeCompare(b));
  return order.map((topic) => ({
    ...foldRows(buckets.get(topic)!),
    key: topic,
    label: topic,
  }));
}
