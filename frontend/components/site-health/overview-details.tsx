import { useState } from 'react';
import { ProjectLink } from '@/components/ui/project-link';

import { CohortCompositionContext } from './cohort-composition-context';
import { AppGrid } from '@/components/ui/app-grid';
import { StatusMark } from '@/components/ui/status-mark';
import { Tag } from '@/components/ui/tag';
import { ActionButton } from '@/components/ui/actions';
import { Button } from '@/components/ui/button';
import { Delta } from '@/components/ui/delta';
import { Drawer } from '@/components/ui/drawer';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { ClampText } from '@/components/ui/clamp-text';
import { TableCell, TableCellLines, TableRow } from '@/components/ui/table';
import { AreaChart } from '@/components/ui/area-chart';
import { TextLink } from '@/components/ui/text-link';
import { Absence } from '@/components/ui/absence';
import type { SiteHealthOverview } from '@citeladder/contracts';
import { issueTitle } from '@/lib/site-health/issues';
import { formatScore, statusLabel } from '@/lib/site-health/status';
import { textRole } from '@/components/ui/typography';
import { Inline, Stack } from '@/components/ui/layout';
import {
  EditorialSectionHeader,
  ledgerClasses,
  ledgerItemClasses,
} from '@/components/ui/workspace';
import { ICONS } from '@/lib/icons';
import { StateBlock } from '@/components/ui/state-block';
import { SectionContent, TitledSection } from '@/components/ui/section';
import { availabilityLabel, formatCount, formatPercent, pluralCount } from '@/lib/format';

const MEASUREMENT_LABELS: Record<string, string> = {
  measured: 'Measured',
  limited_evidence: 'Limited evidence',
  not_measured: 'Not checked',
  excluded: 'Excluded',
  not_applicable: availabilityLabel('not_applicable'),
};

function measurementLabel(state: string): string {
  return MEASUREMENT_LABELS[state] ?? statusLabel(state);
}

function Unscored({
  dimension,
}: Readonly<{ dimension: SiteHealthOverview['aeo_dimensions'][number] }>) {
  if (dimension.dimension_applicability === 'not_applicable')
    return <Absence state="not_applicable" />;
  if (dimension.dimension_measurement_state === 'not_measured')
    return <Absence state="not_measured" />;
  const label =
    dimension.reason === 'measured_at_site_scope'
      ? 'Site-scoped evidence'
      : measurementLabel(dimension.dimension_measurement_state);
  return <Absence state="unavailable" label={label} />;
}

export function OverviewDetails({ data }: Readonly<{ data: SiteHealthOverview }>) {
  const [webFundamentalsOpen, setWebFundamentalsOpen] = useState(false);
  return (
    <>
      <AppGrid layout="halves">
        <DimensionLedger dimensions={data.aeo_dimensions} />
        <TopIssues issues={data.top_issues} />
      </AppGrid>
      <AppGrid layout="thirds">
        <WebFundamentalsCard
          data={data.web_fundamentals}
          onOpen={() => setWebFundamentalsOpen(true)}
        />
        <OpenIssuesTrendCard points={data.open_issue_trend} />
        <ChangeSummaryCard data={data.change_summary} />
      </AppGrid>
      <WebFundamentalsDrawer
        data={data.web_fundamentals}
        open={webFundamentalsOpen}
        onOpenChange={setWebFundamentalsOpen}
      />
    </>
  );
}

function DimensionLedger({
  dimensions,
}: Readonly<{ dimensions: SiteHealthOverview['aeo_dimensions'] }>) {
  return (
    <DataTable
      title="AEO readiness by pillar"
      toolbar={{
        actions: (
          <Button asChild variant="secondary">
            <ProjectLink href="/site?tab=aeo-readiness">Open AEO readiness</ProjectLink>
          </Button>
        ),
      }}
      columns={PILLAR_COLUMNS}
    >
      {dimensions.map((dimension) => (
        <TableRow key={dimension.key}>
          <TableCell>
            <TableCellLines
              title
              primary={dimension.label}
              secondary={
                dimension.reason === 'measured_at_site_scope'
                  ? `Measured at site scope · ${dimension.description}`
                  : dimension.description
              }
            />
          </TableCell>
          <TableCell numeric>
            {dimension.score === null ? (
              <Unscored dimension={dimension} />
            ) : (
              formatScore(dimension.score)
            )}
          </TableCell>
          <TableCell numeric>
            {dimension.coverage === null ? (
              <Absence state="not_measured" />
            ) : (
              formatPercent(dimension.coverage)
            )}
          </TableCell>
        </TableRow>
      ))}
    </DataTable>
  );
}

