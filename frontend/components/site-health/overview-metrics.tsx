import type { ReactNode } from 'react';

import { Card } from '@/components/ui/card';
import { StatRow, type StatSegment } from '@/components/ui/stat-row';
import { TextLink } from '@/components/ui/text-link';
import { UnavailableValue } from '@/components/ui/unavailable-value';
import { ICONS } from '@/lib/icons';
import type { SiteCrawl, SiteHealthDashboard, SiteHealthOverview } from '@/lib/api/types';
import { measurementCaveat, shouldPollCrawl } from '@/lib/site-health/status';

/** One Site Health score as a `StatRow` segment: the ring, its caveat and where to act. */
export type AuditMetric = {
  title: string;
  value: number | null;
  valueUnit?: 'score' | 'percent';
  caveat: string | null;
  href?: string;
  icon: typeof ICONS.site;
  unavailable?: ReactNode;
};

function auditSegment({
  title,
  value,
  valueUnit = 'score',
  caveat,
  href,
  icon,
  unavailable,
}: AuditMetric): StatSegment {
  const base = {
    key: title,
    label: title,
    icon,
    sub: caveat === null || caveat === 'Not measured' ? undefined : caveat,
    action: href ? <TextLink href={href}>View details</TextLink> : undefined,
  };
  if (value === null) {
    return { ...base, value: unavailable ?? <UnavailableValue state="not_measured" /> };
  }
  const rounded = Math.round(value);
  return {
    ...base,
    score: {
      value,
      label: valueUnit === 'percent' ? `${title}: ${rounded}%` : `${title} score: ${rounded}`,
    },
  };
}

/** The Site Health scores, as one card holding one `StatRow`. */
export function AuditScores({
  metrics,
  testId,
}: Readonly<{ metrics: readonly AuditMetric[]; testId?: string }>) {
  return (
    <Card data-testid={testId}>
      <StatRow segments={metrics.map(auditSegment)} />
    </Card>
  );
}

type Summary = SiteHealthDashboard['score_summary'];
type MetricContext = {
  overview?: SiteHealthOverview;
  summary: Summary;
  analyzed: number;
  selected: number;
  active: boolean;
};
type MetricModel = AuditMetric;

function percentRatio(value: number | null | undefined): number | null {
  return value === null || value === undefined ? null : value * 100;
}

export function OverviewMetricCards({
  overview,
  dashboard,
  crawl,
}: Readonly<{
  overview?: SiteHealthOverview;
  dashboard: SiteHealthDashboard | undefined;
  crawl: SiteCrawl | null;
}>) {
  const context = metricContext(overview, dashboard, crawl);
  const metrics = [
    technicalMetric(context),
    aeoMetric(context),
    measurementMetric(context),
    crawlMetric(context),
  ];
  return <AuditScores metrics={metrics} testId="overview-metrics" />;
}

function metricContext(
  overview: SiteHealthOverview | undefined,
  dashboard: SiteHealthDashboard | undefined,
  crawl: SiteCrawl | null,
): MetricContext {
  const summary: Summary = dashboard?.score_summary ?? crawl?.score_summary ?? null;
  return {
    overview,
    summary,
    analyzed: overview?.audited_page_count ?? summary?.analyzed_count ?? crawl?.analyzed_count ?? 0,
    selected:
      overview?.selected_page_count ?? summary?.selected_count ?? crawl?.visible_url_count ?? 0,
    active: crawl !== null && shouldPollCrawl(crawl),
  };
}

function technicalMetric(context: MetricContext): MetricModel {
  const source = context.overview ?? context.summary;
  const score = source?.web_fundamentals_score;
  const coverage = source?.web_fundamentals_coverage;
  const state = source?.web_fundamentals_state;
  return {
    title: 'Web Fundamentals',
    value: score ?? null,
    caveat: measurementCaveat(state, coverage),
    href: '/issues?dimension=technical',
    icon: ICONS.siteHealth,
  };
}

