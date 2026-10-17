'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useState } from 'react';

import { ExecutionEvidenceDrawer } from '@/components/runs/execution-evidence-drawer';
import { RunActions, useRunExport } from '@/components/runs/progress-panel';
import { RunDetailView } from '@/components/runs/run-detail-view';
import { PageShell } from '@/components/layout/page-shell';
import { mutationNoticeForError } from '@/lib/api/mutation-notice';
import { queryKeys } from '@/lib/api/query-keys';
import { runsApi } from '@/lib/api/runs';
import { RUN_ACTIVE_POLL_MS } from '@/lib/config/runs';
import { useProjectHref } from '@/lib/navigation/project-destination';
import { useActiveWorkspaceId } from '@/lib/project/project-context';
import { useRunEvents } from '@/lib/runs/use-run-events';
import { shouldPollAudit } from '@/lib/runs/status';

/** Poll interval (ms) while a run is active. Polling remains the baseline. */
const POLL_INTERVAL_MS = RUN_ACTIVE_POLL_MS;

/** Active-run progress, cancellation, failed-execution reruns, and evidence selection. */
export function RunDetailScreen() {
  const params = useParams<{ runId: string }>();
  const router = useNavigate();
  const projectHref = useProjectHref();
  const searchParams = useSearchParams()[0];
  const runId = params.runId ?? '';
  const workspaceId = useActiveWorkspaceId();
  const queryClient = useQueryClient();
  const executionParam = searchParams.get('execution');
  const [selectedExecutionId, setSelectedExecutionId] = useState<string | null>(null);

  const auditQuery = useQuery({
    queryKey: queryKeys.runs.detail(runId),
    queryFn: ({ signal }) => runsApi.getAudit(runId, { signal, workspaceId }),
    enabled: workspaceId !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && shouldPollAudit(status) ? POLL_INTERVAL_MS : false;
    },
  });

  const active = auditQuery.data ? shouldPollAudit(auditQuery.data.status) : false;

  const executionsQuery = useQuery({
    queryKey: queryKeys.runs.executions(runId),
    queryFn: ({ signal }) => runsApi.listExecutions(runId, { signal, workspaceId }),
    enabled: workspaceId !== null,
    refetchInterval: active ? POLL_INTERVAL_MS : false,
  });

  // Stream is the accelerator; polling remains the reliable baseline.
  useRunEvents(runId, auditQuery.data?.project_id, active);

  const cancelMutation = useMutation({
    mutationFn: () => runsApi.cancelAudit(runId, { workspaceId }),
    onSuccess: (audit) => {
      queryClient.setQueryData(queryKeys.runs.detail(runId), audit);
      queryClient.invalidateQueries({
        queryKey: queryKeys.runs.executions(runId),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.runs.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.visibility.all });
    },
  });
  const rerunFailuresMutation = useMutation({
    mutationFn: () => runsApi.rerunFailures(runId, {}, { workspaceId }),
    onSuccess: (repairAudit) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.runs.all });
      router(projectHref(`/runs/${repairAudit.id}`));
    },
  });

  const executions = executionsQuery.data ?? [];
  // A matching URL selection wins over a transient in-table selection; a stale
  // URL selection never masks a valid selection made in this view.
  const activeExecutionId = executions.some((execution) => execution.id === executionParam)
    ? executionParam
    : selectedExecutionId;
  const selectedExecution =
    executions.find((execution) => execution.id === activeExecutionId) ?? null;

  const audit = auditQuery.data;
  const runExport = useRunExport(audit);

  return (
    <PageShell
      back={{ href: '/runs', label: 'Back to runs', projectId: audit?.project_id }}
      actions={
        audit ? (
          <RunActions
            audit={audit}
            cancelPending={cancelMutation.isPending}
            onCancel={() => cancelMutation.mutate()}
            onRerunFailures={() => rerunFailuresMutation.mutate()}
            rerunPending={rerunFailuresMutation.isPending}
            onExport={runExport.onExport}
            exporting={runExport.exporting}
          />
        ) : null
      }
    >
      <RunDetailView
        audit={audit}
        auditLoading={auditQuery.isLoading}
        auditRead={auditQuery}
        executions={executionsQuery.data}
        executionsLoading={executionsQuery.isLoading}
        executionsRead={executionsQuery}
        exportError={runExport.exportError}
        cancelNotice={
          cancelMutation.isError
            ? mutationNoticeForError(cancelMutation.error, {
                action: 'cancel the run',
              })
            : null
        }
        rerunNotice={
          rerunFailuresMutation.isError
            ? mutationNoticeForError(rerunFailuresMutation.error, {
                action: 'rerun failed executions',
              })
            : null
        }
        onCancel={() => cancelMutation.mutate()}
        onRerunFailures={() => rerunFailuresMutation.mutate()}
        onSelectEvidence={(execution) => setSelectedExecutionId(execution.id)}
      />
      <ExecutionEvidenceDrawer
        execution={selectedExecution}
        open={selectedExecution !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedExecutionId(null);
            if (searchParams.has('execution'))
              router(projectHref(`/runs/${runId}`), { replace: true });
          }
        }}
      />
    </PageShell>
  );
}