const PILLAR_COLUMNS: readonly DataTableColumn[] = [
  { key: 'pillar', label: 'Pillar', kind: 'identity' },
  { key: 'score', label: 'Score', kind: 'number' },
  { key: 'coverage', label: 'Coverage', kind: 'number' },
];

const TOP_ISSUE_COLUMNS: readonly DataTableColumn[] = [
  { key: 'impact', label: 'Impact', kind: 'status', width: 'figure' },
  { key: 'issue', label: 'Issue', kind: 'identity' },
  { key: 'pages', label: 'Pages affected', kind: 'number' },
];

function TopIssues({ issues }: Readonly<{ issues: SiteHealthOverview['top_issues'] }>) {
  return (
    <DataTable
      title="Top issues"
      toolbar={{
        actions: (
          <Button asChild variant="secondary">
            <ProjectLink href="/issues">View all issues</ProjectLink>
          </Button>
        ),
      }}
      columns={TOP_ISSUE_COLUMNS}
      state={
        issues.length === 0
          ? { kind: 'empty', icon: ICONS.issues, headingLevel: 3, heading: 'No issues found' }
          : undefined
      }
    >
      {issues.map((issue) => (
        <TableRow key={`${issue.rule_id}-${issue.finding_class}`}>
          <TableCell className="whitespace-nowrap">
            <StatusMark variant="severity" value={impactSeverity(issue.impact_band)}>
              {impactLabel(issue.impact_band)}
            </StatusMark>
          </TableCell>
          <TableCell>
            <Inline>
              <TextLink
                text="body"
                underline="hover"
                href={issueHref(issue)}
                className="inline-flex min-h-6 min-w-0 items-center"
              >
                <ClampText lines={1}>{issueTitle(issue)}</ClampText>
              </TextLink>
              {issue.finding_class === 'advisory' ? <Tag>Advisory</Tag> : null}
            </Inline>
          </TableCell>
          <TableCell numeric>{formatCount(issue.affected_pages)}</TableCell>
        </TableRow>
      ))}
    </DataTable>
  );
}

function WebFundamentalsCard({
  data,
  onOpen,
}: Readonly<{ data: SiteHealthOverview['web_fundamentals']; onOpen: () => void }>) {
  return (
    <TitledSection title="Web fundamentals">
      <SectionContent>
        <Stack gap="workspace">
          <ul aria-label="Web fundamentals areas" className={ledgerClasses()}>
            {data.areas.map((area) => (
              <Inline as="li" key={area.key} className={ledgerItemClasses('justify-between')}>
                <span className={textRole('body', 'text-ink-2 capitalize')}>{area.key}</span>
                <MeasurementMark state={area.state} />
              </Inline>
            ))}
          </ul>
          <Inline>
            <ActionButton action="viewEvidence" onClick={onOpen} />
          </Inline>
        </Stack>
      </SectionContent>
    </TitledSection>
  );
}

function OpenIssuesTrendCard({
  points,
}: Readonly<{ points: SiteHealthOverview['open_issue_trend'] }>) {
  return (
    <TitledSection title="Open issues over time">
      <SectionContent>
        <Stack gap="item">
          <AreaChart
            data={points.map((point) => ({
              label: point.day,
              value: point.open_count,
              timestamp: Date.parse(point.day),
            }))}
            label="Open issues over time"
            name="Open issues"
            you={false}
            height="sm"
            yMin={0}
            yFormat={(value) => `${Math.round(value)}`}
          />
          {points.length < 2 ? (
            <p className="type-caption">The trend starts once audits land on two days.</p>
          ) : null}
        </Stack>
      </SectionContent>
    </TitledSection>
  );
}

/**
 * Change-summary labels are frozen into the snapshot at build time, so a
 * Presentation resolves change-summary labels from the stable metric key.
 */
