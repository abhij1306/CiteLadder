'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';

import { BackfillHistory } from '@/components/settings/backfill-progress';
import { PROVIDER_META, type GrantModel } from '@/components/settings/grant-model';
import { useProjectContext } from '@/lib/project/project-context';
import { PropertyPicker, useActiveMapping } from '@/components/settings/property-picker';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  integrationsApi,
  integrationsMutations,
  integrationsQueries,
  refreshImportedReads,
  type IntegrationConnection,
} from '@/lib/api/integrations';
import { humanizeApiError } from '@/lib/api/errors';
import { formatCount, formatShortDate } from '@/lib/format';
import { DisplayTime } from '@/components/ui/display-time';
import { SYNC_RUN_POLL_MS } from '@/lib/config/operational';
import { isActiveSyncRun, isSyncInFlight, SYNC_RUN_BADGE } from '@/lib/integrations/sync-runs';
import { ControlRow } from '@/components/ui/control-row';
import { FactList } from '@/components/ui/facts';
import { IconTile } from '@/components/ui/icon';
import { Stack } from '@/components/ui/layout';
import { textRole } from '@/components/ui/typography';
import { ledgerItemClasses } from '@/components/ui/workspace';

type ConnectionMutation = {
  isPending: boolean;
  isError: boolean;
  error: unknown;
  mutate: () => void;
};
type SyncRun = Awaited<ReturnType<typeof integrationsApi.getSync>>;

/** A mutation's state with the one action the row runs through it. */
const connectionAction = (
  mutation: Omit<ConnectionMutation, 'mutate'>,
  run: () => void,
): ConnectionMutation => ({
  isPending: mutation.isPending,
  isError: mutation.isError,
  error: mutation.error,
  mutate: run,
});

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
    <ControlRow
      media={<IconTile icon={Icon} />}
      controls={
        <>
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
              variant="danger"
              onClick={onRemove}
              disabled={busy}
              pending={removePending}
              pendingLabel="Removing…"
              aria-label={`Remove ${label} property from this project`}
            >
              Remove
            </Button>
          ) : null}
        </>
      }
    >
      <div className={textRole('itemTitle', 'truncate')}>{label}</div>
      <PropertyPicker connection={connection} disabled={busy} />
    </ControlRow>
  );
}

/** The latest sync from this card: waiting, importing, building reports, then its result. */
function RunSummary({ run, runActive }: Readonly<{ run: SyncRun; runActive: boolean }>) {
  const rows = `${formatCount(run.row_count)} rows`;
  const window = `window ${formatShortDate(run.window_start)}–${formatShortDate(run.window_end)}`;
  if (runActive)
    return (
      <>
        <Badge variant="run-status" value={SYNC_RUN_BADGE[run.status]}>
          {SYNC_RUN_LABEL[run.status]}
        </Badge>
        <span className="truncate">
          {run.status === 'running' ? (
            `${rows} · ${window}`
          ) : (
            <>
              Enqueued <DisplayTime value={run.created_at} /> · {waitingLabel(run.status)}
            </>
          )}
        </span>
      </>
    );
  if (run.processing)
    return (
      <>
        <Badge variant="run-status" value="running">
          Processing
        </Badge>
        <span className="truncate">{`${rows} imported · updating reports`}</span>
      </>
    );
  const result =
    run.status === 'succeeded' ? `${rows} imported · ${window}` : run.error_detail || window;
  return (
    <>
      <Badge variant="run-status" value={SYNC_RUN_BADGE[run.status]}>
        {SYNC_RUN_LABEL[run.status]}
      </Badge>
      <span className="truncate" title={result}>
        {result}
      </span>
    </>
  );
}

/**
 * The row's one status value. Every outcome — a failed action, a test
 * result, the sync this card started — replaces it in place rather than
 * adding a notice under the row, so nothing below moves (the newest action
 * wins: starting a sync clears the test result).
 */
