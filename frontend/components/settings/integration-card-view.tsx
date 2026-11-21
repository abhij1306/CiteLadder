import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import { ConnectionRow } from '@/components/settings/integration-connection-row';
import { Dialog } from '@/components/ui/dialog';
import { mutationNoticeForError } from '@/lib/api/mutation-notice';
import {
  FAMILY_META,
  isGrantGone,
  joinProviderLabels,
  type GrantFamily,
  type GrantModel,
} from '@/components/settings/grant-model';
import { StatusMark } from '@/components/ui/status-mark';
import { ActionButton } from '@/components/ui/actions';
import { Button } from '@/components/ui/button';
import { GoogleMark } from '@/components/ui/google-glyph';
import {
  SettingRow,
  SettingRows,
  SettingsGroup,
  settingRowsClasses,
} from '@/components/ui/setting-row';
import {
  integrationsApi,
  integrationsMutations,
  type IntegrationConnection,
} from '@/lib/api/integrations';
import { hardNavigate } from '@/lib/navigation/hard-navigate';
import { useWorkspaceCapability } from '@/lib/project/project-context';
import { Notice } from '@/components/ui/notice';

type GrantStatus = IntegrationConnection['grant_status'];
type GrantBadge =
  | { variant: 'status'; value: 'success' | 'warning' | 'danger' }
  | { variant: 'neutral' };

const GRANT_STATUS_BADGE: Record<GrantStatus, GrantBadge> = {
  connected: { variant: 'status', value: 'success' },
  needs_reauth: { variant: 'status', value: 'warning' },
  pending_revocation: { variant: 'status', value: 'warning' },
  error: { variant: 'status', value: 'danger' },
  revoked: { variant: 'neutral' },
};

const GRANT_STATUS_LABEL: Record<GrantStatus, string> = {
  connected: 'Connected',
  needs_reauth: 'Reconnect needed',
  pending_revocation: 'Disconnecting',
  error: 'Error',
  revoked: 'Disconnected',
};

function GrantAlert({ family, status }: Readonly<{ family: GrantFamily; status: GrantStatus }>) {
  const title = FAMILY_META[family].title;

  if (status === 'needs_reauth') {
    return <Notice tone="warning">{title} needs you to sign in again.</Notice>;
  }
  if (status === 'error') {
    return <Notice tone="negative">{title} rejected CiteLadder&rsquo;s access.</Notice>;
  }
  return null;
}

function GrantStatus({
  family,
  grant,
}: Readonly<{ family: GrantFamily; grant: GrantModel | null }>) {
  const badge = grant ? GRANT_STATUS_BADGE[grant.status] : { variant: 'neutral' as const };
  const label = grant ? GRANT_STATUS_LABEL[grant.status] : 'Not connected';
  return badge.variant === 'status' ? (
    <StatusMark variant="status" value={badge.value} data-testid={`grant-status-${family}`}>
      {label}
    </StatusMark>
  ) : (
    <StatusMark data-testid={`grant-status-${family}`}>{label}</StatusMark>
  );
}

function GrantTitle({ family }: Readonly<{ family: GrantFamily }>) {
  return (
    <>
      {family === 'google' ? <GoogleMark /> : null}
      {FAMILY_META[family].title}
    </>
  );
}

function ConnectButton({
  workspaceId,
  family,
}: Readonly<{ workspaceId: string; family: GrantFamily }>) {
  const meta = FAMILY_META[family];
  const start = () =>
    hardNavigate(integrationsApi.oauthStartUrl(meta.connectProvider, workspaceId));
  if (family === 'google') return <ActionButton action="connectGoogle" onClick={start} />;
  return (
    <Button variant="secondary" onClick={start}>
      Connect {meta.title}
    </Button>
  );
}

function ConnectCard({
  workspaceId,
  family,
}: Readonly<{ workspaceId: string; family: GrantFamily }>) {
  const canManage = useWorkspaceCapability('manage_credentials');

  return (
    <div data-testid={`grant-card-${family}`}>
      <SettingsGroup
        title={<GrantTitle family={family} />}
        status={<GrantStatus family={family} grant={null} />}
        action={canManage ? <ConnectButton workspaceId={workspaceId} family={family} /> : null}
      >
        {canManage ? null : (
          <SettingRows>
            <SettingRow label="Owner or Admin only." />
          </SettingRows>
        )}
      </SettingsGroup>
    </div>
  );
}

function ReconnectButton({
  workspaceId,
  family,
}: Readonly<{ workspaceId: string; family: GrantFamily }>) {
  const meta = FAMILY_META[family];
  return (
    <Button
      onClick={() => hardNavigate(integrationsApi.oauthStartUrl(meta.connectProvider, workspaceId))}
    >
      Reconnect
    </Button>
  );
}

function DisconnectGrant({ grant }: Readonly<{ grant: GrantModel }>) {
  const [open, setOpen] = useState(false);
  const title = FAMILY_META[grant.family].title;
  const [connection] = grant.connections;
  const disconnect = useMutation(integrationsMutations.disconnect(connection.workspace_id));
  const sources = joinProviderLabels(grant.connections.map((item) => item.provider));
  return (
    <>
      <Button variant="danger" onClick={() => setOpen(true)}>
        Disconnect {title}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!disconnect.isPending) setOpen(next);
        }}
        title={`Disconnect ${title}`}
        description={`CiteLadder's access to ${sources} is revoked and their properties stop importing.`}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setOpen(false)}
              disabled={disconnect.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => disconnect.mutate(connection.id, { onSuccess: () => setOpen(false) })}
              pending={disconnect.isPending}
              pendingLabel="Disconnecting…"
            >
              Disconnect
            </Button>
          </>
        }
      >
        {disconnect.isError ? (
          <Notice
            kind="mutation"
            notice={mutationNoticeForError(disconnect.error, {
              action: 'disconnect the integration',
            })}
          />
        ) : null}
      </Dialog>
    </>
  );
}

function ConnectedCard({
  workspaceId,
  family,
  grant,
}: Readonly<{ workspaceId: string; family: GrantFamily; grant: GrantModel }>) {
  const canManage = useWorkspaceCapability('manage_credentials');
  const actions = canManage ? (
    <>
      {grant.status === 'revoked' ? (
        <ConnectButton workspaceId={workspaceId} family={family} />
      ) : (
        <ReconnectButton workspaceId={workspaceId} family={family} />
      )}
      {isGrantGone(grant.status) ? null : <DisconnectGrant grant={grant} />}
    </>
  ) : null;

  return (
    <div data-testid={`grant-card-${family}`}>
      <SettingsGroup
        title={<GrantTitle family={family} />}
        status={<GrantStatus family={family} grant={grant} />}
        action={actions}
      >
        <GrantAlert family={family} status={grant.status} />
        <ul className={settingRowsClasses('@container')}>
          {grant.connections.map((connection) => (
            <ConnectionRow key={connection.id} connection={connection} grant={grant} />
          ))}
        </ul>
      </SettingsGroup>
    </div>
  );
}

export function IntegrationCardView({
  workspaceId,
  family,
  grant,
}: Readonly<{
  workspaceId: string;
  family: GrantFamily;
  grant: GrantModel | null;
}>) {
  return grant ? (
    <ConnectedCard workspaceId={workspaceId} family={family} grant={grant} />
  ) : (
    <ConnectCard workspaceId={workspaceId} family={family} />
  );
}
