import { useState, type ReactNode } from 'react';

import { StatusMark } from '@/components/ui/status-mark';
import { Tag } from '@/components/ui/tag';
import { MeasurementContext } from '@/components/runs/measurement-context';
import { CircleStop, Download, RotateCcw } from '@/lib/icons';
import { useEngineCatalog } from '@/lib/providers/engines';
import { marketLabel } from '@citeladder/contracts/markets';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { MastheadPrimary } from '@/components/ui/masthead-actions';
import { Skeleton } from '@/components/ui/skeleton';
import { Inline, Stack } from '@/components/ui/layout';
import { Spinner } from '@/components/ui/spinner';
import { RungMeter } from '@/components/ui/rung-meter';
import { humanizeApiError } from '@/lib/api/errors';
import type { MutationNotice as MutationNoticeData } from '@/lib/api/mutation-notice';
import { runsApi } from '@/lib/api/runs';
import type { Audit } from '@citeladder/contracts';
import { saveBlob } from '@/lib/download';
import { useDisplayTimeZone } from '@/lib/display-timezone';
import { formatCount, formatDisplayTime } from '@/lib/format';
import { AUDIT_STATES } from '@/lib/runs/status';
import { Notice } from '@/components/ui/notice';
import { FigureStrip } from '@/components/ui/figure-strip';

type ExportFormat = 'csv' | 'md';

export function useRunExport(audit: Audit | undefined) {
  const [exporting, setExporting] = useState<{ auditId: string; format: ExportFormat } | null>(
    null,
  );
  const [exportError, setExportError] = useState<{ auditId: string; message: string } | null>(null);

  async function download(format: ExportFormat) {
    if (!audit) return;
    const auditId = audit.id;
    setExporting({ auditId, format });
    setExportError(null);
    try {
      const blob = await runsApi.downloadExport(auditId, format, {
        workspaceId: audit.workspace_id,
      });
      saveBlob(blob, `audit-${auditId}.${format}`);
    } catch (error) {
      setExportError({ auditId, message: humanizeApiError(error).message });
    } finally {
      setExporting((current) => (current?.auditId === auditId ? null : current));
    }
  }

  const current = audit?.id;
  return {
    exporting: exporting && exporting.auditId === current ? exporting.format : null,
    exportError: exportError && exportError.auditId === current ? exportError.message : null,
    onExport: (format: ExportFormat) => void download(format),
  };
}

export function RunActions({
  audit,
  cancelPending,
  onCancel,
  onRerunFailures,
  rerunPending = false,
  onExport,
  exporting,
}: Readonly<{
  audit: Audit;
  cancelPending: boolean;
  onCancel?: () => void;
  onRerunFailures?: () => void;
  rerunPending?: boolean;
  onExport: (format: ExportFormat) => void;
  exporting: ExportFormat | null;
}>) {
  const { cancelable } = audit;
  return (
    <>
      <Button variant="secondary" onClick={() => onExport('csv')} disabled={exporting !== null}>
        <Icon icon={Download} />
        {exporting === 'csv' ? 'Exporting…' : 'Export CSV'}
      </Button>
      <Button variant="secondary" onClick={() => onExport('md')} disabled={exporting !== null}>
        <Icon icon={Download} />
        {exporting === 'md' ? 'Exporting…' : 'Export MD'}
      </Button>
      {onCancel && (cancelable || cancelPending) ? (
        <Button variant="danger" onClick={onCancel} disabled={cancelPending}>
          <Icon icon={CircleStop} />
          {cancelPending ? 'Cancelling…' : 'Cancel run'}
        </Button>
      ) : null}
      {audit.failed_count > 0 && onRerunFailures ? (
        <RerunFailed
          primary={audit.status === 'failed'}
          onRerun={onRerunFailures}
          pending={rerunPending}
        />
      ) : null}
    </>
  );
}

function RerunFailed({
  primary,
  onRerun,
  pending,
}: Readonly<{ primary: boolean; onRerun: () => void; pending: boolean }>) {
  const button = (
    <Button variant={primary ? 'primary' : 'secondary'} onClick={onRerun} disabled={pending}>
      <Icon icon={RotateCcw} />
      {pending ? 'Creating repair…' : 'Rerun failed'}
    </Button>
  );
  return primary ? <MastheadPrimary>{button}</MastheadPrimary> : button;
}

