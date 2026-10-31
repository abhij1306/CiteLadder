'use client';

import { useState } from 'react';
import { ProjectLink } from '@/components/layout/scoped-link';

import { CohortCompositionContext } from './cohort-composition-context';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Delta } from '@/components/ui/delta';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Drawer } from '@/components/ui/drawer';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { ScoreBar } from '@/components/ui/score-bar';
import { ClampText, TableCell, TableRow } from '@/components/ui/table';
import { TrendChart } from '@/components/ui/trend-chart';
import { QueryState } from '@/components/ui/query-state';
import { TextLink } from '@/components/ui/text-link';
import { UnavailableValue } from '@/components/ui/unavailable-value';
import type { SiteHealthOverview } from '@/lib/api/types';
import { formatScore, PLACEHOLDER, statusLabel } from '@/lib/site-health/status';
import { textRole } from '@/components/ui/typography';
import { panelClasses } from '@/components/ui/panel';
import { Inline, Stack } from '@/components/ui/layout';
import {
  EditorialSectionHeader,
  ledgerClasses,
  ledgerItemClasses,
  splitPaneClasses,
} from '@/components/ui/workspace';
import { ICONS } from '@/lib/icons';

function percent(value: number | null): string {
  return value === null ? PLACEHOLDER : `${Math.round(value * 100)}%`;
}

export function OverviewDetails({ data }: Readonly<{ data: SiteHealthOverview }>) {
  const [webFundamentalsOpen, setWebFundamentalsOpen] = useState(false);
  return (
    <>
      <div className={splitPaneClasses('peers')}>
        <DimensionLedger dimensions={data.aeo_dimensions} />
        <TopIssues issues={data.top_issues} />
      </div>
      <div className={splitPaneClasses('thirds')}>
        <WebFundamentalsCard
          data={data.web_fundamentals}
          onOpen={() => setWebFundamentalsOpen(true)}
        />
        <TrendCard data={data.trend} />
        <ChangeSummaryCard data={data.change_summary} />
      </div>
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
      title="AEO Readiness by pillar"
      toolbar={{
        actions: (
          <Button asChild variant="secondary">
            <ProjectLink href="/site?tab=aeo-readiness">View details</ProjectLink>
          </Button>
        ),
      }}
      columns={PILLAR_COLUMNS}
      minWidth="sm"
    >
      {dimensions.map((dimension) => (
        <TableRow key={dimension.key}>
          <TableCell>
            {/* Name over one caption line: the ledger is a scanning
                surface, and a wrapping sentence pushes the score columns
                off a screenful. Full text stays available on hover. */}
            <div className="grid min-w-0">
              <ClampText lines={1} className={textRole('emphasis', 'text-foreground')}>
                {dimension.label}
              </ClampText>
              <ClampText lines={1} className="type-caption">
                {dimension.reason === 'measured_at_site_scope'
                  ? `Measured at site scope · ${dimension.description}`
                  : dimension.description}
              </ClampText>
            </div>
          </TableCell>
          <TableCell numeric>{formatScore(dimension.score)}</TableCell>
          <TableCell>
            {dimension.score === null ? (
              <ClampText lines={1} className="type-caption">
                {dimension.reason === 'measured_at_site_scope'
                  ? 'Site-scoped evidence'
                  : statusLabel(dimension.dimension_measurement_state)}
              </ClampText>
            ) : (
              <ScoreBar value={dimension.score} label={`${dimension.label} score`} />
            )}
          </TableCell>
          <TableCell numeric>
            {dimension.coverage === null ? (
              <UnavailableValue state="not_measured" />
            ) : (
              percent(dimension.coverage)
            )}
          </TableCell>
        </TableRow>
      ))}
    </DataTable>
  );
}

const PILLAR_COLUMNS: readonly DataTableColumn[] = [
  { key: 'pillar', label: 'Pillar' },
  { key: 'score', label: 'Score', width: 'figure', numeric: true },
  { key: 'quality', label: 'Quality', width: 'status' },
  { key: 'coverage', label: 'Coverage', width: 'figure', numeric: true },
];

