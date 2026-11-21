import { Absence } from '@/components/ui/absence';
import type { PageDetail } from '@citeladder/contracts';
import { AuditScores } from './overview-metrics';

export function UrlScoreSummary({ detail }: Readonly<{ detail: PageDetail }>) {
  return (
    <AuditScores
      metrics={[
        {
          title: 'Web fundamentals',
          value: detail.web_fundamentals_score,
          unavailable: scoreUnavailableState(detail.web_fundamentals_state),
        },
        {
          title: 'AEO readiness',
          value: detail.aeo_readiness_score,
          unavailable: scoreUnavailableState(
            detail.aeo_measurement_state,
            detail.aeo_measurement_reason,
          ),
        },
        {
          title: 'AEO checklist completion',
          value:
            detail.aeo_measurement_coverage === null ? null : detail.aeo_measurement_coverage * 100,
          valueUnit: 'percent',
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
    return <Absence state="not_measured" label="Limited evidence" />;
  }
  if (state === 'excluded') return <Absence state="not_applicable" label="Excluded" />;
  if (reason === 'unsupported_purpose_checklist') {
    return <Absence state="not_applicable" label="No AEO checklist for this page kind" />;
  }
  return <Absence state="not_measured" />;
}
