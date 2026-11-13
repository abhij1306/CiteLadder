import type { ReactNode } from 'react';

import { KpiRow, type StatSegment } from '@/components/ui/stat-row';
import { TextLink } from '@/components/ui/text-link';
import { UnavailableValue } from '@/components/ui/unavailable-value';
import { ICONS } from '@/lib/icons';
import type { SiteCrawl, SiteHealthDashboard, SiteHealthOverview } from '@citeladder/contracts';

/** One Site Health score as a `KpiRow` segment: the score ring and where to act. */
export type AuditMetric = {
  title: string;
  value: number | null;
  /**
   * `percent` is a share drawn as a ring, as the Overview and Pages strips
   * show it; `plain-percent` is the same share as a plain figure, which the
   * page detail keeps.
   */
  valueUnit?: 'score' | 'percent' | 'plain-percent';
  href?: string;
  icon: typeof ICONS.site;
  unavailable?: ReactNode;
};

function auditSegment({
  title,
  value,
  valueUnit = 'score',
  href,
  icon,
  unavailable,
}: AuditMetric): StatSegment {
  const base = {
    key: title,
    label: title,
    icon,
    action: href ? <TextLink href={href}>View details</TextLink> : undefined,
  };
  if (value === null) {
    return { ...base, value: unavailable ?? <UnavailableValue state="not_measured" /> };
  }
  if (valueUnit === 'plain-percent') return { ...base, value: `${Math.round(value)}%` };
  // The ring names itself "<label>: <n> out of 100".
  return {
    ...base,
    score: { value, label: valueUnit === 'percent' ? title : `${title} score` },
  };
}

/** The Site Health scores, as one `KpiRow`. */
export function AuditScores({
  metrics,
  testId,
}: Readonly<{ metrics: readonly AuditMetric[]; testId?: string }>) {
  return <KpiRow segments={metrics.map(auditSegment)} testId={testId} />;
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
    title: 'Web Fundamentals',
    value: source?.web_fundamentals_score ?? null,
    href: '/issues?section=technical',
    icon: ICONS.siteHealth,
  };
}

function aeoMetric(context: MetricContext): AuditMetric {
  const source = context.overview ?? context.summary;
  return {
    title: 'AEO Readiness',
    value: source?.aeo_readiness_score ?? null,
    href: '/issues?section=aeo',
    icon: ICONS.visibility,
  };
}

function measurementMetric(context: MetricContext): AuditMetric {
  const source = context.overview ?? context.summary;
  return {
    title: 'AEO Checklist Completion',
    valueUnit: 'percent',
    value: percentRatio(source?.aeo_measurement_coverage),
    href: '/site?tab=aeo-readiness',
    icon: ICONS.reports,
  };
}

const count = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

/** Found and analyzed pages: saved by the crawl, absent on older snapshots. */
function coverageCounts(coverage: SiteHealthOverview['crawl_coverage'] | undefined) {
  const evidence = coverage?.evidence ?? {};
  const found = count(evidence.observation_count);
  const analyzed = count(evidence.analyzed_url_count);
  if (found === null || analyzed === null) return null;
  return { found, analyzed };
}

function crawlMetric(context: MetricContext): AuditMetric {
  const counts = coverageCounts(context.overview?.crawl_coverage);
  // Share of the pages the crawl found, not of the pages it chose: 20 of 100 is not 100%.
  let progress = context.selected > 0 ? (100 * context.analyzed) / context.selected : null;
  if (counts)
    progress = counts.found ? (100 * Math.min(counts.analyzed, counts.found)) / counts.found : null;
  return {
    title: 'Crawl Coverage',
    value: progress,
    href: '/site?tab=pages',
    icon: ICONS.site,
  };
}
