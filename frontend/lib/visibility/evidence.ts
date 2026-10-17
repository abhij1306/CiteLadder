/**
 * Execution-evidence display helpers (Query fanouts + the Sources drill-downs).
 *
 * Pure, framework-free projections over the loaded
 * `VisibilityExecutionEvidence[]` window. The endpoint is the single source of
 * truth: nothing here recomputes a metric, infers a mention/query, or claims a
 * global total the bounded newest-window cannot support.
 */
import type { VisibilityExecutionEvidence } from '@/lib/api/types';

/** A group of executions that share one frozen prompt, for presentation only. */
export type PromptGroup = {
  /** The grouping key: the frozen prompt snapshot id (stable, always unique). */
  promptSnapshotId: string;
  /** The nullable source prompt id (null once the source prompt is deleted). */
  promptId: string | null;
  /** The frozen prompt text (the group heading). */
  promptText: string;
  /** The executions in this group, kept in the endpoint's newest-first order. */
  executions: VisibilityExecutionEvidence[];
};

/**
 * CLIENT-group the loaded per-execution items by their frozen prompt, for
 * presentation only. Grouping key is `prompt_snapshot_id` so executions that
 * froze the SAME prompt text but differ (deleted vs live source prompt) stay
 * distinct. Group order follows first appearance in the (newest-first) window;
 * execution order inside a group is preserved. This never claims a global
 * prompt total or an average over the truncated window.
 */
export function groupByPrompt(items: readonly VisibilityExecutionEvidence[]): PromptGroup[] {
  const order: string[] = [];
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
      order.push(key);
    }
    group.executions.push(item);
  }
  return order.map((key) => groups.get(key)!);
}

/**
 * Every non-blank search-query string for one execution, in provider order.
 *
 * One event in, one string out: a query the engine ran three times while
 * answering one prompt yields three strings. This used to de-duplicate within
 * the execution, which silently turned "how many searches did the engine run"
 * into "how many distinct phrases did it use" — every repeat was dropped before
 * anything could count it, so the fanout tab's occurrence column could never
 * read anything but 1 for a single-execution query. Repeats are a real signal
 * about how hard an engine worked a prompt; de-duplication, where a view wants
 * it, belongs to that view and not to the capture path.
 *
 * Blank queries are still skipped: a count-only event (the provider ran a
 * search but withheld the wording) is not a query string, and the fanout tab
 * reports those separately as `undisclosed`.
 */
export function queryTexts(item: VisibilityExecutionEvidence): string[] {
  const queries: string[] = [];
  for (const event of item.search_events) {
    const query = event.query.trim();
    if (query) queries.push(query);
  }
  return queries;
}