function aeoMetric(context: MetricContext): MetricModel {
  const source = context.overview ?? context.summary;
  const score = source?.aeo_readiness_score;
  const coverage = source?.aeo_measurement_coverage;
  const state = source?.aeo_measurement_state;
  return {
    title: 'AEO Readiness',
    value: score ?? null,
    caveat: measurementCaveat(state, coverage),
    href: '/issues?dimension=aeo',
    icon: ICONS.visibility,
  };
}

function measurementMetric(context: MetricContext): MetricModel {
  const source = context.overview ?? context.summary;
  const coverage = source?.aeo_measurement_coverage;
  const state = source?.aeo_measurement_state;
  return {
    title: 'AEO Checklist Completion',
    valueUnit: 'percent',
    value: percentRatio(coverage),
    caveat: measurementCaveat(state, coverage),
    href: '/site?tab=aeo-readiness',
    icon: ICONS.reports,
  };
}

const count = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

/** Found, analyzed and why the rest were not: saved by the crawl, absent on older snapshots. */
function coverageCounts(coverage: SiteHealthOverview['crawl_coverage'] | undefined) {
  const evidence = coverage?.evidence ?? {};
  const found = count(evidence.observation_count);
  const analyzed = count(evidence.analyzed_url_count);
  if (found === null || analyzed === null) return null;
  return {
    found,
    analyzed,
    failed: count(evidence.failed_url_count) ?? 0,
    limit: count(evidence.automatic_limit),
  };
}

function crawlMetric(context: MetricContext): MetricModel {
  const terminalCoverage = context.overview?.crawl_coverage;
  const counts = coverageCounts(terminalCoverage);
  // Share of the pages the crawl found, not of the pages it chose: 20 of 100 is not 100%.
  let progress = context.selected > 0 ? (100 * context.analyzed) / context.selected : null;
  if (counts)
    progress = counts.found ? (100 * Math.min(counts.analyzed, counts.found)) / counts.found : null;
  return {
    title: 'Crawl Coverage',
    value: progress,
    caveat:
      terminalCoverage && counts
        ? coverageNote(terminalCoverage, counts)
        : coverageCaveat(terminalCoverage, context.active),
    href: '/site?tab=pages',
    icon: ICONS.site,
  };
}

/** Reasons the count sentence already states. */
const COUNTED_REASONS = new Set([
  'frontier_exhausted',
  'frontier_not_exhausted',
  'requested_page_limit_reached',
]);
const firstReason = (coverage: SiteHealthOverview['crawl_coverage'], skip = new Set<string>()) => {
  const reasons = coverage.evidence.reasons;
  return Array.isArray(reasons)
    ? reasons.find((value): value is string => typeof value === 'string' && !skip.has(value))
    : undefined;
};

/** What a reader needs to act: how many pages were left out, and why; uncertainty stays visible. */
function coverageNote(
  coverage: SiteHealthOverview['crawl_coverage'],
  counts: NonNullable<ReturnType<typeof coverageCounts>>,
) {
  const parts = [coverage.state === 'unknown' ? 'Coverage unknown' : null];
  if (!counts.found) parts.push('No pages found');
  else parts.push(`${counts.analyzed} of ${counts.found} found pages analyzed`);
  if (
    counts.limit !== null &&
    counts.limit > 0 &&
    counts.analyzed >= counts.limit &&
    counts.found > counts.analyzed
  )
    parts.push(`limit ${counts.limit} per crawl`);
  if (counts.failed > 0) parts.push(`${counts.failed} failed to load`);
  parts.push(firstReason(coverage, COUNTED_REASONS)?.replaceAll('_', ' ') ?? null);
  return parts.filter(Boolean).join(' · ');
}

function coverageCaveat(
  coverage: SiteHealthOverview['crawl_coverage'] | undefined,
  active: boolean,
): string | null {
  if (!coverage) return active ? 'In progress' : 'Coverage unavailable';
  if (coverage.state === 'complete') return null;
  const label = coverage.state === 'partial' ? 'Partial coverage' : 'Coverage unknown';
  const reason = firstReason(coverage);
  return reason ? `${label} · ${reason.replaceAll('_', ' ')}` : label;
}
