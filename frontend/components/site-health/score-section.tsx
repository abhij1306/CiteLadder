import type { SiteCrawl, SiteHealthDashboard } from '@/lib/api/types';
import { measurementCaveat } from '@/lib/site-health/status';
import { UnavailableValue } from '@/components/ui/unavailable-value';
import { ICONS } from '@/lib/icons';
import { AuditMetricStrip } from './audit-metric-strip';

export function ScoreSection({
  crawl,
  dashboard,
}: Readonly<{ crawl: SiteCrawl | null; dashboard: SiteHealthDashboard | undefined }>) {
  const summary = dashboard?.score_summary ?? crawl?.score_summary ?? null;
  const coverage = summary?.aeo_measurement_coverage;
  return (
    <AuditMetricStrip
      testId="score-section"
      metrics={[
        {
          title: 'Web Fundamentals',
          value: summary?.web_fundamentals_score ?? null,
          unavailable: unavailable(summary?.web_fundamentals_state),
          caveat: measurementCaveat(
            summary?.web_fundamentals_state,
            summary?.web_fundamentals_coverage,
          ),
          icon: ICONS.siteHealth,
          href: '/issues?dimension=technical',
        },
        {
          title: 'AEO Readiness',
          value: summary?.aeo_readiness_score ?? null,
          unavailable: unavailable(summary?.aeo_measurement_state),
          caveat: measurementCaveat(summary?.aeo_measurement_state, coverage),
          icon: ICONS.visibility,
          href: '/issues?dimension=aeo',
        },
        {
          title: 'AEO Checklist Completion',
          value: coverage == null ? null : coverage * 100,
          valueUnit: 'percent',
          unavailable: unavailable(summary?.aeo_measurement_state),
          caveat: measurementCaveat(summary?.aeo_measurement_state),
          icon: ICONS.reports,
          href: '/site?tab=aeo-readiness',
        },
      ]}
    />
  );
}
function unavailable(state?: string) {
  if (state === 'limited_evidence') return <span className="type-caption">Limited evidence</span>;
  if (state === 'excluded') return <span className="type-caption">Excluded</span>;
  return <UnavailableValue state="not_measured" />;
}
