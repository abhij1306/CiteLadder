'use client';

import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { MeasurementContext } from '@/components/runs/measurement-context';
import { ENGINE_LABELS } from '@/lib/providers/catalog';
import { marketLabel } from '@citeladder/contracts/markets';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dot } from '@/components/ui/icon';
import { Inline, Stack } from '@/components/ui/layout';
import { Meter } from '@/components/ui/meter';
import { MutationNotice } from '@/components/ui/mutation-notice';
import { StatRow } from '@/components/ui/stat-row';
import { humanizeApiError } from '@/lib/api/errors';
import type { MutationNotice as MutationNoticeData } from '@/lib/api/mutation-notice';
import { runsApi } from '@/lib/api/runs';
import type { Audit } from '@/lib/api/types';
import { saveBlob } from '@/lib/download';
import { useDisplayTimeZone } from '@/lib/display-timezone';
import {
  auditBadgeValue,
  auditStatusLabel,
  formatDateTime,
  isAuditCancelable,
  shouldPollAudit,
} from '@/lib/runs/status';

type ExportFormat = 'csv' | 'md';

/**
 * Authenticated CSV/MD export state for one run. Exports use the audit's
 * persisted workspace identity rather than a headerless navigation that could
 * resolve another workspace. The route owns this so its actions can live in the
 * page's identity band while the panel still reports an export failure.
 */
export function useRunExport(audit: Audit | undefined) {
  // The route stays mounted across runs (a repair run is a navigation, not a
  // remount), so each state belongs to the run it was started for and is ignored
  // once the reader is looking at another one.
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

/**
 * The run's actions: exports, a Cancel enabled only while the backend still
 * accepts a cooperative cancel (i.e. not `reporting`/terminal), and a failure
 * rerun when something failed. Rendered in the route's identity band.
 */
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
  onCancel: () => void;
  onRerunFailures?: () => void;
  rerunPending?: boolean;
  onExport: (format: ExportFormat) => void;
  exporting: ExportFormat | null;
}>) {
  const cancelable = isAuditCancelable(audit.status);
  return (
    <>
      <Button variant="secondary" onClick={() => onExport('csv')} disabled={exporting !== null}>
        {exporting === 'csv' ? 'Exporting…' : 'Export CSV'}
      </Button>
      <Button variant="secondary" onClick={() => onExport('md')} disabled={exporting !== null}>
        {exporting === 'md' ? 'Exporting…' : 'Export MD'}
      </Button>
      <Button variant="destructive" onClick={onCancel} disabled={!cancelable || cancelPending}>
        {cancelPending ? 'Cancelling…' : 'Cancel run'}
      </Button>
      {audit.failed_count > 0 && onRerunFailures ? (
        <Button variant="secondary" onClick={onRerunFailures} disabled={rerunPending}>
          {rerunPending ? 'Creating repair…' : 'Rerun failed'}
        </Button>
      ) : null}
    </>
  );
}

function ProgressStatus({ audit, polling }: Readonly<{ audit: Audit; polling: boolean }>) {
  return (
    <Inline className="flex-wrap">
      <Badge variant="run-status" value={auditBadgeValue(audit.status)}>
        {auditStatusLabel(audit.status)}
      </Badge>
      <Badge variant="neutral">{marketLabel(audit.market)}</Badge>
      <MeasurementContext provenance={audit.model_provenance} />
      {audit.not_applicable_engines.length ? (
        <Badge variant="neutral">
          Not available in this market:{' '}
          {audit.not_applicable_engines.map((engine) => ENGINE_LABELS[engine]).join(', ')}
        </Badge>
      ) : null}
      {polling ? (
        <Inline as="span" className="type-caption inline-flex tabular-nums" aria-live="polite">
          <Dot className="activity-dot bg-info" />
          {'Updating…'}
        </Inline>
      ) : null}
    </Inline>
  );
}

function ProgressBar({
  requested,
  completed,
}: Readonly<{
  requested: number;
  completed: number;
}>) {
  const percent = requested > 0 ? Math.min(100, Math.round((completed / requested) * 100)) : 0;

  return (
    <Stack gap="tight">
      <div className="type-caption flex justify-between">
        <span>Progress</span>
        <span>{percent}%</span>
      </div>
      <Meter kind="progress" tone="info" label="Progress" value={percent} />
    </Stack>
  );
}

function ProgressMetrics({ audit }: Readonly<{ audit: Audit }>) {
  const timeZone = useDisplayTimeZone();
  return (
    <StatRow
      segments={[
        { key: 'requested', label: 'Requested', value: audit.requested_count },
        {
          key: 'completed',
          label: 'Completed',
          value: audit.completed_count,
          tone: 'success',
        },
        {
          key: 'failed',
          label: 'Failed',
          value: audit.failed_count,
          tone: audit.failed_count > 0 ? 'danger' : 'muted',
        },
        { key: 'created', label: 'Created', value: formatDateTime(audit.created_at, timeZone) },
      ]}
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
      {errorMessage ? <p className="type-body text-danger-text">{errorMessage}</p> : null}
      {cancelNotice ? <MutationNotice notice={cancelNotice} onRetry={onCancelRetry} /> : null}
      {rerunNotice ? <MutationNotice notice={rerunNotice} onRetry={onRerunRetry} /> : null}
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
  /** A failed export from `useRunExport`. */
  exportError?: string | null;
  /** The A4 mutation notice for a failed cancel (verbatim 4xx, transient retry). */
  cancelNotice?: MutationNoticeData | null;
  /** Retry affordance for a transient cancel failure. */
  onCancelRetry?: () => void;
  rerunNotice?: MutationNoticeData | null;
  onRerunRetry?: () => void;
}>) {
  const polling = shouldPollAudit(audit.status);

  return (
    <Card>
      <CardContent>
        <Stack gap="workspace">
          <ProgressStatus audit={audit} polling={polling} />

          {polling && audit.requested_count > 0 ? (
            <ProgressBar requested={audit.requested_count} completed={audit.completed_count} />
          ) : null}

          <ProgressMetrics audit={audit} />

          <ProgressNotices
            errorMessage={exportError ?? audit.error_message}
            cancelNotice={cancelNotice}
            onCancelRetry={onCancelRetry}
            rerunNotice={rerunNotice}
            onRerunRetry={onRerunRetry}
          />
        </Stack>
      </CardContent>
    </Card>
  );
}
