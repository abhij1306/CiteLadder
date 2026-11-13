import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Inline } from '@/components/ui/layout';
import { textRole } from '@/components/ui/typography';
import type { SiteIssue } from '@citeladder/contracts';
import { dimensionLabel, severityBadgeValue, severityLabel } from '@/lib/site-health/issues';

/**
 * How severe, and in which dimension — the two facts that identify an issue at
 * a glance. Shared by the catalog list and the detail rail so a row and the
 * panel it opens cannot describe the same issue differently. Severity is the
 * same status badge it is on Overview and the page detail; an advisory has no
 * severity, so it is the neutral tag. The detail rail appends its own facts
 * (the page count, the page types) as `children`, so they share the one line.
 */
export function IssueMetadata({
  issue,
  children,
}: Readonly<{
  issue: Pick<SiteIssue, 'finding_class' | 'severity' | 'dimension'>;
  children?: ReactNode;
}>) {
  return (
    <Inline as="span" className={textRole('label', 'flex-wrap')}>
      {issue.finding_class === 'defect' ? (
        <Badge variant="status" value={severityBadgeValue(issue.severity)}>
          {severityLabel(issue.severity)}
        </Badge>
      ) : (
        <Badge>Advisory</Badge>
      )}
      <span className="text-ink-secondary">{dimensionLabel(issue.dimension)}</span>
      {children}
    </Inline>
  );
}
