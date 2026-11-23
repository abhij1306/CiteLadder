import { StatusMark } from '@/components/ui/status-mark';
import { Tag } from '@/components/ui/tag';
import type { SiteIssue } from '@citeladder/contracts';
import { dimensionLabel, severityLabel } from '@/lib/site-health/issues';

type IssueFacts = Pick<SiteIssue, 'severity' | 'dimension'>;

export function IssueSeverityMark({ issue }: Readonly<{ issue: Pick<IssueFacts, 'severity'> }>) {
  return (
    <StatusMark variant="severity" value={issue.severity}>
      {severityLabel(issue.severity)}
    </StatusMark>
  );
}

export function IssueCategoryTag({ issue }: Readonly<{ issue: Pick<IssueFacts, 'dimension'> }>) {
  return <Tag>{dimensionLabel(issue.dimension)}</Tag>;
}
