import type { SiteCrawl, SiteHealthDashboard } from '@citeladder/contracts';
import { checksRunLabel } from '@/lib/site-health/status';
import { AuditScores } from './overview-metrics';
import { scoreUnavailableState } from './url-score-summary';

export function ScoreSection({
  crawl,
  dashboard,
}: Readonly<{ crawl: SiteCrawl | null; dashboard: SiteHealthDashboard | undefined }>) {
  const summary = dashboard?.score_summary ?? crawl?.score_summary ?? null;
  const coverage = summary?.aeo_measurement_coverage;
  return (
    <AuditScores
      testId="score-section"
      metrics={[
        {
          title: 'Web fundamentals',
          value: summary?.web_fundamentals_score ?? null,
          caption: checksRunLabel(summary?.web_fundamentals_checks),
          unavailable: scoreUnavailableState(summary?.web_fundamentals_state),
          href: '/issues?section=technical',
        },
        {
          title: 'AEO readiness',
          value: summary?.aeo_readiness_score ?? null,
          caption: checksRunLabel(summary?.aeo_readiness_checks),
          unavailable: scoreUnavailableState(summary?.aeo_measurement_state),
          href: '/issues?section=aeo',
        },
        {
          title: 'AEO checklist completion',
          value: coverage == null ? null : coverage * 100,
          valueUnit: 'percent',
          unavailable: scoreUnavailableState(summary?.aeo_measurement_state),
          href: '/site?tab=aeo-readiness',
        },
        {
          title: 'Pages discovered',
          value: crawl?.visible_url_count ?? null,
          valueUnit: 'count',
        },
        {
          title: 'Pages analyzed',
          value: crawl ? crawl.counters.analyzed || crawl.analyzed_count : null,
          valueUnit: 'count',
        },
      ]}
    />
  );
}
