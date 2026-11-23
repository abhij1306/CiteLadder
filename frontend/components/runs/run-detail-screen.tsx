import { useMutation, useQuery } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { useState } from 'react';

import { AnswerDialog } from '@/components/runs/answer-dialog';
import { RunActions, useRunExport } from '@/components/runs/progress-panel';
import { RunDetailView } from '@/components/runs/run-detail-view';
import { NotFoundScreen } from '@/components/templates/not-found-screen';
import { RecordPage } from '@/components/templates/record-page';
import { useDisplayTimeZone } from '@/lib/display-timezone';
import { isNotFound } from '@/lib/api/errors';
import { useUrlParam } from '@/lib/navigation/url-params';
import { mutationNoticeForError } from '@/lib/api/mutation-notice';
import { runsMutations, runsQueries } from '@/lib/api/runs';
import { useProjectHref } from '@/lib/navigation/project-destination';
import { useProjectScope } from '@/lib/project/active-project-scope';
import { useWorkspaceCapability } from '@/lib/project/project-context';
import { useRunEvents } from '@/lib/runs/use-run-events';
import { useRunExecutions } from '@/lib/runs/use-run-executions';
import { AUDIT_STATES, pollAudits, runTitle } from '@/lib/runs/status';

const failureNotice = (mutation: Readonly<{ isError: boolean; error: unknown }>, action: string) =>
  mutation.isError ? mutationNoticeForError(mutation.error, { action }) : null;

export function RunDetailScreen() {
  const params = useParams<{ runId: string }>();
  const router = useNavigate();
  const projectHref = useProjectHref();
  const runId = params.runId ?? '';
  const { workspaceId } = useProjectScope();
  const executionParam = useUrlParam('execution');
  const [selectedExecutionId, setSelectedExecutionId] = useState<string | null>(null);

  const auditQuery = useQuery({
    ...runsQueries.detail(workspaceId, runId),
    refetchInterval: (query) => pollAudits(query.state.data?.status),
  });

  const active = auditQuery.data ? AUDIT_STATES[auditQuery.data.status].active : false;

  const executionsQuery = useRunExecutions(runId, auditQuery.data);

  useRunEvents(runId, auditQuery.data?.project_id, active);

  const canRun = useWorkspaceCapability('run');
  const cancelMutation = useMutation(runsMutations.cancel(workspaceId, runId));
  const rerunFailuresMutation = useMutation(runsMutations.rerunFailures(workspaceId, runId));
  const rerunFailures = () =>
    rerunFailuresMutation.mutate(undefined, {
      onSuccess: (repairAudit) => router(projectHref(`/runs/${repairAudit.id}`)),
    });

  const executions = executionsQuery.data ?? [];
  const activeExecutionId = executions.some((execution) => execution.id === executionParam)
    ? executionParam
    : selectedExecutionId;
  const selectedExecution =
    executions.find((execution) => execution.id === activeExecutionId) ?? null;

  const audit = auditQuery.data;
  const runExport = useRunExport(audit);
  const timeZone = useDisplayTimeZone();
  const title = audit ? runTitle(audit, timeZone) : undefined;

  if (isNotFound(auditQuery.error)) return <NotFoundScreen />;
  return (
    <RecordPage
      title={title}
      actions={
        audit ? (
          <RunActions
            audit={audit}
            cancelPending={cancelMutation.isPending}
            onCancel={canRun ? () => cancelMutation.mutate() : undefined}
            onRerunFailures={canRun ? rerunFailures : undefined}
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
        cancelNotice={failureNotice(cancelMutation, 'cancel the run')}
        rerunNotice={failureNotice(rerunFailuresMutation, 'rerun failed executions')}
        onCancel={() => cancelMutation.mutate()}
        onRerunFailures={rerunFailures}
        onSelectEvidence={(execution) => setSelectedExecutionId(execution.id)}
      />
      <AnswerDialog
        execution={selectedExecution}
        open={selectedExecution !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedExecutionId(null);
            if (executionParam !== null) router(projectHref(`/runs/${runId}`), { replace: true });
          }
        }}
      />
    </RecordPage>
  );
}
