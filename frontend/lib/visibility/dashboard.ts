/**
 * Visibility dashboard helpers.
 *
 * Pure, framework-free helpers the dashboard uses to pick the default run,
 * format the projection for display, and apply the client-side engine filter.
 * The `/projects/{id}/visibility` endpoint is a selected-run projection
 * keyed only by `audit_id`; the engine filter is a client-side display filter
 * that also participates in the React Query key. There is NO per-prompt-type
 * (branded / non-branded) breakdown in `VisibilityResponse` yet, so no such
 * control is offered.
 */
import { ENGINE_ORDER } from '@/lib/providers/catalog';
import { availabilityLabel, formatDisplayTimestamp } from '@/lib/format';
import { shouldPollAudit } from '@/lib/runs/status';
import type {
  AuditStatus,
  LogicalEngine,
  RankingRow,
  Visibility,
  VisibilityEngine,
} from '@/lib/api/types';

/** Audit statuses that carry a dashboard-ready metric snapshot. */
const DASHBOARD_STATUSES: ReadonlySet<AuditStatus> = new Set<AuditStatus>([
  'completed',
  'partially_completed',
]);

/**
 * The Visibility workspace tabs, in display order. `trends` is the default.
 *   - trends:       cross-run metrics + charts + ranking movement
 *   - sources:      the domains and URLs AI answers retrieved and cited
 *   - perception:   how answers portray the brand and competitors (sentiment)
 *   - accuracy:     the brand's factual claims checked against its confirmed
 *                   facts (fact-checking pilot workspaces only)
 *   - ads:          paid ads shown in ChatGPT Search answers, apart from sources
 *   - query-fanout: frozen prompts + generated search-query evidence
 *
 * Every tab reads the selected measurement, so the run / engine / prompt /
 * period controls apply throughout and there is no per-tab exception.
 */
export type VisibilityTab =
  | 'trends'
  | 'sources'
  | 'perception'
  | 'accuracy'
  | 'ads'
  | 'query-fanout';

/** The ordered tab definitions (id + human label) rendered by the tablist. */
export const VISIBILITY_TABS: readonly { id: VisibilityTab; label: string }[] = [
  // NOTE: `id` is the persisted `?tab=` URL value — only labels are restyled.
  { id: 'trends', label: 'Trends' },
  { id: 'sources', label: 'Sources' },
  { id: 'perception', label: 'Perception' },
  { id: 'accuracy', label: 'Accuracy' },
  { id: 'ads', label: 'Ads' },
  { id: 'query-fanout', label: 'Query fanouts' },
] as const;

/** The tabs a workspace sees: Accuracy only inside the fact-checking pilot. */
export function visibleTabs(factChecking: boolean) {
  return VISIBILITY_TABS.filter((tab) => factChecking || tab.id !== 'accuracy');
}

/** The tabs backed by the shared execution-evidence query + cache key. */
export function isEvidenceTab(tab: VisibilityTab): boolean {
  return tab === 'query-fanout';
}

/** Filters that drive the visibility query key + client-side display. */
export type VisibilityFilters = {
  /** `'all'` shows every engine; otherwise narrows the per-engine comparison. */
  engine: LogicalEngine | 'all';
};

/** A run option for the selector, ordered latest-first. */
export type RunOption = {
  id: string;
  status: AuditStatus;
  label: string;
  completedAt: string | null;
};

/** Is this a status the dashboard projection can be built from? */
export function isDashboardStatus(status: AuditStatus): boolean {
  return DASHBOARD_STATUSES.has(status);
}

/**
 * Build the run-selector options from the project's audits: keep only
 * dashboard-ready runs, newest first (by completed-at, then created-at) —
 * mirroring the backend's default-run resolution so the first option is the
 * one the endpoint defaults to when `audit_id` is omitted.
 */
export function toRunOptions(
  audits: ReadonlyArray<{
    id: string;
    status: AuditStatus;
    completed_at: string | null;
    created_at: string;
  }>,
  timeZone = 'UTC',
): RunOption[] {
  return audits
    .filter((audit) => isDashboardStatus(audit.status))
    .slice()
    .sort((a, b) => {
      const aKey = a.completed_at ?? a.created_at;
      const bKey = b.completed_at ?? b.created_at;
      return bKey.localeCompare(aKey);
    })
    .map((audit) => ({
      id: audit.id,
      status: audit.status,
      completedAt: audit.completed_at,
      label: formatDisplayTimestamp(audit.completed_at ?? audit.created_at, timeZone),
    }));
}

/** A run that is still progressing (queued/running/analyzing/…). */
export type ActiveRun = {
  id: string;
  status: AuditStatus;
  createdAt: string;
};

/**
 * The newest run that is still progressing, if any. A run that is active is
 * NOT dashboard-ready (its metric snapshot doesn't exist yet), so it never
 * appears in `toRunOptions` — this is the companion signal the dashboard uses
 * to say "a run is in progress" (and to keep polling the audits list) instead
 * of silently showing stale data or a bare empty state.
 */
