import { useMutation } from '@tanstack/react-query';
import { Info } from 'lucide-react';
import { useState } from 'react';

import { ConnectionRow } from '@/components/settings/integration-connection-row';
import { Dialog } from '@/components/ui/dialog';
import { humanizeApiError } from '@/lib/api/errors';
import {
  FAMILY_META,
  isGrantGone,
  joinProviderLabels,
  type GrantFamily,
  type GrantModel,
} from '@/components/settings/grant-model';
import { useRefreshAfterMapping } from '@/components/integrations/data-sources';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardEyebrow,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Stack } from '@/components/ui/layout';
import { panelClasses } from '@/components/ui/panel';
import { integrationsApi, type IntegrationConnection } from '@/lib/api/integrations';
import { hardNavigate } from '@/lib/navigation/hard-navigate';
import { textRole } from '@/components/ui/typography';

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
  needs_reauth: 'Needs reauth',
  pending_revocation: 'Pending revocation',
  error: 'Error',
  revoked: 'Revoked',
};

function GrantAlert({ family, status }: Readonly<{ family: GrantFamily; status: GrantStatus }>) {
  const title = FAMILY_META[family].title;

  if (status === 'needs_reauth') {
    return (
      <Alert tone="warning">
        {title} requires renewed consent for this grant. Reconnect to resume syncing — previously
        imported data is unaffected.
      </Alert>
    );
  }
  if (status === 'error') {
    return (
      <Alert tone="danger">
        The last connection test failed — {title}&nbsp;rejected this grant&rsquo;s refresh.
        Reconnect to resume syncing.
      </Alert>
    );
  }
  if (status === 'pending_revocation') {
    return (
      <Alert tone="warning">
        Disconnect is finishing — CiteLadder is retrying the {title} revocation in the background.
        Previously imported data is kept.
      </Alert>
    );
  }
  if (status === 'revoked') {
    return (
      <Alert tone="neutral">
        {title} is disconnected. Imported data is kept; reconnect to resume syncing.
      </Alert>
    );
  }

  return null;
}

function GrantHeader({
  family,
  grant,
}: Readonly<{ family: GrantFamily; grant: GrantModel | null }>) {
  const meta = FAMILY_META[family];
  const badge = grant ? GRANT_STATUS_BADGE[grant.status] : { variant: 'neutral' as const };
  const label = grant ? GRANT_STATUS_LABEL[grant.status] : 'Not connected';

  return (
    <CardHeader
      bordered
      actions={
        badge.variant === 'status' ? (
          <Badge variant="status" value={badge.value} data-testid={`grant-status-${family}`}>
            {label}
          </Badge>
        ) : (
          <Badge variant="neutral" data-testid={`grant-status-${family}`}>
            {label}
          </Badge>
        )
      }
    >
      <CardEyebrow>OAuth grant</CardEyebrow>
      <CardTitle>{meta.title}</CardTitle>
      <CardDescription className="truncate">{meta.blurb}</CardDescription>
    </CardHeader>
  );
}

function ConnectCard({
  workspaceId,
  family,
}: Readonly<{ workspaceId: string; family: GrantFamily }>) {
  const meta = FAMILY_META[family];

  return (
    <Card data-testid={`grant-card-${family}`} className="flex flex-col justify-between">
      <div>
        <GrantHeader family={family} grant={null} />
        <CardContent className="pt-4">
          <p className={textRole('body')}>
            Connect your {meta.title} account to automatically import traffic and search visibility
            metrics.
          </p>
        </CardContent>
      </div>
      <CardContent className="pt-0">
        <Button
          variant="secondary"
          onClick={() =>
            hardNavigate(integrationsApi.oauthStartUrl(meta.connectProvider, workspaceId))
          }
        >
          Connect {meta.title}
        </Button>
      </CardContent>
    </Card>
  );
}

/**
 * Disconnect the whole grant: access is revoked at the provider and every
 * property it serves stops importing. Imported data is kept, so reconnecting
 * resumes the same history.
 */
function DisconnectGrant({ grant }: Readonly<{ grant: GrantModel }>) {
  // Disconnecting stops imports into the same projections a new property feeds.
  const refresh = useRefreshAfterMapping();
  const [open, setOpen] = useState(false);
  const title = FAMILY_META[grant.family].title;
  const [connection] = grant.connections;
  const disconnect = useMutation({
    mutationFn: () =>
      integrationsApi.delete(connection.id, { workspaceId: connection.workspace_id }),
    onSuccess: async () => {
      setOpen(false);
      await refresh();
    },
  });
  const sources = joinProviderLabels(grant.connections.map((item) => item.provider));
  return (
    <>
      <Button variant="destructiveGhost" size="sm" onClick={() => setOpen(true)}>
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
              variant="destructive"
              onClick={() => disconnect.mutate()}
              pending={disconnect.isPending}
              pendingLabel="Disconnecting…"
            >
              Disconnect
            </Button>
          </>
        }
      >
        <div className="grid gap-2">
          <p className={textRole('body')}>
            Previously imported data is kept. Reconnecting resumes from it; to stop importing just
            one property, use Remove on its row instead.
          </p>
          {disconnect.isError ? (
            <Alert tone="danger">{humanizeApiError(disconnect.error).message}</Alert>
          ) : null}
        </div>
      </Dialog>
    </>
  );
}

function ConnectedCard({
  workspaceId,
  family,
  grant,
}: Readonly<{ workspaceId: string; family: GrantFamily; grant: GrantModel }>) {
  const meta = FAMILY_META[family];

  return (
    <Card data-testid={`grant-card-${family}`} className="flex flex-col justify-between">
      <div>
        <GrantHeader family={family} grant={grant} />
        <CardContent className="grid gap-3 pt-4">
          <GrantAlert family={family} status={grant.status} />
          <div
            className={panelClasses(
              { tone: 'well', pad: 'compact' },
              'type-caption flex items-center gap-2',
            )}
          >
            <Info className="text-secondary size-3.5 shrink-0" aria-hidden />
            <span>
              One OAuth grant shared by {grant.connections.length}{' '}
              {grant.connections.length === 1 ? 'connection' : 'connections'}.
            </span>
          </div>
          <Stack gap="compact">
            {grant.connections.map((connection) => (
              <ConnectionRow key={connection.id} connection={connection} grant={grant} />
            ))}
          </Stack>
        </CardContent>
      </div>
      <CardContent className="pt-0">
        <div className="border-border-subtle flex flex-wrap items-center justify-between gap-2 border-t pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={grant.status === 'connected' ? 'secondary' : 'primary'}
              size="sm"
              onClick={() =>
                hardNavigate(integrationsApi.oauthStartUrl(meta.connectProvider, workspaceId))
              }
            >
              {grant.status === 'revoked' ? `Connect ${meta.title}` : 'Reconnect'}
            </Button>
            {isGrantGone(grant.status) ? null : <DisconnectGrant grant={grant} />}
          </div>
          <span className="type-caption text-right">
            Reconnecting renews consent for the whole grant.
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

export function IntegrationCardView({
  workspaceId,
  family,
  grant,
}: Readonly<{ workspaceId: string; family: GrantFamily; grant: GrantModel | null }>) {
  return grant ? (
    <ConnectedCard workspaceId={workspaceId} family={family} grant={grant} />
  ) : (
    <ConnectCard workspaceId={workspaceId} family={family} />
  );
}
