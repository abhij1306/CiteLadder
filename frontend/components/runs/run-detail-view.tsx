import type { DataTableState } from '@/components/ui/data-table';
import { Stack } from '@/components/ui/layout';
import { QueryState } from '@/components/ui/query-state';
import { readErrorProps, type RetryableRead } from '@/components/ui/read-error';
import { ExecutionsTable } from '@/components/runs/executions-table';
import { ProgressPanel } from '@/components/runs/progress-panel';
import { ICONS } from '@/lib/icons';
import type { MutationNotice } from '@/lib/api/mutation-notice';
import type { Audit, Execution } from '@/lib/api/types';

type RunDetailViewProps = {
  audit: Audit | undefined;
  auditLoading: boolean;
  /** The audit read: its failure, and the retry of exactly that read. */
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
      <QueryState
        kind="error"
        {...readErrorProps(auditRead)}
        fallback="Something went wrong. Please try again."
      />
    );
  }
  if (auditLoading || !audit) {
    return <QueryState kind="loading" label="Loading run…" />;
  }
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

/** What the executions table shows instead of rows, if anything. */
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
      fallback: 'Could not load executions.',
    };
  }
  if (executionsLoading || !executions) return { kind: 'loading', label: 'Loading executions…' };
  if (executions.length === 0) {
    return {
      kind: 'empty',
      headingLevel: 3,
      icon: ICONS.runs,
      heading: 'No executions yet',
      description: 'They appear as the run is planned and processed.',
    };
  }
  return undefined;
}

export function RunDetailView(props: Readonly<RunDetailViewProps>) {
  return (
    <Stack gap="workspace">
      <AuditSection {...props} />
      <ExecutionsTable
        executions={props.executions ?? []}
        state={executionsState(props)}
        onSelectEvidence={props.onSelectEvidence}
      />
    </Stack>
  );
}
