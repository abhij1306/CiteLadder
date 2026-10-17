import { textRole } from '@/components/ui/typography';
import type { SiteIssue } from '@/lib/api/types';
import { dimensionLabel, severityLabel } from '@/lib/site-health/issues';

/**
 * How severe, and in which dimension — the two facts that identify an issue at
 * a glance. Shared by the catalog list and the detail rail so a row and the
 * panel it opens cannot describe the same issue differently.
 */
export function IssueMetadata({ issue }: Readonly<{ issue: SiteIssue }>) {
  const tone = issueSeverityTone(issue.severity);
  return (
    <span className={textRole('label', 'flex flex-wrap items-center gap-2 uppercase')}>
      <span className={issue.finding_class === 'defect' ? tone : 'text-secondary'}>
        {issue.finding_class === 'defect' ? severityLabel(issue.severity) : 'Advisory'}
      </span>
      <span className="text-muted" aria-hidden>
        ·
      </span>
      <span className="text-secondary">{dimensionLabel(issue.dimension)}</span>
    </span>
  );
}

function issueSeverityTone(severity: SiteIssue['severity']): string {
  if (severity === 'critical' || severity === 'high') return 'text-danger-text';
  if (severity === 'medium') return 'text-warning-text';
  return 'text-info-text';
}
