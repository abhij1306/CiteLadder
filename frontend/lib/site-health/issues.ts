/**
 * Site Health issue presentation helpers (Slice 8) — PURE.
 *
 * Maps the backend issue projection (severity, dimension, rule label) onto the
 * design-system badge families and display copy used by the grouped Issues
 * catalog (mockup 710) and the per-URL detail (mockup 711). No transport, no
 * React — screens render these view-models directly.
 *
 * Product rules encoded here:
 *   - severity → the existing status-badge palette (high=danger, medium=warning,
 *     low/info=info) so the catalog never invents a new colour system;
 *   - the catalog title is the API's CURRENT display label, which already falls
 *     back to the raw `rule_id` when the rule is unknown — the frontend applies
 *     the same fallback defensively for a blank title;
 *   - severity summary tiles read the API-owned `severity_counts` map with a
 *     stable order (high → medium → low), never a client re-count.
 */
import type { IssueSeverity, IssueDimension } from '@/lib/api/types';
import type { StatusValue } from '@/components/ui/badge-variants';

/** Map an issue severity onto a status-badge value (shared palette). */
export function severityBadgeValue(severity: IssueSeverity): StatusValue {
  switch (severity) {
    case 'critical':
    case 'high':
      return 'danger';
    case 'medium':
      return 'warning';
    default:
      // low / info
      return 'info';
  }
}

/** Short uppercase severity label for a badge (HIGH / MEDIUM / LOW / …).
 *
 * The catalog exposes a three-tier vocabulary: `critical` folds into HIGH so
 * badges, chips, and filters all agree (no separate "CRITICAL" tier in the UI).
 */
export function severityLabel(severity: IssueSeverity): string {
  return severity === 'critical' ? 'HIGH' : severity.toUpperCase();
}

/** Severity ordering rank (lower = more severe) for client-side sorting. */
const SEVERITY_RANK: Record<IssueSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

/** Rank for ordering issues by severity (most severe first). */
export function severityRank(severity: IssueSeverity): number {
  return SEVERITY_RANK[severity] ?? 99;
}

/** Short uppercase dimension label for a badge (WEB FUNDAMENTALS / AEO). */
export function dimensionLabel(dimension: IssueDimension): string {
  return dimension === 'aeo' ? 'AEO' : 'WEB FUNDAMENTALS';
}

/**
 * The display title for an issue group / row. The backend already resolves the
 * current rule label (falling back to the raw `rule_id`), but a defensive blank
 * title also falls back to `rule_id` so a row never renders empty.
 */
export function issueTitle(issue: { title: string; rule_id: string }): string {
  const title = issue.title.trim();
  return title.length > 0 ? title : issue.rule_id;
}

/**
 * Read one severity's group count from the API-owned `severity_counts` map.
 * `critical` folds into `high` so the tiles match the three-tier catalog UI;
 * a missing key is 0 (never a fabricated total).
 */
export function severityCount(counts: Record<string, number>, severity: IssueSeverity): number {
  if (severity === 'high') {
    return (counts.high ?? 0) + (counts.critical ?? 0);
  }
  return counts[severity] ?? 0;
}
