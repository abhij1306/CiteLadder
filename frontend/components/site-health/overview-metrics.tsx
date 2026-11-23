import type { ReactNode } from 'react';

import { Absence } from '@/components/ui/absence';
import type { SiteCrawl, SiteHealthDashboard, SiteHealthOverview } from '@citeladder/contracts';
import { FigureStrip, type FigureSegment } from '@/components/ui/figure-strip';
import { formatCount } from '@/lib/format';

export type AuditMetric = {
  title: string;
  value: number | null;
  valueUnit?: 'score' | 'percent' | 'count';
  figure?: ReactNode;
  sub?: ReactNode;
  href?: string;
  unavailable?: ReactNode;
  caption?: string | null;
};

function auditSegment({
  title,
  value,
  valueUnit = 'score',
  figure,
  sub,
  href,
  unavailable,
  caption,
}: AuditMetric): FigureSegment {
  const base = {
    key: title,
    label: title,
    sub,
    caption: caption ?? undefined,
    action: href ? { label: 'View details', href } : undefined,
  };
  if (figure) return { ...base, value: figure };
  if (value === null) {
    return { ...base, value: unavailable ?? <Absence state="not_measured" /> };
  }
  if (valueUnit === 'count') return { ...base, value: formatCount(value) };
  const score = Math.max(0, Math.min(100, Math.round(value)));
  return { ...base, value: valueUnit === 'percent' ? `${score}%` : String(score) };
}

export function AuditScores({
  metrics,
  testId,
}: Readonly<{ metrics: readonly AuditMetric[]; testId?: string }>) {
  return <FigureStrip segments={metrics.map(auditSegment)} testId={testId} />;
}

type Summary = SiteHealthDashboard['score_summary'];
type MetricContext = {
  overview?: SiteHealthOverview;
  summary: Summary;
  analyzed: number;
  selected: number;
};

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
  };
}

function technicalMetric(context: MetricContext): AuditMetric {
  const source = context.overview ?? context.summary;
  return {
    title: 'Web fundamentals',
    value: source?.web_fundamentals_score ?? null,
    href: '/issues?section=technical',
  };
}

function aeoMetric(context: MetricContext): AuditMetric {
  const source = context.overview ?? context.summary;
  return {
    title: 'AEO readiness',
    value: source?.aeo_readiness_score ?? null,
    href: '/issues?section=aeo',
  };
}

function measurementMetric(context: MetricContext): AuditMetric {
  const source = context.overview ?? context.summary;
  return {
    title: 'AEO checklist completion',
    valueUnit: 'percent',
    value: percentRatio(source?.aeo_measurement_coverage),
    href: '/site?tab=aeo-readiness',
  };
}

const count = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

function coverageCounts(context: MetricContext) {
  const evidence = context.overview?.crawl_coverage.evidence ?? {};
  const found = count(evidence.observation_count);
  const analyzed = count(evidence.analyzed_url_count);
  if (found === null || analyzed === null)
    return context.selected > 0
      ? {
          found: context.selected,
          analyzed: Math.min(context.analyzed, context.selected),
          limit: null,
        }
      : null;
  return found > 0
    ? { found, analyzed: Math.min(analyzed, found), limit: count(evidence.automatic_limit) }
    : null;
}

function crawlMetric(context: MetricContext): AuditMetric {
  const counts = coverageCounts(context);
  return {
    title: 'Crawl coverage',
    value: null,
    figure: counts ? (
      <>
        {`${formatCount(counts.analyzed)} of ${formatCount(counts.found)} `}
        <span className="type-caption text-ink-2">pages audited</span>
      </>
    ) : undefined,
    sub: counts?.limit ? `Plan limit ${formatCount(counts.limit)} pages` : undefined,
    href: '/site?tab=pages',
  };
}
