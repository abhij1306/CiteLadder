'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';

import { BackfillProgress } from '@/components/settings/backfill-progress';
import { PROVIDER_META, type GrantModel } from '@/components/settings/grant-model';
import { useRefreshAfterMapping } from '@/components/integrations/data-sources';
import { useProjectContext } from '@/lib/project/project-context';
import { PropertyPicker, useActiveMapping } from '@/components/settings/property-picker';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { integrationsApi, type IntegrationConnection } from '@/lib/api/integrations';
import { queryKeys } from '@/lib/api/query-keys';
import { humanizeApiError } from '@/lib/api/errors';
import { formatCount, formatShortDate } from '@/lib/format';
import { DisplayTime } from '@/components/ui/display-time';
import {
  isActiveSyncRun,
  isSyncInFlight,
  SYNC_RUN_BADGE,
  SYNC_RUN_POLL_MS,
} from '@/lib/integrations/sync-runs';
import { textRole } from '@/components/ui/typography';
import { panelClasses } from '@/components/ui/panel';

type ConnectionMutation = {
  isPending: boolean;
  isError: boolean;
  error: unknown;
  mutate: () => void;
};
type SyncRun = Awaited<ReturnType<typeof integrationsApi.getSync>>;

const SYNC_RUN_LABEL: Record<SyncRun['status'], string> = {
  queued: 'Queued',
  leased: 'Starting',
  running: 'Running',
  retry_wait: 'Retrying',
  succeeded: 'Succeeded',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

function waitingLabel(status: SyncRun['status']): string {
  if (status === 'leased') return 'assigned to a worker';
  if (status === 'retry_wait') return 'awaiting retry';
  return 'waiting for a worker';
}

/** Test failures in words; the provider code stays out of the UI. */
const TEST_FAILURE: Record<string, string> = {
  grant_auth_failed: 'The provider refused this grant. Reconnect to renew consent.',
  token_refresh_failed: 'The provider did not renew access. Try again, or reconnect.',
  property_not_accessible: 'This account can no longer read the selected property.',
  rate_limited: 'The provider is rate limiting requests. Try again in a few minutes.',
};

function ConnectionActions({
  connection,
  grant,
  label,
  Icon,
  busy,
  hasProperty,
  runInFlight,
  testPending,
  syncPending,
  removePending,
  onTest,
  onSync,
  onRemove,
}: Readonly<{
  connection: IntegrationConnection;
  grant: GrantModel;
  label: string;
  Icon: LucideIcon;
  busy: boolean;
  hasProperty: boolean;
  runInFlight: boolean;
  testPending: boolean;
  syncPending: boolean;
  removePending: boolean;
  onTest: () => void;
  onSync: () => void;
  onRemove: () => void;
}>) {
  const syncDisabled = busy || runInFlight || !hasProperty || grant.status !== 'connected';

  return (
    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span
          aria-hidden
          className="bg-well border-border text-secondary mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-control)] border"
        >
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className={textRole('itemTitle', 'truncate')}>{label}</div>
          <PropertyPicker connection={connection} disabled={busy} />
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 self-end sm:self-auto">
        <Button
          variant="secondary"
          className="min-w-14"
          onClick={onTest}
          disabled={busy}
          aria-label={`Test ${label}`}
        >
          {testPending ? 'Testing…' : 'Test'}
        </Button>
        <Button
          variant="secondary"
          className="min-w-22"
          onClick={onSync}
          title={hasProperty ? undefined : 'Select a property first'}
          disabled={syncDisabled}
          pending={syncPending}
          pendingLabel="Syncing…"
          aria-label={`Sync ${label} now`}
        >
          Sync now
        </Button>
        {hasProperty ? (
          <Button
            variant="destructiveGhost"
            onClick={onRemove}
            disabled={busy}
            pending={removePending}
            pendingLabel="Removing…"
            aria-label={`Remove ${label} property from this project`}
          >
            Remove
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** The latest sync from this card: waiting, importing, building reports, then its result. */
function RunSummary({ run, runActive }: Readonly<{ run: SyncRun; runActive: boolean }>) {
  const rows = `${formatCount(run.row_count)} rows`;
  const window = `window ${formatShortDate(run.window_start)}–${formatShortDate(run.window_end)}`;
  if (runActive)
    return (
      <div className="flex items-center gap-2">
        <Badge variant="run-status" value={SYNC_RUN_BADGE[run.status]}>
          {SYNC_RUN_LABEL[run.status]}
        </Badge>
        <span className="type-caption whitespace-nowrap tabular-nums">
          {run.status === 'running' ? (
            `${rows} · ${window}`
          ) : (
            <>
              Enqueued <DisplayTime value={run.created_at} /> · {waitingLabel(run.status)}
            </>
          )}
        </span>
      </div>
    );
  if (run.processing)
    return (
      <div className="flex items-center gap-2">
        <Badge variant="run-status" value="running">
          Processing
        </Badge>
        <span className="type-caption whitespace-nowrap tabular-nums">
          {`${rows} imported · updating reports`}
        </span>
      </div>
    );
  return (
    <div className="flex items-center gap-2">
      <Badge variant="run-status" value={SYNC_RUN_BADGE[run.status]}>
        {SYNC_RUN_LABEL[run.status]}
      </Badge>
      <span className="type-caption whitespace-nowrap tabular-nums">
        {run.status === 'succeeded' ? `${rows} imported · ${window}` : run.error_detail || window}
      </span>
    </div>
  );
}

function ConnectionMetadata({
  connection,
  activeRun,
  runActive,
}: Readonly<{
  connection: IntegrationConnection;
  activeRun: SyncRun | null;
  runActive: boolean;
}>) {
  return (
    <div className="border-border-subtle flex flex-wrap items-center justify-between gap-2 border-t pt-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-2">
          <span className={textRole('label')}>Last synced</span>
          <span className="type-caption tabular-nums">
            <DisplayTime value={connection.last_synced_at} fallback="Never" />
          </span>
        </div>
        <BackfillProgress workspaceId={connection.workspace_id} connectionId={connection.id} />
      </div>
      {activeRun ? <RunSummary run={activeRun} runActive={runActive} /> : null}
    </div>
  );
}

function ConnectionRowView({
  connection,
  grant,
  testMutation,
  syncMutation,
  removeMutation,
  testState,
  activeRun,
  runActive,
  runInFlight,
  busy,
  hasProperty,
}: Readonly<{
  connection: IntegrationConnection;
  grant: GrantModel;
  testMutation: ConnectionMutation;
  syncMutation: ConnectionMutation;
  removeMutation: ConnectionMutation;
  testState: { ok: boolean; message: string } | null;
  activeRun: SyncRun | null;
  runActive: boolean;
  runInFlight: boolean;
  busy: boolean;
  hasProperty: boolean;
}>) {
  const { label, Icon } = PROVIDER_META[connection.provider];

  return (
    <div
      className={panelClasses({ pad: 'compact' })}
      data-testid={`connection-row-${connection.provider}`}
    >
      <ConnectionActions
        connection={connection}
        grant={grant}
        label={label}
        Icon={Icon}
        busy={busy}
        hasProperty={hasProperty}
        runInFlight={runInFlight}
        testPending={testMutation.isPending}
        syncPending={syncMutation.isPending}
        removePending={removeMutation.isPending}
        onTest={testMutation.mutate}
        onSync={syncMutation.mutate}
        onRemove={removeMutation.mutate}
      />
      <ConnectionMetadata connection={connection} activeRun={activeRun} runActive={runActive} />
      {testState ? (
        <div className="pt-3">
          <Alert tone={testState.ok ? 'success' : 'danger'}>{testState.message}</Alert>
        </div>
      ) : null}
      {syncMutation.isError || removeMutation.isError ? (
        <div className="pt-3">
          <Alert tone="danger">
            {humanizeApiError(syncMutation.error ?? removeMutation.error).message}
          </Alert>
        </div>
      ) : null}
    </div>
  );
}

/** Polling and mutation owner for one connection on an OAuth grant. */
export function ConnectionRow({
  connection,
  grant,
}: Readonly<{ connection: IntegrationConnection; grant: GrantModel }>) {
  const queryClient = useQueryClient();
  const [testState, setTestState] = useState<{ ok: boolean; message: string } | null>(null);
  const { activeProject } = useProjectContext();
  const refreshAfterMapping = useRefreshAfterMapping();
  const mapping = useActiveMapping(
    connection.workspace_id,
    connection.id,
    activeProject?.id ?? null,
  );
  const [activeSyncId, setActiveSyncId] = useState<string | null>(null);
  const testMutation = useMutation({
    mutationFn: () => integrationsApi.test(connection.id, { workspaceId: connection.workspace_id }),
    onSuccess: (result) => {
      setTestState(
        result.status === 'ok'
          ? { ok: true, message: 'Connection succeeded.' }
          : {
              ok: false,
              message: `Connection failed. ${
                TEST_FAILURE[result.error_code] ?? 'The provider did not accept the request.'
              }`,
            },
      );
    },
    onError: (error) => setTestState({ ok: false, message: humanizeApiError(error).message }),
  });
  // The terminal sync poll invalidates integrations; enqueueing alone persists no projection.
  // react-doctor-disable-next-line
  const syncMutation = useMutation({
    // Name the project: a connection serving several projects needs it.
    mutationFn: () =>
      integrationsApi.sync(connection.id, activeProject ? { project_id: activeProject.id } : {}, {
        workspaceId: connection.workspace_id,
      }),
    onSuccess: (enqueued) => {
      setTestState(null);
      setActiveSyncId(enqueued.sync_run_id);
    },
  });
  const syncRunQuery = useQuery({
    queryKey: queryKeys.integrations.sync(connection.id, activeSyncId ?? ''),
    queryFn: ({ signal }) =>
      integrationsApi.getSync(connection.id, activeSyncId ?? '', {
        signal,
        workspaceId: connection.workspace_id,
      }),
    enabled: activeSyncId !== null,
    refetchInterval: (query) => {
      const run = query.state.data;
      return !run || isSyncInFlight(run) ? SYNC_RUN_POLL_MS : false;
    },
  });
  const activeRun = syncRunQuery.data ?? null;
  const runActive = activeRun !== null && isActiveSyncRun(activeRun.status);
  const runInFlight = activeRun !== null && isSyncInFlight(activeRun);
  // Pages read the projections, so they refresh once the reports are rebuilt.
  const runTerminal = activeRun !== null && !runInFlight;

  useEffect(() => {
    if (runTerminal) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.integrations.all });
    }
  }, [queryClient, runTerminal]);

  // Stops importing this property into the project; imported data stays.
  const removeMutation = useMutation({
    mutationFn: async () => {
      // Remove renders only with a mapping; a stale click after it is gone is a no-op.
      if (mapping)
        await integrationsApi.deleteMapping(mapping.id, { workspaceId: connection.workspace_id });
    },
    onSuccess: () => refreshAfterMapping(),
  });
  const busy = testMutation.isPending || syncMutation.isPending || removeMutation.isPending;
  const hasProperty = mapping !== null;

  return (
    <ConnectionRowView
      connection={connection}
      grant={grant}
      testMutation={testMutation}
      syncMutation={syncMutation}
      removeMutation={removeMutation}
      testState={testState}
      activeRun={activeRun}
      runActive={runActive}
      runInFlight={runInFlight}
      busy={busy}
      hasProperty={hasProperty}
    />
  );
}
