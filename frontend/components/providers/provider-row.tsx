import { executionFailureReason } from '@/lib/runs/status';
import { endSentence } from '@/lib/format';
import { useId, useState } from 'react';

import { StatusMark } from '@/components/ui/status-mark';
import { BrandMark } from '@/components/ui/brand-mark';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Inline, Stack } from '@/components/ui/layout';
import { textRole } from '@/components/ui/typography';
import type { ProviderConnection } from '@citeladder/contracts';
import {
  ENGINE_LOGOS,
  TRANSPORT_DOMAINS,
  isConfigured,
  type ProviderGroup,
} from '@/lib/providers/catalog';
import { useProviderConnection } from '@/lib/providers/use-provider-connection';
import { useWorkspaceCapability } from '@/lib/project/project-context';

import { ProviderConnectionFields } from './provider-connection-fields';
import { wellClasses } from '@/components/ui/slip';

type ConnectionState = ReturnType<typeof useProviderConnection>;

const TRANSPORT_LOGOS: Partial<Record<ProviderGroup['transport'], string>> = {
  anthropic: ENGINE_LOGOS.claude,
};

function StatusBadge({
  group,
  connection,
  compact,
}: Readonly<{
  group: ProviderGroup;
  connection: ProviderConnection | undefined;
  compact: boolean;
}>) {
  if (group.engines.some((engine) => engine.state === 'connected')) {
    return (
      <StatusMark variant="status" value="success">
        Connected
      </StatusMark>
    );
  }
  if (group.engines.some((engine) => engine.state === 'failed')) {
    return (
      <StatusMark variant="status" value="danger">
        Failed
      </StatusMark>
    );
  }
  if (isConfigured(connection)) {
    return (
      <StatusMark variant="status" value="warning">
        Not verified
      </StatusMark>
    );
  }
  return compact ? null : <StatusMark>Not connected</StatusMark>;
}

function LastFailure({ group }: Readonly<{ group: ProviderGroup }>) {
  const probe = group.engines.find(
    (engine) => engine.state === 'failed' && engine.latest_probe,
  )?.latest_probe;
  if (!probe) return null;
  return (
    <p className="type-caption text-negative">
      Last test failed.
      {probe.safe_reason
        ? ` ${endSentence(executionFailureReason(probe.safe_reason, probe.safe_reason))}`
        : ''}
    </p>
  );
}

function CredentialForm({ id, state }: Readonly<{ id: string; state: ConnectionState }>) {
  const {
    configured,
    hasCredentialInput,
    hasPartialCredentialInput,
    saveMutation,
    testMutation,
    removeMutation,
    busy,
  } = state;
  const [confirming, setConfirming] = useState(false);
  const noun = state.credentialShape === 'basic' ? 'credentials' : 'key';
  const saveVerb = configured ? 'Update' : 'Save';
  const saveLabel = saveMutation.isPending ? 'Saving & testing…' : `${saveVerb} ${noun}`;
  return (
    <Stack gap="compact" id={id} className={wellClasses()}>
      <ProviderConnectionFields state={state} />
      <Inline className="flex-wrap justify-end">
        {state.connection ? (
          <Button
            type="button"
            variant="quiet"
            className="mr-auto"
            onClick={() => setConfirming(true)}
            disabled={busy}
          >
            Remove {noun}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="secondary"
          onClick={() => testMutation.mutate()}
          disabled={busy || !state.connection}
        >
          {testMutation.isPending ? 'Testing…' : 'Test connection'}
        </Button>
        <Button
          type="button"
          variant="primary"
          onClick={() => saveMutation.mutate()}
          disabled={busy || hasPartialCredentialInput || (!hasCredentialInput && !configured)}
        >
          {saveLabel}
        </Button>
      </Inline>
      <ConfirmDialog
        request={
          confirming
            ? {
                title: `Remove the saved ${noun}?`,
                body: 'Runs stop using it. Past results are kept.',
                confirmLabel: `Remove ${noun}`,
                destructive: true,
                onConfirm: () =>
                  removeMutation.mutate(undefined, { onSettled: () => setConfirming(false) }),
              }
            : null
        }
        pending={removeMutation.isPending}
        onCancel={() => setConfirming(false)}
      />
    </Stack>
  );
}

export function ProviderRow({
  group,
  connections,
  defaultOpen = false,
  compact = false,
}: Readonly<{
  group: ProviderGroup;
  connections: ProviderConnection[];
  defaultOpen?: boolean;
  compact?: boolean;
}>) {
  const canManage = useWorkspaceCapability('manage_credentials');
  const [open, setOpen] = useState(defaultOpen && canManage);
  const formId = useId();
  const state = useProviderConnection({ group, connections, onSaved: () => setOpen(false) });
  const closedAction = state.configured ? 'Manage' : 'Connect';
  const toggleLabel = open ? 'Close' : closedAction;
  return (
    <Stack as="li" gap="compact">
      <Inline gap="workspace" className="flex-wrap">
        <Inline gap="compact" className="flex-1">
          <BrandMark
            name={group.label}
            logoUrl={TRANSPORT_LOGOS[group.transport]}
            websiteUrl={TRANSPORT_DOMAINS[group.transport]}
          />
          <div className="grid min-w-0">
            <h3 className={textRole('subheading')}>{group.label}</h3>
            {compact ? null : (
              <p className={textRole('caption')}>
                {group.engines.map((engine) => engine.label).join(' · ')}
              </p>
            )}
          </div>
        </Inline>
        <Inline>
          <StatusBadge group={group} connection={state.connection} compact={compact} />
          {canManage ? (
            <Button
              type="button"
              variant={open ? 'quiet' : 'secondary'}
              aria-expanded={open}
              aria-controls={formId}
              aria-label={`${toggleLabel} ${group.label}`}
              onClick={() => setOpen((current) => !current)}
            >
              {toggleLabel}
            </Button>
          ) : null}
        </Inline>
      </Inline>
      <LastFailure group={group} />
      {open && canManage ? <CredentialForm id={formId} state={state} /> : null}
    </Stack>
  );
}