const TOP_ISSUE_COLUMNS: readonly DataTableColumn[] = [
  { key: 'impact', label: 'Impact', width: 'figure' },
  { key: 'issue', label: 'Issue' },
  { key: 'type', label: 'Type', width: 'figure' },
  { key: 'pages', label: 'Pages', width: 'figure', numeric: true },
  { key: 'effect', label: 'Effect', width: 'figure' },
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
      minWidth="md"
      state={
        issues.length === 0
          ? { kind: 'empty', icon: ICONS.issues, headingLevel: 3, heading: 'No persisted issues' }
          : undefined
      }
    >
      {issues.map((issue) => (
        <TableRow key={`${issue.rule_id}-${issue.finding_class}`}>
          <TableCell className="whitespace-nowrap">
            <Badge variant="status" value={impactTone(issue.impact_band)}>
              {impactLabel(issue.impact_band)}
            </Badge>
          </TableCell>
          <TableCell>
            <TextLink text="inherit" href={issueHref(issue.rule_id, issue.finding_class)}>
              <ClampText>{issue.description || issue.rule_id}</ClampText>
            </TextLink>
          </TableCell>
          <TableCell className="whitespace-nowrap">{statusLabel(issue.finding_class)}</TableCell>
          <TableCell numeric>{issue.affected_pages}</TableCell>
          <TableCell className="whitespace-nowrap">
            <ScoreEffect roles={issue.score_roles} />
          </TableCell>
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
    <Card>
      <CardHeader>
        <CardTitle>Web Fundamentals</CardTitle>
        <CardDescription>Persisted HTTP evidence across four areas.</CardDescription>
      </CardHeader>
      <CardContent>
        <Stack gap="workspace">
          <div className={splitPaneClasses('peers')}>
            {data.areas.map((area) => (
              <Stack
                gap="tight"
                key={area.key}
                className={panelClasses({ tone: 'well' }, 'justify-items-start')}
              >
                <span className={textRole('label', 'capitalize')}>{area.key}</span>
                <Badge variant="status" value={measurementTone(area.state)}>
                  {statusLabel(area.state)}
                </Badge>
              </Stack>
            ))}
          </div>
          <Button variant="secondary" onClick={onOpen} className="justify-self-start">
            View evidence
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}

function TrendCard({ data }: Readonly<{ data: SiteHealthOverview['trend'] }>) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>AEO Readiness trend</CardTitle>
        <CardDescription>Comparable terminal crawl snapshots only.</CardDescription>
      </CardHeader>
      <CardContent>
        <Stack gap="item">
          <TrendChart
            data={data.series}
            label="AEO Readiness trend"
            height={96}
            className="h-auto w-full"
          />
          {data.state === 'unavailable' ? (
            <p className="type-caption">Run a second comparable crawl to establish a trend.</p>
          ) : null}
          <CohortCompositionContext reason={data.reason} composition={data.cohort_composition} />
        </Stack>
      </CardContent>
    </Card>
  );
}

/**
 * Change-summary labels are frozen into the snapshot at build time, so a
 * Presentation resolves change-summary labels from the stable metric key.
 */
const CHANGE_METRIC_LABELS: Record<string, string> = {
  web_fundamentals_score: 'Web Fundamentals',
  web_fundamentals_coverage: 'Web Fundamentals coverage',
  aeo_readiness_score: 'AEO Readiness',
  aeo_measurement_coverage: 'AEO coverage',
};

function ChangeSummaryCard({ data }: Readonly<{ data: SiteHealthOverview['change_summary'] }>) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Change summary</CardTitle>
        <CardDescription>Change since the previous comparable crawl.</CardDescription>
      </CardHeader>
      <CardContent>
        <Stack>
          {data.metrics.map((metric) => (
            <Inline gap="compact" key={metric.key} className="type-body justify-between">
              <span className="text-secondary">
                {CHANGE_METRIC_LABELS[metric.key] ?? metric.label}
              </span>
              <ChangeDelta metricKey={metric.key} delta={metric.delta} />
            </Inline>
          ))}
          {data.state === 'unavailable' ? (
            <QueryState kind="empty" inline message="No comparable snapshot yet." />
          ) : null}
          <CohortCompositionContext reason={data.reason} composition={data.cohort_composition} />
        </Stack>
      </CardContent>
    </Card>
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

/**
 * Which site score a rule feeds. A rule can feed both scores, and a diagnostic
 * rule feeds neither. Short labels keep the column narrow next to the ledger.
 */
const SCORE_ROLE_LABELS: Record<string, string> = {
  web_fundamentals: 'Web',
  aeo_readiness: 'AEO',
};

function ScoreEffect({ roles }: Readonly<{ roles: readonly string[] }>) {
  const labels = roles.flatMap((role) => {
    const label = SCORE_ROLE_LABELS[role];
    return label ? [[role, label] as const] : [];
  });
  if (labels.length === 0) return <UnavailableValue state="not_measured" />;
  return (
    <Inline gap="tight">
      {labels.map(([role, label]) => (
        <Badge key={role}>{label}</Badge>
      ))}
    </Inline>
  );
}

function impactLabel(impactBand: number): 'High' | 'Medium' | 'Low' {
  if (impactBand >= 3) return 'High';
  if (impactBand === 2) return 'Medium';
  return 'Low';
}

function impactTone(impactBand: number): 'danger' | 'warning' | 'info' {
  if (impactBand >= 3) return 'danger';
  if (impactBand === 2) return 'warning';
  return 'info';
}

function measurementTone(state: string): 'success' | 'warning' | 'info' {
  if (state === 'measured') return 'success';
  if (state === 'limited_evidence') return 'warning';
  return 'info';
}

function issueHref(ruleId: string, findingClass: string): string {
  const params = new URLSearchParams({ rule: ruleId });
  if (findingClass === 'advisory') params.set('finding_class', findingClass);
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
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title="Web Fundamentals"
      description="Static evidence from the acquired HTML and response headers."
    >
      <div className={ledgerClasses()}>
        {data.areas.map((area) => (
          <Stack as="section" key={area.key} className={ledgerItemClasses()}>
            <EditorialSectionHeader
              title={<span className="capitalize">{area.key}</span>}
              description={
                <>
                  {percent(area.coverage)} evidence coverage · {area.passed_count} passed ·{' '}
                  {area.missing_count} missing
                </>
              }
              actions={
                <Badge variant="status" value={measurementTone(area.state)}>
                  {statusLabel(area.state)}
                </Badge>
              }
            />
            <Stack>
              {area.top_findings.length === 0 ? (
                <QueryState kind="empty" inline message="No missing HTTP-evidence checks." />
              ) : (
                area.top_findings.map((finding) => (
                  <Stack gap="tight" key={finding.rule_id}>
                    <span className={textRole('itemTitle')}>{finding.title}</span>
                    <span className="type-caption">
                      {finding.affected_pages} affected pages · {finding.remediation}
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
