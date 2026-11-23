import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { mutedWhenMissing, TableCell, TableRow } from '@/components/ui/table';
import { Absence, printed } from '@/components/ui/absence';
import { ICONS } from '@/lib/icons';
import { PageKindBadge } from '@/components/site-health/page-kind-badge';
import type { SiteCrawl, SiteHealthDashboard } from '@citeladder/contracts';
import { byPageKindRows } from '@/lib/site-health/page-kinds';
import {
  checksRunLabel,
  formatScore,
  measurementCaveat,
  type ChecksRun,
} from '@/lib/site-health/status';
import { formatCount, formatPercent } from '@/lib/format';
import { Section, SectionHeader, SectionTitle } from '@/components/ui/section';

function emptyState(unmeasured: boolean, rowCount: number) {
  if (rowCount > 0) return undefined;
  return {
    kind: 'empty',
    icon: ICONS.siteHealth,
    headingLevel: 3,
    heading: unmeasured ? 'No analysis yet' : 'Pages not classified yet',
  } as const;
}

export function PageKindScores({
  crawl,
  dashboard,
}: Readonly<{
  crawl: SiteCrawl | null;
  dashboard: SiteHealthDashboard | undefined;
}>) {
  const summary = dashboard?.score_summary ?? crawl?.score_summary ?? null;
  const rows = summary === null ? [] : byPageKindRows(summary.by_page_kind);

  return (
    <Section data-testid="page-kind-scores">
      <SectionHeader>
        <SectionTitle>Scores by page kind</SectionTitle>
      </SectionHeader>
      <DataTable
        label="Scores by page kind"
        columns={COLUMNS}
        state={emptyState(summary === null, rows.length)}
      >
        {rows.map((row) => (
          <TableRow key={row.page_kind}>
            <TableCell className="whitespace-nowrap">
              <PageKindBadge pageKind={row.page_kind} />
            </TableCell>
            <TableCell numeric>{formatCount(row.analyzed_count)}</TableCell>
            <TableCell numeric className={mutedWhenMissing(row.web_fundamentals_score)}>
              <MeasurementValue
                score={row.web_fundamentals_score}
                checks={row.web_fundamentals_checks}
                state={row.web_fundamentals_state}
              />
            </TableCell>
            <TableCell numeric className={mutedWhenMissing(row.aeo_readiness_score)}>
              <MeasurementValue
                score={row.aeo_readiness_score}
                checks={row.aeo_readiness_checks}
                state={row.aeo_measurement_state}
              />
            </TableCell>
            <TableCell numeric>
              {row.aeo_measurement_coverage === null ? (
                <Absence state="not_measured" />
              ) : (
                formatPercent(row.aeo_measurement_coverage)
              )}
            </TableCell>
          </TableRow>
        ))}
      </DataTable>
    </Section>
  );
}

const COLUMNS: readonly DataTableColumn[] = [
  { key: 'kind', label: 'Page kind', kind: 'identity' },
  { key: 'analyzed', label: 'Pages analyzed', kind: 'number', priority: 'low' },
  { key: 'web', label: 'Web fundamentals', kind: 'number' },
  { key: 'aeo', label: 'AEO readiness', kind: 'number' },
  { key: 'coverage', label: 'AEO checklist completion', kind: 'number', width: 'metric' },
];

function MeasurementValue({
  score,
  checks,
  state,
}: Readonly<{ score: number | null; checks: ChecksRun | null; state: string }>) {
  if (score !== null) {
    const caveat = measurementCaveat(state, checks);
    return (
      <span>
        <span>{printed(formatScore(score))}</span>
        {caveat ? <span className="sr-only">{caveat}</span> : null}
      </span>
    );
  }
  const run = checksRunLabel(checks);
  if (run) return <Absence state="not_measured" label={run} />;
  if (state === 'excluded') return <Absence state="not_applicable" label="Excluded" />;
  return <Absence state="not_measured" />;
}
