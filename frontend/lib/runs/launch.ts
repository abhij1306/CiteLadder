/**
 * Launch-dialog view-model + payload builder.
 *
 * Turns the dialog's local selection state (a prompt set, a set of logical
 * engines, and a repetition count) into the `POST /audits` body
 * (`AuditCreate`). Pure + transport-free so the payload shape is unit-testable
 * independent of the dialog component.
 */
import type { AuditLaunchRequest } from '@citeladder/contracts/audit-requests';
import type { LogicalEngine, Prompt, PromptFormLimits, PromptSet } from '@citeladder/contracts';
import { DEFAULT_REPETITIONS } from '@/lib/config/operational';

export { DEFAULT_REPETITIONS } from '@/lib/config/operational';

export type RepetitionLimits = Pick<
  PromptFormLimits,
  'audit_repetitions_min' | 'audit_repetitions_max'
>;

export type LaunchSelection = {
  projectId: string;
  promptSetId: string | null;
  promptIds?: string[];
  engines: LogicalEngine[];
  marketIds?: (string | null)[];
  repetitions: number;
  auditScope?: 'brand' | 'commerce';
};

export const PROMPT_BATCH_SIZE = 10;

export function auditablePrompts(promptSet: PromptSet | undefined): Prompt[] {
  return [...(promptSet?.prompts ?? [])]
    .filter((prompt) => prompt.enabled && prompt.status === 'active')
    .sort(
      (a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? '') || a.id.localeCompare(b.id),
    );
}

export type LaunchReadiness =
  | { kind: 'ready' }
  | { kind: 'checking' }
  | { kind: 'blocked'; reason: string };

export function launchReadiness(
  read:
    | { status: 'pending' }
    | { status: 'error' }
    | { status: 'success'; promptSets: readonly PromptSet[] },
): LaunchReadiness {
  switch (read.status) {
    case 'pending':
      return { kind: 'checking' };
    case 'error':
      return { kind: 'ready' };
    case 'success':
      return read.promptSets.some((set) => auditablePrompts(set).length > 0)
        ? { kind: 'ready' }
        : { kind: 'blocked', reason: 'Add an active prompt to launch a run.' };
    default:
      return read satisfies never;
  }
}

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

export function batchLabel(index: number, batch: Prompt[], size = PROMPT_BATCH_SIZE): string {
  const first = index * size + 1;
  return `Prompts ${first}-${first + batch.length - 1}`;
}

export function clampRepetitions(value: number, limits: RepetitionLimits): number {
  if (!Number.isFinite(value)) return DEFAULT_REPETITIONS;
  return Math.min(
    limits.audit_repetitions_max,
    Math.max(limits.audit_repetitions_min, Math.round(value)),
  );
}

export function launchBlocker(selection: LaunchSelection): string | null {
  if (!selection.promptSetId && !selection.promptIds?.length)
    return 'Choose a prompt set to launch a run.';
  if (!selection.engines.length) return 'Choose at least one engine to launch a run.';
  if (selection.marketIds?.length === 0) return 'Choose at least one market to launch a run.';
  return null;
}

function launchPrompts(selection: LaunchSelection) {
  if (selection.promptIds?.length) return { prompt_ids: [...selection.promptIds] };
  if (selection.promptSetId) return { prompt_set_id: selection.promptSetId };
  return null;
}

export function buildLaunchPayload(
  selection: LaunchSelection,
  limits: RepetitionLimits,
): AuditLaunchRequest {
  const prompts = launchPrompts(selection);
  if (!prompts || launchBlocker(selection) !== null) {
    throw new Error('Cannot build a launch payload from an incomplete selection.');
  }
  return {
    project_id: selection.projectId,
    ...prompts,
    engines: [...selection.engines],
    ...(selection.marketIds ? { market_ids: [...selection.marketIds] } : {}),
    repetitions: clampRepetitions(selection.repetitions, limits),
    audit_scope: selection.auditScope ?? 'brand',
  };
}

export function toggleMarket(markets: (string | null)[], market: string | null): (string | null)[] {
  return markets.includes(market) ? markets.filter((id) => id !== market) : [...markets, market];
}

export function toggleEngine(engines: LogicalEngine[], engine: LogicalEngine): LogicalEngine[] {
  return engines.includes(engine) ? engines.filter((e) => e !== engine) : [...engines, engine];
}
