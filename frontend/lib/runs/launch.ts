/**
 * Launch-dialog view-model + payload builder.
 *
 * Turns the dialog's local selection state (a prompt set, a set of logical
 * engines, and a repetition count) into the `POST /audits` body
 * (`AuditCreate`). Pure + transport-free so the payload shape is unit-testable
 * independent of the dialog component.
 */
import type { LaunchAuditInput } from '@/lib/api/runs';
import type { LogicalEngine, Prompt, PromptSet } from '@/lib/api/types';
import { DEFAULT_REPETITIONS, MAX_REPETITIONS, MIN_REPETITIONS } from '@/lib/config/operational';

export { DEFAULT_REPETITIONS, MAX_REPETITIONS, MIN_REPETITIONS } from '@/lib/config/operational';

/** The dialog's local, still-being-edited selection. */
export type LaunchSelection = {
  projectId: string;
  promptSetId: string | null;
  promptIds?: string[];
  engines: LogicalEngine[];
  /** One run per market; `null` is the project default. Omitted measures the default only. */
  marketIds?: (string | null)[];
  repetitions: number;
  auditScope?: 'brand' | 'commerce';
};

/**
 * How many prompts one audit batch runs.
 *
 * A full portfolio is more than most people want to pay for or wait on in one
 * go, and the launch screen used to offer no choice: picking a prompt set ran
 * every prompt in it. Ten is a batch you can read the results of.
 */
export const PROMPT_BATCH_SIZE = 10;

/**
 * A prompt set's audit-eligible prompts, in the order the backend runs them.
 *
 * Mirrors the API's audit prompt resolution: active and
 * enabled only, ordered by creation. The order matters — batch 2 has to mean
 * the same ten prompts here as it does there, or "Prompts 11-20" would run an
 * arbitrary slice.
 */
export function auditablePrompts(promptSet: PromptSet | undefined): Prompt[] {
  return [...(promptSet?.prompts ?? [])]
    .filter((prompt) => prompt.enabled && prompt.status === 'active')
    .sort(
      (a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? '') || a.id.localeCompare(b.id),
    );
}

/** Split audit-eligible prompts into fixed-size batches. */
export function promptBatches(prompts: Prompt[], size = PROMPT_BATCH_SIZE): Prompt[][] {
  if (!Number.isInteger(size) || size <= 0) {
    throw new RangeError('Prompt batch size must be a positive integer.');
  }
  const batches: Prompt[][] = [];
  for (let start = 0; start < prompts.length; start += size) {
    batches.push(prompts.slice(start, start + size));
  }
  return batches;
}

/** "Prompts 1-10" — 1-indexed and inclusive, the way the list reads on screen. */
export function batchLabel(index: number, batch: Prompt[], size = PROMPT_BATCH_SIZE): string {
  const first = index * size + 1;
  return `Prompts ${first}-${first + batch.length - 1}`;
}

/** Clamp a repetition count into the backend-accepted range. */
export function clampRepetitions(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_REPETITIONS;
  return Math.min(MAX_REPETITIONS, Math.max(MIN_REPETITIONS, Math.round(value)));
}

/**
 * True when the selection is launchable: a prompt set is chosen and at least one
 * engine is selected. (The backend also requires a configured provider route per
 * engine; the dialog only offers configured engines.)
 */
export function canLaunch(selection: LaunchSelection): boolean {
  return (
    Boolean(selection.promptSetId || selection.promptIds?.length) &&
    selection.engines.length > 0 &&
    selection.marketIds?.length !== 0
  );
}

/**
 * Build the `POST /audits` payload from a launchable selection. Throws if the
 * selection is not launchable — callers gate on `canLaunch` first.
 */
export function buildLaunchPayload(selection: LaunchSelection): LaunchAuditInput {
  if (!canLaunch(selection)) {
    throw new Error('Cannot build a launch payload from an incomplete selection.');
  }
  return {
    project_id: selection.projectId,
    ...(selection.promptIds?.length
      ? { prompt_ids: [...selection.promptIds] }
      : { prompt_set_id: selection.promptSetId! }),
    engines: [...selection.engines],
    ...(selection.marketIds ? { market_ids: [...selection.marketIds] } : {}),
    repetitions: clampRepetitions(selection.repetitions),
    audit_scope: selection.auditScope ?? 'brand',
  };
}

/** Toggle a market in/out of the current selection (immutably); `null` is the default market. */
export function toggleMarket(markets: (string | null)[], market: string | null): (string | null)[] {
  return markets.includes(market) ? markets.filter((id) => id !== market) : [...markets, market];
}

/** Toggle a logical engine in/out of the current selection (immutably). */
export function toggleEngine(engines: LogicalEngine[], engine: LogicalEngine): LogicalEngine[] {
  return engines.includes(engine) ? engines.filter((e) => e !== engine) : [...engines, engine];
}
