import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Stack } from '@/components/ui/layout';
import { ReadError, readErrorProps, type RetryableRead } from '@/components/ui/read-error';
import { Skeleton } from '@/components/ui/skeleton';
import { EditorialSectionHeader } from '@/components/ui/workspace';
import { ExecutionsTable } from '@/components/runs/executions-table';
import { ProgressPanel } from '@/components/runs/progress-panel';
import { PageLoading } from '@/components/layout/page-loading';
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
      <ReadError
        {...readErrorProps(auditRead)}
        fallback="Something went wrong. Please try again."
      />
    );
  }
  if (auditLoading || !audit) {
    return <PageLoading label="Loading run…" />;
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
    return <ReadError {...readErrorProps(executionsRead)} fallback="Could not load executions." />;
  }
  if (executionsLoading || !executions) {
    return (
      <Card>
        <CardContent className="grid gap-3">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </CardContent>
      </Card>
    );
  }
  if (executions.length === 0) {
    return (
      <EmptyState
        variant="compact"
        headingLevel={3}
        icon={ICONS.runs}
        heading="No executions yet."
        description="They appear as the run is planned and processed."
      />
    );
  }
  return (
    <Card>
      <CardContent flush>
        <ExecutionsTable executions={executions} onSelectEvidence={onSelectEvidence} />
      </CardContent>
    </Card>
  );
}

export function RunDetailView(props: Readonly<RunDetailViewProps>) {
  return (
    <Stack gap="workspace">
      <AuditSection {...props} />
      <Stack gap="compact">
        <EditorialSectionHeader title="Executions" />
        <ExecutionsSection {...props} />
      </Stack>
    </Stack>
  );
}
