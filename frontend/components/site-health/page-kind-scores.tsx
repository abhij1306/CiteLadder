'use client';

import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { mutedWhenMissing, TableCell, TableRow } from '@/components/ui/table';
import { UnavailableValue } from '@/components/ui/unavailable-value';
import { ICONS } from '@/lib/icons';
import { PageKindBadge } from '@/components/site-health/page-kind-badge';
import type { SiteCrawl, SiteHealthDashboard } from '@citeladder/contracts';
import { byPageKindRows } from '@/lib/site-health/page-kinds';
import { formatScore, measurementCaveat } from '@/lib/site-health/status';

/**
 * Dashboard per-page-kind score breakdown.
 * Renders `score_summary.by_page_kind` — one row per observed page-kind
 * bucket with its analyzed count and mean Web Fundamentals and AEO scores.
 * The panel is data-driven and follows the same dashboard-then-crawl fallback
 * as the score cards. Classification completeness and the exact scored cohort
 * come from their own persisted fields. An `other` bucket can be scored by
 * independently applicable checks even though classification abstained.
 * Missing means render `Not measured`, never a fabricated zero.
 *
 * READ-ONLY by design. This used to expand each row into an accordion holding
 * its own paginated URL list, checkboxes, and a "Re-analyze selected" button —
 * a page-selection UI nested inside a table cell. The canonical inventory is
 * the only URL surface; re-auditing one page belongs on its detail screen.
 */
/**
 * No summary yet (nothing analysed) and a summary with no classified page
 * kinds are different states, so they say different things.
 */
function emptyState(unmeasured: boolean, rowCount: number) {
  if (rowCount > 0) return undefined;
  return {
    kind: 'empty',
    icon: ICONS.siteHealth,
    headingLevel: 3,
    heading: unmeasured
      ? 'Scores by page kind appear after the first analysis'
      : 'Per-page-kind scores appear once the analysis classifies your pages',
  } as const;
}

export function PageKindScores({
  crawl,
  dashboard,
}: Readonly<{
  crawl: SiteCrawl | null;
  dashboard: SiteHealthDashboard | undefined;
}>) {
  // The section keeps its place with no summary yet: it draws its own empty
  // state instead of vanishing and pulling the sections below it up.
  const summary = dashboard?.score_summary ?? crawl?.score_summary ?? null;
  const rows = summary === null ? [] : byPageKindRows(summary.by_page_kind);

  return (
    <div data-testid="page-kind-scores" className="grid min-w-0">
      <DataTable
        title="Scores by Page Kind"
        columns={COLUMNS}
        minWidth="md"
        footer="Mean scores across the analyzed pages of each type."
        state={emptyState(summary === null, rows.length)}
      >
        {rows.map((row) => (
          <TableRow key={row.page_kind}>
            <TableCell className="whitespace-nowrap">
              <PageKindBadge pageKind={row.page_kind} />
            </TableCell>
            <TableCell numeric className="text-ink-secondary">
              {row.analyzed_count}
            </TableCell>
            <TableCell numeric className={mutedWhenMissing(row.web_fundamentals_score)}>
              <MeasurementValue
                score={row.web_fundamentals_score}
                coverage={row.web_fundamentals_coverage}
                state={row.web_fundamentals_state}
              />
            </TableCell>
            <TableCell numeric className={mutedWhenMissing(row.aeo_readiness_score)}>
              <MeasurementValue
                score={row.aeo_readiness_score}
                coverage={row.aeo_measurement_coverage}
                state={row.aeo_measurement_state}
              />
            </TableCell>
            <TableCell numeric>
              {row.aeo_measurement_coverage === null ? (
                <UnavailableValue state="not_measured" />
              ) : (
                `${Math.round(row.aeo_measurement_coverage * 100)}%`
              )}
            </TableCell>
          </TableRow>
        ))}
      </DataTable>
    </div>
  );
}

const COLUMNS: readonly DataTableColumn[] = [
  { key: 'kind', label: 'Page Kind' },
  { key: 'analyzed', label: 'Analyzed', width: 'figure', numeric: true },
  { key: 'web', label: 'Web Fundamentals', width: 'date', numeric: true },
  { key: 'aeo', label: 'AEO Readiness', width: 'status', numeric: true },
  { key: 'coverage', label: 'AEO Coverage', width: 'status', numeric: true },
];

function MeasurementValue({
  score,
  coverage,
  state,
}: Readonly<{ score: number | null; coverage: number | null; state: string }>) {
  if (score !== null) {
    // Keep measurement qualifications accessible without a repeated caption row.
    const caveat = measurementCaveat(state, coverage);
    return (
      <span>
        <span>{formatScore(score)}</span>
        {caveat ? <span className="sr-only">{caveat}</span> : null}
      </span>
    );
  }
  if (state === 'limited_evidence') return 'Limited evidence';
  if (state === 'excluded') return 'Excluded';
  return <UnavailableValue state="not_measured" />;
}