export function findActiveRun(
  audits: ReadonlyArray<{ id: string; status: AuditStatus; created_at: string }>,
): ActiveRun | null {
  const active = audits
    .filter((audit) => shouldPollAudit(audit.status))
    .slice()
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const newest = active[0];
  return newest ? { id: newest.id, status: newest.status, createdAt: newest.created_at } : null;
}

export { engineLabel } from '@/lib/providers/catalog';

/**
 * Per-engine comparison rows for display: apply the engine filter, then order
 * by the canonical engine order so cards are stable across runs.
 */
export function visibleEngines(
  visibility: Visibility,
  filter: VisibilityFilters['engine'],
): VisibilityEngine[] {
  const rows =
    filter === 'all'
      ? visibility.per_engine
      : visibility.per_engine.filter((engine) => engine.logical_engine === filter);
  const order = new Map(ENGINE_ORDER.map((engine, index) => [engine as string, index]));
  return rows.slice().sort((a, b) => {
    const ai = order.get(a.logical_engine) ?? Number.MAX_SAFE_INTEGER;
    const bi = order.get(b.logical_engine) ?? Number.MAX_SAFE_INTEGER;
    return ai - bi || a.logical_engine.localeCompare(b.logical_engine);
  });
}

/** Engines actually present in a projection (for the engine-filter options). */
export function presentEngines(visibility: Visibility | undefined): LogicalEngine[] {
  if (!visibility) return [];
  const present = new Set(visibility.per_engine.map((engine) => engine.logical_engine));
  return ENGINE_ORDER.filter((engine) => present.has(engine));
}

/** Format a 0–1 rate as a whole-percent string, or the placeholder. */
export function formatRate(rate: number | null): string {
  if (rate === null || Number.isNaN(rate)) return PLACEHOLDER;
  return `${Math.round(rate * 100)}%`;
}

/**
 * Format a value that is ALREADY a percentage, or the placeholder.
 *
 * `formatRate` takes a 0–1 rate and scales it. The trend series is built in
 * whole percent, so passing its points through `formatRate` multiplied them a
 * second time and labelled a 38% point "3800%". Named apart from
 * `formatPercent` in `lib/format`, which takes a 0–1 fraction: the two shared a
 * name and signature, so an auto-import of the wrong one type-checked.
 */
export function formatWholePercent(value: number | null): string {
  if (value === null || Number.isNaN(value)) return PLACEHOLDER;
  return `${Math.round(value)}%`;
}

/** Format a 0–100 score as a whole number, or the placeholder. */
export { formatScore } from '@/lib/format';

/**
 * A rank, rendered as a rank.
 *
 * The underlying value is a mean over the answers that named the brand, so it
 * genuinely carries a fraction — but `#1.2` reads as a broken ordinal, not as
 * an average, and a reader cannot be anywhere other than a whole place in a
 * list. The whole number is what the cell shows; `formatPositionExact` keeps
 * the fraction for the tooltip, so the ordering that separates two brands
 * rounding to the same place is still there to read.
 */
export function formatPosition(position: number | null): string {
  if (position === null || Number.isNaN(position)) return PLACEHOLDER;
  return `#${Math.max(1, Math.round(position))}`;
}

/** The unrounded mean, for the title/description that explains the rank. */
export function formatPositionExact(position: number | null): string {
  if (position === null || Number.isNaN(position)) return PLACEHOLDER;
  return position.toFixed(1);
}

/** The not-measured placeholder for an absent average position. */
export const PLACEHOLDER = availabilityLabel('not_measured');

/**
 * A formatted value, or `null` where the formatter had nothing to format.
 *
 * The formatters answer in WORDS, and the COMPONENT that renders them decides
 * to draw the shared mark instead — `UnavailableValue` and `MetricValue` both
 * do, pairing it with those words as its accessible name. Keeping the mark out
 * of the string is what makes that possible: a bare dash in a formatter's
 * output reaches the screen with nothing to announce it.
 */
export { measured } from '@/lib/format';

/**
 * A prompt option for the Query Fanout evidence prompt selector. This is
 * EVIDENCE filtering (restrict by `AuditPromptSnapshot.prompt_id`), NOT the
 * Overview prompt-type taxonomy affordance — it never claims prompt-type
 * semantics. A deleted source prompt has a null `prompt_id` and cannot be
 * selected by a current id, so it is offered only under "All prompts".
 */
export type PromptOption = {
  /** The source prompt id; only selectable options carry a non-null id. */
  id: string;
  /** The frozen prompt text (display label). */
  label: string;
};

/** Rankings already arrive sorted by SOV desc from the API; keep that order stable. */
export function sortedRankings(rankings: readonly RankingRow[]): RankingRow[] {
  return rankings
    .slice()
    .sort(
      (a, b) => (b.share_of_voice ?? 0) - (a.share_of_voice ?? 0) || a.name.localeCompare(b.name),
    );
}
