import { UnavailableValue } from '@/components/ui/unavailable-value';
import type { PageDetail } from '@/lib/api/types';
import { ICONS } from '@/lib/icons';
import { AuditScores } from './overview-metrics';

export function UrlScoreSummary({ detail }: Readonly<{ detail: PageDetail }>) {
  return (
    <AuditScores
      metrics={[
        {
          title: 'Web Fundamentals',
          value: detail.web_fundamentals_score,
          icon: ICONS.siteHealth,
          unavailable: scoreUnavailableState(detail.web_fundamentals_state),
        },
        {
          title: 'AEO Readiness',
          value: detail.aeo_readiness_score,
          icon: ICONS.visibility,
          unavailable: scoreUnavailableState(
            detail.aeo_measurement_state,
            detail.aeo_measurement_reason,
          ),
        },
        {
          title: 'AEO Checklist Completion',
          value:
            detail.aeo_measurement_coverage === null ? null : detail.aeo_measurement_coverage * 100,
          valueUnit: 'percent',
          icon: ICONS.reports,
          unavailable: scoreUnavailableState(
            detail.aeo_measurement_state,
            detail.aeo_measurement_reason,
          ),
        },
      ]}
    />
  );
}

function scoreUnavailableState(state: string, reason?: string) {
  if (state === 'limited_evidence') {
    return <span className="type-caption">Limited evidence</span>;
  }
  if (state === 'excluded') {
    return <span className="type-caption">Excluded</span>;
  }
  // The page's kind has no AEO checklist: a fact about the page, not a missing measurement.
  if (reason === 'unsupported_purpose_checklist') {
    return <span className="type-caption">Unsupported purpose checklist</span>;
  }
  return <UnavailableValue state="not_measured" />;
}
