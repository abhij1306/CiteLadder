'use client';

import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { EarnedPageHandoff } from '@/components/opportunities/earned-page-handoff';
import { OpportunityEvidenceSection } from '@/components/opportunities/opportunity-evidence-section';
import { OpportunitySummarySection } from '@/components/opportunities/opportunity-summary-section';
import { OpportunityTypeBadge } from '@/components/opportunities/opportunity-type-badge';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Drawer } from '@/components/ui/drawer';
import { ReadError } from '@/components/ui/read-error';
import { Skeleton } from '@/components/ui/skeleton';
import { Label, textRole } from '@/components/ui/typography';
import { opportunitiesQueries } from '@/lib/api/opportunities';
import type { OpportunityDetail } from '@/lib/api/types';
import { severityBadgeValue, severityLabel } from '@/lib/site-health/issues';
import { panelClasses } from '@/components/ui/panel';
import { Limitations } from '@/components/ui/passage';
import { useActiveWorkspaceId } from '@/lib/project/project-context';

/** One Action member's evidence, backed by the persisted detail projection. */
export function EvidenceDrawer({
  opportunityId,
  projectId,
  open,
  onOpenChange,
}: Readonly<{
  opportunityId: string | null;
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}>) {
  const workspaceId = useActiveWorkspaceId() ?? '';
  const detailQuery = useQuery({
    ...opportunitiesQueries.detail(workspaceId, opportunityId ?? ''),
    enabled: open && opportunityId !== null,
  });
  const detail = detailQuery.data?.project_id === projectId ? detailQuery.data : null;

  let body: ReactNode;
  if (detailQuery.isError) {
    body = (
      <ReadError
        error={detailQuery.error}
        fallback="Could not load this opportunity."
        onRetry={() => void detailQuery.refetch()}
        pending={detailQuery.isFetching}
      />
    );
  } else if (detailQuery.data && !detail) {
    body = (
      <Alert tone="danger">
        This opportunity is unavailable in the selected project. Close this detail and choose a
        recommendation from the current project.
      </Alert>
    );
  } else if (detailQuery.isLoading || !detail) {
    body = (
      <div className="grid gap-3">
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  } else {
    body = <OpportunityDetailBody detail={detail} />;
  }

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title="Evidence detail"
      className="sm:max-w-160"
    >
      {body}
    </Drawer>
  );
}

/** Everything the drawer shows once a detail for THIS project has loaded. */
function OpportunityDetailBody({ detail }: Readonly<{ detail: OpportunityDetail }>) {
  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <h2 className={textRole('sectionTitle')}>{detail.title}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="status" value={severityBadgeValue(detail.severity)}>
            {severityLabel(detail.severity)} impact
          </Badge>
          <OpportunityTypeBadge type={detail.opportunity_type} />
        </div>
      </div>
      <OpportunityEvidenceSection detail={detail} />
      {detail.remediation ? (
        <section className="grid gap-2">
          <Label>Recommended improvements</Label>
          <div className={panelClasses({ tone: 'well', pad: 'compact' })}>
            <p className="type-body whitespace-pre-line">{detail.remediation}</p>
          </div>
        </section>
      ) : null}
      <OpportunitySummarySection detail={detail} />
      <ActionHandoff detail={detail} />
    </div>
  );
}

/**
 * The route to the work.
 *
 * An earned action has a whole grounded brief behind it — the competitors on
 * the publisher's page, the passages proving it, the format, the coverage and
 * the named gap — and gets its own renderer. An owned action has a target, and
 * one sentence is the honest amount of chrome for it.
 */
function ActionHandoff({ detail }: Readonly<{ detail: OpportunityDetail }>) {
  if (detail.content_handoff.pathway === 'earned') {
    return <EarnedPageHandoff detail={detail} />;
  }
  return (
    <section className="grid gap-2">
      <Label>Action handoff</Label>
      <div className={panelClasses({ pad: 'compact' }, 'grid gap-2')}>
        <p className={textRole('body')}>Create or improve content the brand controls.</p>
        <Limitations items={detail.content_handoff.limitations} />
      </div>
    </section>
  );
}
