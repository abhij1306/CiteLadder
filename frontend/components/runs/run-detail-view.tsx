import { Card, CardContent } from '@/components/ui/card';
import { Stack } from '@/components/ui/layout';
import { QueryState } from '@/components/ui/query-state';
import { readErrorProps, type RetryableRead } from '@/components/ui/read-error';
import { EditorialSectionHeader } from '@/components/ui/workspace';
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

function ExecutionsSection({
  executions,
  executionsLoading,
  executionsRead,
  onSelectEvidence,
}: Readonly<
  Pick<
    RunDetailViewProps,
    'executions' | 'executionsLoading' | 'executionsRead' | 'onSelectEvidence'
  >
>) {
  if (executionsRead.error && !executions) {
    return (
      <QueryState
        kind="error"
        {...readErrorProps(executionsRead)}
        fallback="Could not load executions."
      />
    );
  }
  if (executionsLoading || !executions) {
    return <QueryState kind="loading" label="Loading executions…" />;
  }
  if (executions.length === 0) {
    return (
      <QueryState
        kind="empty"
        headingLevel={3}
        icon={ICONS.runs}
        heading="No executions yet."
        description="They appear as the run is planned and processed."
      />
    );
  }
  return (
    <Card>
      <CardContent>
        <ExecutionsTable executions={executions} onSelectEvidence={onSelectEvidence} />
      </CardContent>
    </Card>
  );
}

export function RunDetailView(props: Readonly<RunDetailViewProps>) {
  return (
    <Stack gap="section">
      <AuditSection {...props} />
      <Stack gap="compact">
        <EditorialSectionHeader title="Executions" />
        <ExecutionsSection {...props} />
      </Stack>
    </Stack>
  );
}
