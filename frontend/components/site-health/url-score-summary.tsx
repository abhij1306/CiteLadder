import { UnavailableValue } from '@/components/ui/unavailable-value';
import type { PageDetail } from '@/lib/api/types';
import { measurementCaveat } from '@/lib/site-health/status';
import { ICONS } from '@/lib/icons';
import { AuditMetricStrip } from './audit-metric-strip';

export function UrlScoreSummary({ detail }: Readonly<{ detail: PageDetail }>) {
  return (
    <AuditMetricStrip
      metrics={[
        {
          title: 'Web Fundamentals',
          value: detail.web_fundamentals_score,
          caveat: measurementCaveat(
            detail.web_fundamentals_state,
            detail.web_fundamentals_coverage,
          ),
          icon: ICONS.siteHealth,
          unavailable: scoreUnavailableState(detail.web_fundamentals_state),
        },
        {
          title: 'AEO Readiness',
          value: detail.aeo_readiness_score,
          caveat: measurementCaveat(
            detail.aeo_measurement_state,
            detail.aeo_measurement_coverage,
            detail.aeo_measurement_reason,
          ),
          icon: ICONS.visibility,
          unavailable: scoreUnavailableState(detail.aeo_measurement_state),
        },
        {
          title: 'AEO Checklist Completion',
          value:
            detail.aeo_measurement_coverage === null ? null : detail.aeo_measurement_coverage * 100,
          valueUnit: 'percent',
          caveat: measurementCaveat(
            detail.aeo_measurement_state,
            detail.aeo_measurement_coverage,
            detail.aeo_measurement_reason,
          ),
          icon: ICONS.reports,
          unavailable: scoreUnavailableState(detail.aeo_measurement_state),
        },
      ]}
    />
  );
}

function scoreUnavailableState(state: string) {
  if (state === 'limited_evidence') {
    return <span className="type-caption">Limited evidence</span>;
  }
  if (state === 'excluded') {
    return <span className="type-caption">Excluded</span>;
  }
  return <UnavailableValue state="not_measured" />;
}