const CHANGE_METRIC_LABELS: Record<string, string> = {
  web_fundamentals_score: 'Web fundamentals',
  web_fundamentals_coverage: 'Web fundamentals coverage',
  aeo_readiness_score: 'AEO readiness',
  aeo_measurement_coverage: 'AEO checklist completion',
};

function ChangeSummaryCard({ data }: Readonly<{ data: SiteHealthOverview['change_summary'] }>) {
  return (
    <TitledSection title="Score change">
      <SectionContent>
        <Stack>
          {data.metrics.map((metric) => (
            <Inline gap="compact" key={metric.key} className="type-body text-ink-2 justify-between">
              <span className="text-ink-2">{CHANGE_METRIC_LABELS[metric.key] ?? metric.label}</span>
              <ChangeDelta metricKey={metric.key} delta={metric.delta} />
            </Inline>
          ))}
          {data.state === 'unavailable' ? (
            <StateBlock kind="empty" inline message="No comparable crawl yet." />
          ) : null}
          <CohortCompositionContext reason={data.reason} composition={data.cohort_composition} />
        </Stack>
      </SectionContent>
    </TitledSection>
  );
}

/**
 * Every change-summary metric is a score or a coverage share, so a rise is an
 * improvement. Coverage is a 0–1 share; its change reads in percentage points.
 */
function ChangeDelta({ metricKey, delta }: Readonly<{ metricKey: string; delta: number | null }>) {
  const coverage = metricKey.endsWith('_coverage');
  const scale = coverage ? 100 : 1;
  return (
    <Delta
      value={delta === null ? null : delta * scale}
      precision={0}
      unit={coverage ? ' pp' : ''}
    />
  );
}

function impactLabel(impactBand: number): 'High' | 'Medium' | 'Low' {
  if (impactBand >= 3) return 'High';
  if (impactBand === 2) return 'Medium';
  return 'Low';
}

function impactSeverity(impactBand: number): 'high' | 'medium' | 'low' {
  if (impactBand >= 3) return 'high';
  if (impactBand === 2) return 'medium';
  return 'low';
}

function measurementTone(state: string): 'success' | 'warning' | 'info' {
  if (state === 'measured') return 'success';
  if (state === 'limited_evidence') return 'warning';
  return 'info';
}

function MeasurementMark({ state }: Readonly<{ state: string }>) {
  if (state === 'not_measured' || state === 'not_applicable')
    return <Absence state={state} label={measurementLabel(state)} />;
  return (
    <StatusMark variant="status" value={measurementTone(state)}>
      {measurementLabel(state)}
    </StatusMark>
  );
}

function issueHref(issue: SiteHealthOverview['top_issues'][number]): string {
  const params = new URLSearchParams({ rule: issue.rule_id });
  if (issue.section && issue.section !== 'technical') params.set('section', issue.section);
  return `/issues?${params.toString()}`;
}

function WebFundamentalsDrawer({
  data,
  open,
  onOpenChange,
}: Readonly<{
  data: SiteHealthOverview['web_fundamentals'];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}>) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange} title="Web fundamentals">
      <div className={ledgerClasses()}>
        {data.areas.map((area) => (
          <Stack as="section" key={area.key} className={ledgerItemClasses()}>
            <EditorialSectionHeader
              title={<span className="capitalize">{area.key}</span>}
              description={
                <>
                  {area.coverage === null ? (
                    <Absence state="not_measured" />
                  ) : (
                    formatPercent(area.coverage)
                  )}{' '}
                  evidence coverage · {formatCount(area.passed_count)} passed ·{' '}
                  {formatCount(area.missing_count)} missing
                </>
              }
              actions={<MeasurementMark state={area.state} />}
            />
            <Stack>
              {area.top_findings.length === 0 ? (
                <StateBlock kind="empty" inline message="No missing checks in this area." />
              ) : (
                area.top_findings.map((finding) => (
                  <Stack gap="tight" key={finding.rule_id}>
                    <span className={textRole('body')}>{finding.title}</span>
                    <span className="type-caption">
                      {pluralCount(finding.affected_pages, 'page')} affected · {finding.remediation}
                    </span>
                  </Stack>
                ))
              )}
            </Stack>
          </Stack>
        ))}
      </div>
    </Drawer>
  );
}
