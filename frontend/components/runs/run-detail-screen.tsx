'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useState } from 'react';

import { ExecutionEvidenceDrawer } from '@/components/runs/execution-evidence-drawer';
import { RunActions, useRunExport } from '@/components/runs/progress-panel';
import { RunDetailView } from '@/components/runs/run-detail-view';
import { DetailScreen } from '@/components/layout/page-shell';
import { mutationNoticeForError } from '@/lib/api/mutation-notice';
import { runsMutations, runsQueries } from '@/lib/api/runs';
import { useProjectHref } from '@/lib/navigation/project-destination';
import { useActiveWorkspaceId } from '@/lib/project/project-context';
import { useRunEvents } from '@/lib/runs/use-run-events';
import { useRunExecutions } from '@/lib/runs/use-run-executions';
import { AUDIT_STATES, pollAudits } from '@/lib/runs/status';

/** Active-run progress, cancellation, failed-execution reruns, and evidence selection. */
export function RunDetailScreen() {
  const params = useParams<{ runId: string }>();
  const router = useNavigate();
  const projectHref = useProjectHref();
  const searchParams = useSearchParams()[0];
  const runId = params.runId ?? '';
  const workspaceId = useActiveWorkspaceId();
  const executionParam = searchParams.get('execution');
  const [selectedExecutionId, setSelectedExecutionId] = useState<string | null>(null);

  const auditQuery = useQuery({
    ...runsQueries.detail(workspaceId, runId),
    enabled: workspaceId !== null,
    // Polling remains the baseline; the run's event stream only accelerates it.
    refetchInterval: (query) => pollAudits(query.state.data?.status),
  });

  const active = auditQuery.data ? AUDIT_STATES[auditQuery.data.status].active : false;

  // Only the audit row polls; the executions list follows its progress.
  const executionsQuery = useRunExecutions(runId, auditQuery.data);

  // Stream is the accelerator; polling remains the reliable baseline.
  useRunEvents(runId, auditQuery.data?.project_id, active);

  const cancelMutation = useMutation(runsMutations.cancel(workspaceId, runId));
  const rerunFailuresMutation = useMutation(runsMutations.rerunFailures(workspaceId, runId));
  const rerunFailures = () =>
    rerunFailuresMutation.mutate(undefined, {
      onSuccess: (repairAudit) => router(projectHref(`/runs/${repairAudit.id}`)),
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
    <DetailScreen
      back={{ href: '/runs', label: 'Back to runs', projectId: audit?.project_id }}
      actions={
        audit ? (
          <RunActions
            audit={audit}
            cancelPending={cancelMutation.isPending}
            onCancel={() => cancelMutation.mutate()}
            onRerunFailures={rerunFailures}
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
        onRerunFailures={rerunFailures}
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
    </DetailScreen>
  );
}