export function ProgressSkeleton() {
  return (
    <FigureStrip
      label="Run figures"
      lead={<Skeleton variant="text" lines={1} label="Loading run" />}
      segments={RUN_FIGURES.map(({ key, label }) => ({ key, label, value: null, loading: true }))}
    />
  );
}

function ProgressStatus({ audit, polling }: Readonly<{ audit: Audit; polling: boolean }>) {
  const engines = useEngineCatalog();
  const timeZone = useDisplayTimeZone();
  return (
    <Inline className="flex-wrap">
      <span className="type-body text-ink-2">
        Started {formatDisplayTime(audit.created_at, timeZone)}
      </span>
      <StatusMark variant="run-status" value={AUDIT_STATES[audit.status].badge}>
        {AUDIT_STATES[audit.status].label}
      </StatusMark>
      <Tag>{marketLabel(audit.market)}</Tag>
      <MeasurementContext provenance={audit.model_provenance} />
      {audit.not_applicable_engines.length ? (
        <Tag>
          Not available in this market: {audit.not_applicable_engines.map(engines.label).join(', ')}
        </Tag>
      ) : null}
      {polling ? <Spinner label="Updating…" showLabel /> : null}
    </Inline>
  );
}

function RunProgress({
  requested,
  finished,
}: Readonly<{
  requested: number;
  finished: number;
}>) {
  const percent = requested > 0 ? Math.min(100, Math.round((finished / requested) * 100)) : 0;

  return <RungMeter label="Progress" value={percent} />;
}

const RUN_FIGURES = [
  { key: 'requested', label: 'Requested', count: (audit: Audit) => audit.requested_count },
  { key: 'completed', label: 'Completed', count: (audit: Audit) => audit.completed_count },
  { key: 'failed', label: 'Failed', count: (audit: Audit) => audit.failed_count },
] as const;

function ProgressMetrics({ audit, lead }: Readonly<{ audit: Audit; lead: ReactNode }>) {
  return (
    <FigureStrip
      label="Run figures"
      lead={lead}
      segments={RUN_FIGURES.map(({ key, label, count }) => ({
        key,
        label,
        value: formatCount(count(audit)),
      }))}
    />
  );
}

function ProgressNotices({
  errorMessage,
  cancelNotice,
  onCancelRetry,
  rerunNotice,
  onRerunRetry,
}: Readonly<{
  errorMessage?: string | null;
  cancelNotice?: MutationNoticeData | null;
  onCancelRetry?: () => void;
  rerunNotice?: MutationNoticeData | null;
  onRerunRetry?: () => void;
}>) {
  return (
    <>
      {errorMessage ? <Notice tone="negative">{errorMessage}</Notice> : null}
      {cancelNotice ? (
        <Notice kind="mutation" notice={cancelNotice} onRetry={onCancelRetry} />
      ) : null}
      {rerunNotice ? <Notice kind="mutation" notice={rerunNotice} onRetry={onRerunRetry} /> : null}
    </>
  );
}

/**
 * Run progress panel.
 *
 * Shows the audit's status badge, the requested/completed/failed counts, the
 * created timestamp, and the outcome of the run's actions (export, cancel and
 * rerun failures). The actions themselves are `RunActions`, rendered by the
 * route in its identity band. Progress is driven by the parent's polling of
 * `GET /audits/{id}`.
 */
export function ProgressPanel({
  audit,
  exportError,
  cancelNotice,
  onCancelRetry,
  rerunNotice,
  onRerunRetry,
}: Readonly<{
  audit: Audit;
  exportError?: string | null;
  cancelNotice?: MutationNoticeData | null;
  onCancelRetry?: () => void;
  rerunNotice?: MutationNoticeData | null;
  onRerunRetry?: () => void;
}>) {
  const polling = AUDIT_STATES[audit.status].active;

  return (
    <Stack gap="workspace">
      <ProgressMetrics
        audit={audit}
        lead={
          <Stack>
            <ProgressStatus audit={audit} polling={polling} />
            {polling && audit.requested_count > 0 ? (
              <RunProgress
                requested={audit.requested_count}
                finished={audit.completed_count + audit.failed_count}
              />
            ) : null}
          </Stack>
        }
      />
      <ProgressNotices
        errorMessage={exportError ?? audit.error_message}
        cancelNotice={cancelNotice}
        onCancelRetry={onCancelRetry}
        rerunNotice={rerunNotice}
        onRerunRetry={onRerunRetry}
      />
    </Stack>
  );
}
