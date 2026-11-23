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
import {
  absent,
  formatMean,
  formatPercent,
  formatDisplayTimestamp,
  type Formatted,
} from '@/lib/format';
import { AUDIT_STATES } from '@/lib/runs/status';
import type {
  RankingRow,
  AuditStatus,
  LogicalEngine,
  Visibility,
  VisibilityEngine,
} from '@citeladder/contracts';
import type { VisibilityTab } from './tabs';

/** Audit statuses that carry a dashboard-ready metric snapshot. */
const DASHBOARD_STATUSES: ReadonlySet<AuditStatus> = new Set<AuditStatus>([
  'completed',
  'partially_completed',
]);

export { VISIBILITY_TABS, type VisibilityTab } from './tabs';

export type SourceTab = Extract<VisibilityTab, 'domains' | 'urls' | 'read-not-cited'>;

export type VisibilityView =
  | VisibilityTab
  | 'insights'
  | 'competitors'
  | 'competitor'
  | 'perception';

export function isEvidenceTab(tab: VisibilityView): boolean {
  return tab === 'query-fanout';
}

export type VisibilityFilters = {
  engine: LogicalEngine | 'all';
};

export type RunOption = {
  id: string;
  status: AuditStatus;
  label: string;
  completedAt: string | null;
};

export function isDashboardStatus(status: AuditStatus): boolean {
  return DASHBOARD_STATUSES.has(status);
}

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

export function brandRuns<T extends { audit_scope: string }>(
  audits: readonly T[] | undefined,
): T[] {
  return (audits ?? []).filter((audit) => audit.audit_scope === 'brand');
}

export type ActiveRun = {
  id: string;
  status: AuditStatus;
  createdAt: string;
};

export function findActiveRun(
  audits: ReadonlyArray<{ id: string; status: AuditStatus; created_at: string }>,
): ActiveRun | null {
  const active = audits
    .filter((audit) => AUDIT_STATES[audit.status].active)
    .slice()
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const newest = active[0];
  return newest ? { id: newest.id, status: newest.status, createdAt: newest.created_at } : null;
}

export function visibleEngines(
  visibility: Visibility,
  filter: VisibilityFilters['engine'],
  engineOrder: readonly string[],
): VisibilityEngine[] {
  const rows =
    filter === 'all'
      ? visibility.per_engine
      : visibility.per_engine.filter((engine) => engine.logical_engine === filter);
  const order = new Map(engineOrder.map((engine, index) => [engine, index]));
  return rows.slice().sort((a, b) => {
    const ai = order.get(a.logical_engine) ?? Number.MAX_SAFE_INTEGER;
    const bi = order.get(b.logical_engine) ?? Number.MAX_SAFE_INTEGER;
    return ai - bi || a.logical_engine.localeCompare(b.logical_engine);
  });
}

export function formatRate(rate: number | null): Formatted {
  if (rate === null || Number.isNaN(rate)) return absent();
  return formatPercent(rate);
}

export function formatWholePercent(value: number | null): Formatted {
  if (value === null || Number.isNaN(value)) return absent();
  return `${Math.round(value)}%`;
}

export { formatScore } from '@/lib/format';

export function formatRank(rank: number | null): Formatted {
  if (rank === null || Number.isNaN(rank)) return absent();
  return `#${Math.max(1, Math.round(rank))}`;
}

export function formatPositionExact(position: number | null): Formatted {
  if (position === null || Number.isNaN(position)) return absent();
  return formatMean(position);
}

export type PromptOption = {
  id: string;
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
