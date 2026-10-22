'use client';

import { useQuery } from '@tanstack/react-query';
import { Play } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { AuditSchedules } from '@/components/runs/audit-schedules';
import { LaunchDialog } from '@/components/runs/launch-dialog';
import { RunsTable } from '@/components/runs/runs-table';
import { ListScreen } from '@/components/layout/page-shell';
import { Button } from '@/components/ui/button';
import { ProjectRequiredState } from '@/components/layout/project-required-state';
import { Dot } from '@/components/ui/icon';
import { Inline } from '@/components/ui/layout';
import { QueryState } from '@/components/ui/query-state';
import { readErrorProps, type RetryableRead } from '@/components/ui/read-error';
import { queryKeys } from '@/lib/api/query-keys';
import { runsApi } from '@/lib/api/runs';
import type { Audit } from '@/lib/api/types';
import { useProjectHref } from '@/lib/navigation/project-destination';
import { useActiveProject } from '@/lib/project/project-context';
import { resolveActiveProjectRequestScope } from '@/lib/project/request-scope';
import { shouldPollAudit } from '@/lib/runs/status';

/** Poll interval (ms) for the runs list while any run is active. */
const POLL_INTERVAL_MS = 3_000;

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
    match: (audit) => shouldPollAudit(audit.status),
  },
  {
    id: 'failed',
    label: 'Failed',
    match: (audit) => audit.status === 'failed',
  },
];

/** Active-project run list, status filtering, launch, and schedule management. */
export function RunsScreen() {
  const project = useActiveProject();
  const scope = resolveActiveProjectRequestScope(project);
  const projectId = scope.projectId;
  const router = useNavigate();
  const projectHref = useProjectHref();
  const [launchOpen, setLaunchOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const runsQuery = useQuery({
    queryKey: queryKeys.runs.list({ project_id: projectId }),
    queryFn: ({ signal }) =>
      runsApi.listAudits({ project_id: projectId }, { signal, workspaceId: scope.workspaceId }),
    enabled: scope.enabled,
    refetchInterval: (query) => {
      const audits = query.state.data;
      return audits?.some((audit) => shouldPollAudit(audit.status)) ? POLL_INTERVAL_MS : false;
    },
  });

  const audits = useMemo(() => runsQuery.data ?? [], [runsQuery.data]);
  const filteredAudits = useMemo(
    () =>
      audits.filter(
        STATUS_FILTERS.find((filter) => filter.id === statusFilter)?.match ?? (() => true),
      ),
    [audits, statusFilter],
  );
  const anyActive = audits.some((audit) => shouldPollAudit(audit.status));

  // Gate only on the runs list: the schedules query errors independently
  // (and refetches whenever its card remounts onto the errored cache entry),
  // so gating the whole screen on it would pin the page on a spinner forever.
  // The page keeps its action and status filters while the first load lands.
  const actions = (
    <Button onClick={() => setLaunchOpen(true)} disabled={!projectId}>
      Launch audit
    </Button>
  );
  // Each status is a control the user presses, so it is a 32px pressed-state
  // button with 14px text, not a badge.
  const controls = {
    filters: (
      <fieldset className="contents" aria-label="Filter by status">
        {STATUS_FILTERS.map((filter) => (
          <Button
            key={filter.id}
            variant="secondary"
            aria-pressed={statusFilter === filter.id}
            onClick={() => setStatusFilter(filter.id)}
          >
            {filter.label}
            <span className="text-muted tabular-nums">{audits.filter(filter.match).length}</span>
          </Button>
        ))}
      </fieldset>
    ),
  };

  if (runsQuery.isLoading) {
    return (
      <ListScreen actions={actions} controls={controls}>
        <QueryState kind="loading" label="Loading runs…" />
      </ListScreen>
    );
  }

  return (
    <ListScreen actions={actions} controls={controls}>
      <RunsContent
        projectId={projectId}
        read={runsQuery}
        audits={audits}
        filteredAudits={filteredAudits}
        statusFilter={statusFilter}
        anyActive={anyActive}
        onLaunch={() => setLaunchOpen(true)}
      />

      {projectId && project ? (
        <AuditSchedules projectId={projectId} promptSets={project.prompt_sets} />
      ) : null}

      {projectId ? (
        <LaunchDialog
          open={launchOpen}
          onOpenChange={setLaunchOpen}
          projectId={projectId}
          onLaunched={(audit) => router(projectHref(`/runs/${audit.id}`))}
        />
      ) : null}
    </ListScreen>
  );
}

function RunsContent({
  projectId,
  read,
  audits,
  filteredAudits,
  statusFilter,
  anyActive,
  onLaunch,
}: Readonly<{
  projectId: string | null;
  /** The runs read: its failure, and the retry of exactly that read. */
  read: RetryableRead;
  audits: Audit[];
  filteredAudits: Audit[];
  statusFilter: StatusFilter;
  anyActive: boolean;
  onLaunch: () => void;
}>) {
  if (!projectId) return <ProjectRequiredState />;
  if (read.error) {
    return (
      <QueryState
        kind="error"
        {...readErrorProps(read)}
        fallback="Could not load runs. Check your connection and try again."
      />
    );
  }
  if (audits.length === 0) {
    return (
      <QueryState
        kind="empty"
        icon={Play}
        heading="No runs yet"
        description="Launch your first audit to measure how AI engines answer questions about your brand."
        action={<Button onClick={onLaunch}>Launch your first audit</Button>}
      />
    );
  }

  const filterLabel = STATUS_FILTERS.find(
    (filter) => filter.id === statusFilter,
  )?.label.toLowerCase();
  return (
    <RunsTable
      audits={filteredAudits}
      emptyHeading={`No ${filterLabel} runs.`}
      status={
        anyActive ? (
          <Inline as="span" className="type-caption inline-flex tabular-nums">
            <Dot className="bg-info animate-pulse" />
            {'polling every 3s while a run is active'}
          </Inline>
        ) : null
      }
    />
  );
}
