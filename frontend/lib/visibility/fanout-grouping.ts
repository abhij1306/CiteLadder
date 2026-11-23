import type { VisibilityExecutionEvidence } from '@citeladder/contracts';
import { groupByPrompt, queryTexts } from '@/lib/visibility/evidence';

export const SEARCH_MAX_LENGTH = 512;

export function normalizeSearch(value: string | null): string {
  return (value ?? '').trim().slice(0, SEARCH_MAX_LENGTH);
}

type SearchRow = {
  query: string;
  engines: string[];
  occurrences: number;
};

export type SearchGroup = {
  key: string;
  label: string | null;
  rows: SearchRow[];
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
    rows: [...rows.values()].sort(
      (a, b) => b.occurrences - a.occurrences || a.query.localeCompare(b.query),
    ),
    ...counts,
  };
}

export function searchRows(items: readonly VisibilityExecutionEvidence[]): SearchGroup[] {
  return [{ ...foldRows(items), key: 'all', label: null }];
}

export function searchRowsByPrompt(items: readonly VisibilityExecutionEvidence[]): SearchGroup[] {
  return groupByPrompt(items).map((group) => ({
    ...foldRows(group.executions),
    key: group.promptSnapshotId,
    label: group.promptText,
  }));
}

export function searchRowsByTopic(
  items: readonly VisibilityExecutionEvidence[],
  topicOf: ReadonlyMap<string, string>,
): SearchGroup[] {
  const buckets = new Map<string, VisibilityExecutionEvidence[]>();
  for (const item of items) {
    const topic =
      topicOf.get(item.prompt_id ?? '') ?? topicOf.get(item.prompt_snapshot_id) ?? 'Unclassified';
    const bucket = buckets.get(topic);
    if (bucket) bucket.push(item);
    else buckets.set(topic, [item]);
  }
  return [...buckets]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([topic, rows]) => ({
      ...foldRows(rows),
      key: topic,
      label: topic,
    }));
}
