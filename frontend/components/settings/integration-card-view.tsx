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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { MutationNotice } from '@/components/ui/mutation-notice';
import {
  Card,
  CardContent,
  CardDescription,
  CardEyebrow,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Inline, Stack } from '@/components/ui/layout';
import { ClampText } from '@/components/ui/table';
import { ledgerClasses, MetaFooter } from '@/components/ui/workspace';
import {
  integrationsApi,
  integrationsMutations,
  type IntegrationConnection,
} from '@/lib/api/integrations';
import { hardNavigate } from '@/lib/navigation/hard-navigate';
import { useWorkspaceCapability } from '@/lib/project/project-context';
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
  needs_reauth: 'Reconnect needed',
  pending_revocation: 'Disconnecting',
  error: 'Error',
  revoked: 'Disconnected',
};

function GrantAlert({ family, status }: Readonly<{ family: GrantFamily; status: GrantStatus }>) {
  const title = FAMILY_META[family].title;

  if (status === 'needs_reauth') {
    return (
      <Callout tone="warning">
        {title} needs you to sign in again. Reconnect to resume syncing — previously imported data
        is unaffected.
      </Callout>
    );
  }
  if (status === 'error') {
    return (
      <Callout tone="negative">
        The last connection test failed — {title}&nbsp;rejected CiteLadder&rsquo;s access. Reconnect
        to resume syncing.
      </Callout>
    );
  }
  if (status === 'pending_revocation') {
    return (
      <Callout tone="warning">
        Disconnect is finishing — CiteLadder is retrying the {title} revocation in the background.
        Previously imported data is kept.
      </Callout>
    );
  }
  if (status === 'revoked') {
    return (
      <Callout tone="neutral">
        {title} is disconnected. Imported data is kept; reconnect to resume syncing.
      </Callout>
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
      actions={
        badge.variant === 'status' ? (
          <Badge variant="status" value={badge.value} data-testid={`grant-status-${family}`}>
            {label}
          </Badge>
        ) : (
          <Badge data-testid={`grant-status-${family}`}>{label}</Badge>
        )
      }
    >
      <CardEyebrow>Connection</CardEyebrow>
      <CardTitle>{meta.title}</CardTitle>
      {/* Cut at one line, with the whole description in a tooltip when cut. */}
      <CardDescription>
        <ClampText lines={1}>{meta.blurb}</ClampText>
      </CardDescription>
    </CardHeader>
  );
}

function ConnectCard({
  workspaceId,
  family,
}: Readonly<{ workspaceId: string; family: GrantFamily }>) {
  const meta = FAMILY_META[family];
  const canManage = useWorkspaceCapability('manage_credentials');

  return (
    <Stack as={Card} gap="compact" data-testid={`grant-card-${family}`} className="content-between">
      <div>
        <GrantHeader family={family} grant={null} />
        <CardContent>
          <p className={textRole('body')}>
            {canManage
              ? `Connect your ${meta.title} account to automatically import traffic and search visibility metrics.`
              : `A workspace Owner or Admin can connect ${meta.title} to import traffic and search visibility metrics.`}
          </p>
        </CardContent>
      </div>
      {canManage ? (
        <CardContent>
          <Button
            variant="secondary"
            onClick={() =>
              hardNavigate(integrationsApi.oauthStartUrl(meta.connectProvider, workspaceId))
            }
          >
            Connect {meta.title}
          </Button>
        </CardContent>
      ) : null}
    </Stack>
  );
}

/**
 * Disconnect the whole grant: access is revoked at the provider and every
 * property it serves stops importing. Imported data is kept, so reconnecting
 * resumes the same history.
 */
function DisconnectGrant({ grant }: Readonly<{ grant: GrantModel }>) {
  const [open, setOpen] = useState(false);
  const title = FAMILY_META[grant.family].title;
  const [connection] = grant.connections;
  // Disconnecting stops imports into the same projections a new property feeds.
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
        <Stack gap="compact">
          <p className={textRole('body')}>
            Previously imported data is kept. Reconnecting resumes from it; to stop importing just
            one property, use Remove on its row instead.
          </p>
          {disconnect.isError ? (
            <MutationNotice
              notice={mutationNoticeForError(disconnect.error, {
                action: 'disconnect the integration',
              })}
            />
          ) : null}
        </Stack>
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
  // Connecting and disconnecting are credential actions.
  const canManage = useWorkspaceCapability('manage_credentials');

  return (
    <Stack as={Card} gap="compact" data-testid={`grant-card-${family}`} className="content-between">
      <div>
        <GrantHeader family={family} grant={grant} />
        <Stack as={CardContent} gap="compact">
          <GrantAlert family={family} status={grant.status} />
          <ul className={ledgerClasses()}>
            {grant.connections.map((connection) => (
              <ConnectionRow key={connection.id} connection={connection} grant={grant} />
            ))}
          </ul>
        </Stack>
      </div>
      {canManage ? (
        <CardContent>
          <MetaFooter
            trailing={
              <span className="text-right">
                Reconnecting renews access for every property in this connection.
              </span>
            }
          >
            <Inline className="flex-wrap">
              <Button
                variant={grant.status === 'connected' ? 'secondary' : 'primary'}
                onClick={() =>
                  hardNavigate(integrationsApi.oauthStartUrl(meta.connectProvider, workspaceId))
                }
              >
                {grant.status === 'revoked' ? `Connect ${meta.title}` : 'Reconnect'}
              </Button>
              {isGrantGone(grant.status) ? null : <DisconnectGrant grant={grant} />}
            </Inline>
          </MetaFooter>
        </CardContent>
      ) : null}
    </Stack>
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