function ConnectionStatus({
  actionError,
  testState,
  activeRun,
  runActive,
  grantConnected,
  hasProperty,
}: Readonly<{
  actionError: unknown;
  testState: { ok: boolean; message: string } | null;
  activeRun: SyncRun | null;
  runActive: boolean;
  grantConnected: boolean;
  hasProperty: boolean;
}>) {
  if (actionError) {
    const message = humanizeApiError(actionError).message;
    return (
      <>
        <Badge variant="status" value="danger">
          Failed
        </Badge>
        <span className="truncate" title={message}>
          {message}
        </span>
      </>
    );
  }
  if (testState)
    return (
      <>
        <Badge variant="status" value={testState.ok ? 'success' : 'danger'}>
          {testState.ok ? 'Test passed' : 'Test failed'}
        </Badge>
        <span className="truncate" title={testState.message}>
          {testState.message}
        </span>
      </>
    );
  if (activeRun) return <RunSummary run={activeRun} runActive={runActive} />;
  if (!grantConnected) return <span className="text-ink-muted">Reconnect to sync</span>;
  if (!hasProperty) return <span className="text-ink-muted">Select a property to import</span>;
  return <span className="text-ink-muted">Ready to sync</span>;
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
  const actionError = syncMutation.error ?? removeMutation.error;

  return (
    <Stack
      as="li"
      gap="compact"
      className={ledgerItemClasses()}
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
      <FactList
        layout="columns"
        label={`${label} sync status`}
        facts={[
          {
            label: 'Last synced',
            value: (
              <span className="truncate">
                <DisplayTime value={connection.last_synced_at} fallback="Never" />
              </span>
            ),
          },
          {
            label: 'History',
            value: (
              <BackfillHistory workspaceId={connection.workspace_id} connectionId={connection.id} />
            ),
          },
          {
            label: 'Status',
            value: (
              <ConnectionStatus
                actionError={actionError}
                testState={testState}
                activeRun={activeRun}
                runActive={runActive}
                grantConnected={grant.status === 'connected'}
                hasProperty={hasProperty}
              />
            ),
          },
        ]}
      />
    </Stack>
  );
}

/** Polling and mutation owner for one connection on an OAuth grant. */
export function ConnectionRow({
  connection,
  grant,
}: Readonly<{ connection: IntegrationConnection; grant: GrantModel }>) {
  const [testState, setTestState] = useState<{ ok: boolean; message: string } | null>(null);
  const { activeProject } = useProjectContext();
  const client = useQueryClient();
  const mapping = useActiveMapping(
    connection.workspace_id,
    connection.id,
    activeProject?.id ?? null,
  );
  const [activeSyncId, setActiveSyncId] = useState<string | null>(null);
  // The test descriptor owns no callbacks; this row's status slot is local state.
  const testMutation = useMutation({
    ...integrationsMutations.test(connection.workspace_id, connection.id),
    // The newest action owns the status slot: an older failure must not mask this result.
    onMutate: () => {
      syncMutation.reset();
      removeMutation.reset();
    },
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
  // The terminal sync poll refreshes every imported read; enqueueing alone persists no projection.
  // react-doctor-disable-next-line
  const syncMutation = useMutation(
    integrationsMutations.sync(connection.workspace_id, connection.id),
  );
  // Name the project: a connection serving several projects needs it.
  const startSync = () =>
    syncMutation.mutate(activeProject ? { project_id: activeProject.id } : {}, {
      onSuccess: (enqueued) => {
        setTestState(null);
        setActiveSyncId(enqueued.sync_run_id);
      },
    });
  const syncRunQuery = useQuery({
    ...integrationsQueries.sync(connection.workspace_id, connection.id, activeSyncId),
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
    if (runTerminal) void refreshImportedReads(client);
  }, [client, runTerminal]);

  // Stops importing this property into the project; imported data stays.
  const removeMutation = useMutation(integrationsMutations.deleteMapping(connection.workspace_id));
  // Remove renders only with a mapping; a stale click after it is gone is a no-op.
  const removeMapping = () => {
    if (mapping) removeMutation.mutate(mapping.id);
  };
  const busy = testMutation.isPending || syncMutation.isPending || removeMutation.isPending;
  const hasProperty = mapping !== null;

  return (
    <ConnectionRowView
      connection={connection}
      grant={grant}
      testMutation={connectionAction(testMutation, () => testMutation.mutate())}
      syncMutation={connectionAction(syncMutation, startSync)}
      removeMutation={connectionAction(removeMutation, removeMapping)}
      testState={testState}
      activeRun={activeRun}
      runActive={runActive}
      runInFlight={runInFlight}
      busy={busy}
      hasProperty={hasProperty}
    />
  );
}
