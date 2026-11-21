import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { AuditSchedules } from '@/components/runs/audit-schedules';
import {
  FirstRunAction,
  LaunchAuditButton,
  useLaunchReadiness,
} from '@/components/runs/launch-audit-button';
import { RunsTable } from '@/components/runs/runs-table';
import { ReportPage } from '@/components/templates/report-page';
import { Spinner } from '@/components/ui/spinner';
import { TabPanel, TabRow, TabsRoot } from '@/components/ui/tabs';
import { Play } from '@/lib/icons';
import { runsQueries } from '@/lib/api/runs';
import type { Audit } from '@citeladder/contracts';
import { stringUrlCodec, useUrlState } from '@/lib/navigation/url-state';
import { useProjectScope } from '@/lib/project/active-project-scope';
import { useWorkspaceCapability } from '@/lib/project/project-context';
import { MastheadPrimary } from '@/components/ui/masthead-actions';
import { AUDIT_STATES, pollAudits } from '@/lib/runs/status';
import { readErrorProps, type RetryableRead } from '@/components/ui/notice';
import { StateBlock } from '@/components/ui/state-block';

type StatusFilter = 'all' | 'completed' | 'running' | 'failed';

const STATUS_FILTERS: {
  id: StatusFilter;
  label: string;
  match: (audit: Audit) => boolean;
}[] = [
  { id: 'all', label: 'All', match: () => true },
  {
    id: 'completed',
    label: 'Completed',
    match: (audit) => audit.status === 'completed',
  },
  {
    id: 'running',
    label: 'Running',
    match: (audit) => AUDIT_STATES[audit.status].active,
  },
  {
    id: 'failed',
    label: 'Failed',
    match: (audit) => audit.status === 'failed',
  },
];

const statusCodec = stringUrlCodec<StatusFilter>(
  STATUS_FILTERS.map((filter) => filter.id),
  'all',
);

export function RunsScreen() {
  const { workspaceId, projectId, project } = useProjectScope();
  const [statusFilter, setStatusFilter] = useUrlState('status', statusCodec, {
    clearKeys: ['page'],
  });

  const runsQuery = useQuery({
    ...runsQueries.list({ workspaceId, projectId }),
    refetchInterval: (query) => pollAudits(query.state.data?.map((audit) => audit.status)),
  });

  const audits = useMemo(() => runsQuery.data ?? [], [runsQuery.data]);
  const filteredAudits = useMemo(
    () =>
      audits.filter(
        STATUS_FILTERS.find((filter) => filter.id === statusFilter)?.match ?? (() => true),
      ),
    [audits, statusFilter],
  );
  const anyActive = audits.some((audit) => AUDIT_STATES[audit.status].active);

  const canRun = useWorkspaceCapability('run');
  const readiness = useLaunchReadiness(projectId);
  const empty = runsQuery.isSuccess && audits.length === 0;
  const actions = empty ? undefined : (
    <MastheadPrimary>
      <LaunchAuditButton />
    </MastheadPrimary>
  );
  const tabs =
    audits.length === 0 ? undefined : (
      <TabRow
        ariaLabel="Filter by status"
        items={STATUS_FILTERS.map((filter) => ({
          value: filter.id,
          label: filter.label,
          count: audits.filter(filter.match).length,
        }))}
      />
    );

  if (runsQuery.isLoading) {
    return (
      <ReportPage actions={actions}>
        <StateBlock kind="loading" label="Loading runs…" shape={{ kind: 'table' }} />
      </ReportPage>
    );
  }

  return (
    <TabsRoot value={statusFilter} onValueChange={setStatusFilter}>
      <ReportPage actions={actions} tabs={tabs}>
        <TabPanel value={statusFilter}>
          <RunsContent
            read={runsQuery}
            audits={audits}
            filteredAudits={filteredAudits}
            statusFilter={statusFilter}
            anyActive={anyActive}
            canRun={canRun}
            promptsReady={readiness.kind !== 'blocked'}
          />
        </TabPanel>

        {readiness.kind === 'ready' ? (
          <AuditSchedules projectId={projectId} promptSets={project.prompt_sets} />
        ) : null}
      </ReportPage>
    </TabsRoot>
  );
}

function RunsContent({
  read,
  audits,
  filteredAudits,
  statusFilter,
  anyActive,
  canRun,
  promptsReady,
}: Readonly<{
  read: RetryableRead;
  audits: Audit[];
  filteredAudits: Audit[];
  statusFilter: StatusFilter;
  anyActive: boolean;
  canRun: boolean;
  promptsReady: boolean;
}>) {
  if (read.error) {
    return (
      <StateBlock
        kind="error"
        {...readErrorProps(read)}
        title="Couldn't load the runs"
        fallback="Check your connection and try again."
      />
    );
  }
  if (audits.length === 0) {
    return (
      <StateBlock
        kind="empty"
        icon={Play}
        heading="No runs yet"
        description={canRun && !promptsReady ? 'Add prompts to start.' : undefined}
        action={canRun ? <FirstRunAction /> : undefined}
      />
    );
  }

  const filterLabel = STATUS_FILTERS.find(
    (filter) => filter.id === statusFilter,
  )?.label.toLowerCase();
  return (
    <RunsTable
      audits={filteredAudits}
      emptyHeading={`No ${filterLabel} runs`}
      status={anyActive ? <Spinner label="Updating live" showLabel /> : null}
    />
  );
}
