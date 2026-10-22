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
import { Stack } from '@/components/ui/layout';
import { QueryState } from '@/components/ui/query-state';
import { ReadError } from '@/components/ui/read-error';
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
    body = <QueryState kind="loading" />;
  } else {
    body = <OpportunityDetailBody detail={detail} />;
  }

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title="Evidence detail"
      className="desktop:max-w-160"
    >
      {body}
    </Drawer>
  );
}

/** Everything the drawer shows once a detail for THIS project has loaded. */
function OpportunityDetailBody({ detail }: Readonly<{ detail: OpportunityDetail }>) {
  return (
    <Stack gap="workspace">
      <Stack>
        <h2 className={textRole('sectionTitle')}>{detail.title}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="status" value={severityBadgeValue(detail.severity)}>
            {severityLabel(detail.severity)} impact
          </Badge>
          <OpportunityTypeBadge type={detail.opportunity_type} />
        </div>
      </Stack>
      <OpportunityEvidenceSection detail={detail} />
      {detail.remediation ? (
        <Stack as="section">
          <Label>Recommended improvements</Label>
          <div className={panelClasses({ tone: 'well' })}>
            <p className="type-body whitespace-pre-line">{detail.remediation}</p>
          </div>
        </Stack>
      ) : null}
      <OpportunitySummarySection detail={detail} />
      <ActionHandoff detail={detail} />
    </Stack>
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
    <Stack as="section">
      <Label>Action handoff</Label>
      <Stack className={panelClasses()}>
        <p className={textRole('body')}>Create or improve content the brand controls.</p>
        <Limitations items={detail.content_handoff.limitations} />
      </Stack>
    </Stack>
  );
}
