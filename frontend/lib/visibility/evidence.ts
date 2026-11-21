/**
 * Execution-evidence display helpers (Query fanouts + the Sources drill-downs).
 *
 * Pure, framework-free projections over the loaded
 * `VisibilityExecutionEvidence[]` window. The endpoint is the single source of
 * truth: nothing here recomputes a metric, infers a mention/query, or claims a
 * global total the bounded newest-window cannot support.
 */
import type { VisibilityExecutionEvidence } from '@citeladder/contracts';

export type PromptGroup = {
  promptSnapshotId: string;
  promptId: string | null;
  promptText: string;
  executions: VisibilityExecutionEvidence[];
};

export function groupByPrompt(items: readonly VisibilityExecutionEvidence[]): PromptGroup[] {
  const groups = new Map<string, PromptGroup>();
  for (const item of items) {
    const key = item.prompt_snapshot_id;
    let group = groups.get(key);
    if (!group) {
      group = {
        promptSnapshotId: key,
        promptId: item.prompt_id,
        promptText: item.prompt_text || 'Untitled prompt',
        executions: [],
      };
      groups.set(key, group);
    }
    group.executions.push(item);
  }
  return [...groups.values()];
}

export function queryTexts(item: VisibilityExecutionEvidence): string[] {
  const queries: string[] = [];
  for (const event of item.search_events) {
    const query = event.query.trim();
    if (query) queries.push(query);
  }
  return queries;
}
