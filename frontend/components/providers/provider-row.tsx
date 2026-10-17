'use client';

import { useId, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { BrandLogo } from '@/components/ui/brand-logo';
import { Button } from '@/components/ui/button';
import { panelClasses } from '@/components/ui/panel';
import { textRole } from '@/components/ui/typography';
import type { ProviderConnection } from '@/lib/api/types';
import {
  ENGINE_LOGOS,
  TRANSPORT_DOMAINS,
  isConfigured,
  productModelLabel,
  type EngineCardModel,
  type ProviderGroup,
} from '@/lib/providers/catalog';
import { useProviderConnection } from '@/lib/providers/use-provider-connection';

import { ProviderConnectionFields } from './provider-connection-fields';

type ConnectionState = ReturnType<typeof useProviderConnection>;

/** Anthropic's mark ships locally; the other transports resolve by domain. */
const TRANSPORT_LOGOS: Partial<Record<ProviderGroup['transport'], string>> = {
  anthropic: ENGINE_LOGOS.claude,
};

/**
 * One badge for the credential. The engines share it, so any verified engine
 * means the key works; a stored key nobody has verified is not "connected".
 */
function StatusBadge({
  group,
  connection,
}: Readonly<{ group: ProviderGroup; connection: ProviderConnection | undefined }>) {
  if (group.engines.some((engine) => engine.state === 'connected')) {
    return (
      <Badge variant="status" value="success">
        Connected
      </Badge>
    );
  }
  if (group.engines.some((engine) => engine.state === 'failed')) {
    return (
      <Badge variant="status" value="danger">
        Failed
      </Badge>
    );
  }
  return (
    <Badge variant="neutral">{isConfigured(connection) ? 'Not verified' : 'Not connected'}</Badge>
  );
}

/** "ChatGPT API · gpt-6.1-sol" for an API; the bare surface name for a consumer app. */
function engineSummary(engine: EngineCardModel): string {
  const model = productModelLabel(engine.logical_engine, engine.route?.model);
  return model ? `${engine.label} · ${model}` : engine.label;
}

function LastFailure({ group }: Readonly<{ group: ProviderGroup }>) {
  const probe = group.engines.find(
    (engine) => engine.state === 'failed' && engine.latest_probe,
  )?.latest_probe;
  if (!probe) return null;
  return (
    <p className="type-caption text-danger-text">
      Last test failed
      {probe.safe_reason ? `: ${probe.safe_reason}` : ''}
      {probe.model ? ` (model ${probe.model})` : ''}.
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
    busy,
  } = state;
  const noun = state.credentialShape === 'basic' ? 'credentials' : 'key';
  const saveVerb = configured ? 'Update' : 'Save';
  const saveLabel = saveMutation.isPending ? 'Saving & testing…' : `${saveVerb} ${noun}`;
  return (
    <div id={id} className={panelClasses({ tone: 'tonal', pad: 'compact' }, 'grid gap-3')}>
      <ProviderConnectionFields state={state} />
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => testMutation.mutate()}
          disabled={busy || !state.connection}
        >
          {testMutation.isPending ? 'Testing…' : 'Test connection'}
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => saveMutation.mutate()}
          disabled={busy || hasPartialCredentialInput || (!hasCredentialInput && !configured)}
        >
          {saveLabel}
        </Button>
      </div>
    </div>
  );
}

/**
 * One provider credential as a list row: who it is, what it measures, whether
 * it works, and — on demand — its write-only credential form. A verified save
 * collapses the row; a failed one keeps it open with the reason.
 */
export function ProviderRow({
  group,
  connections,
  defaultOpen = false,
}: Readonly<{
  group: ProviderGroup;
  connections: ProviderConnection[];
  defaultOpen?: boolean;
}>) {
  const [open, setOpen] = useState(defaultOpen);
  const formId = useId();
  const state = useProviderConnection({ group, connections, onSaved: () => setOpen(false) });
  const closedAction = state.configured ? 'Manage' : 'Connect';
  const toggleLabel = open ? 'Close' : closedAction;
  return (
    <li className="grid gap-3 py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <BrandLogo
            name={group.label}
            logoUrl={TRANSPORT_LOGOS[group.transport]}
            websiteUrl={TRANSPORT_DOMAINS[group.transport]}
            size="md"
          />
          <div className="grid min-w-0 gap-0.5">
            <h3 className={textRole('itemTitle')}>{group.label}</h3>
            <p className={textRole('caption')}>{group.engines.map(engineSummary).join(' · ')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge group={group} connection={state.connection} />
          <Button
            type="button"
            variant={open ? 'ghost' : 'secondary'}
            size="sm"
            aria-expanded={open}
            aria-controls={formId}
            aria-label={`${toggleLabel} ${group.label}`}
            onClick={() => setOpen((current) => !current)}
          >
            {toggleLabel}
          </Button>
        </div>
      </div>
      <LastFailure group={group} />
      {open ? <CredentialForm id={formId} state={state} /> : null}
    </li>
  );
}
