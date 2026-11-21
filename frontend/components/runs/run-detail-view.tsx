import type { DataTableState } from '@/components/ui/data-table';
import { ExecutionsTable } from '@/components/runs/executions-table';
import { ProgressPanel, ProgressSkeleton } from '@/components/runs/progress-panel';
import { ICONS } from '@/lib/icons';
import type { MutationNotice } from '@/lib/api/mutation-notice';
import type { Audit, Execution } from '@citeladder/contracts';
import { readErrorProps, type RetryableRead } from '@/components/ui/notice';
import { StateBlock } from '@/components/ui/state-block';

type RunDetailViewProps = {
  audit: Audit | undefined;
  auditLoading: boolean;
  auditRead: RetryableRead;
  executions: Execution[] | undefined;
  executionsLoading: boolean;
  executionsRead: RetryableRead;
  exportError: string | null;
  cancelNotice: MutationNotice | null;
  rerunNotice: MutationNotice | null;
  onCancel: () => void;
  onRerunFailures: () => void;
  onSelectEvidence: (execution: Execution) => void;
};

function AuditSection({
  audit,
  auditLoading,
  auditRead,
  exportError,
  cancelNotice,
  rerunNotice,
  onCancel,
  onRerunFailures,
}: Readonly<RunDetailViewProps>) {
  if (auditRead.error && !audit) {
    return (
      <StateBlock
        kind="error"
        {...readErrorProps(auditRead)}
        title="Couldn't load this run"
        fallback="Check your connection and try again."
      />
    );
  }
  if (auditLoading || !audit) return <ProgressSkeleton />;
  return (
    <ProgressPanel
      audit={audit}
      exportError={exportError}
      cancelNotice={cancelNotice}
      onCancelRetry={onCancel}
      rerunNotice={rerunNotice}
      onRerunRetry={onRerunFailures}
    />
  );
}

function executionsState({
  executions,
  executionsLoading,
  executionsRead,
}: Pick<RunDetailViewProps, 'executions' | 'executionsLoading' | 'executionsRead'>):
  | DataTableState
  | undefined {
  if (executionsRead.error && !executions) {
    return {
      kind: 'error',
      ...readErrorProps(executionsRead),
      title: "Couldn't load the executions",
      fallback: 'Check your connection and try again.',
    };
  }
  if (executionsLoading || !executions) return { kind: 'loading', label: 'Loading executions…' };
  if (executions.length === 0) {
    return {
      kind: 'empty',
      headingLevel: 3,
      icon: ICONS.runs,
      heading: 'No executions yet',
    };
  }
  return undefined;
}

export function RunDetailView(props: Readonly<RunDetailViewProps>) {
  if (props.auditRead.error && !props.audit && !props.executions)
    return <AuditSection {...props} />;
  if (!props.audit && !props.auditRead.error) return <AuditSection {...props} />;
  return (
    <>
      <AuditSection {...props} />
      <ExecutionsTable
        executions={props.executions ?? []}
        state={executionsState(props)}
        onSelectEvidence={props.onSelectEvidence}
      />
    </>
  );
}
