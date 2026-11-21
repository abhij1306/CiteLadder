import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';

import { BackfillProgress } from '@/components/settings/backfill-progress';
import {
  FAMILY_META,
  GRANT_FAMILY,
  PROVIDER_META,
  isIntegrationProvider,
  joinProviderLabels,
  type GrantFamily,
} from '@/components/settings/grant-model';
import { ActionButton } from '@/components/ui/actions';
import { Button } from '@/components/ui/button';
import { ClampText } from '@/components/ui/clamp-text';
import { Icon } from '@/components/ui/icon';
import { Inline, Stack } from '@/components/ui/layout';
import { InlineFigure, textRole } from '@/components/ui/typography';
import { ledgerClasses, ledgerItemClasses } from '@/components/ui/workspace';
import {
  integrationsApi,
  refreshImportedReads,
  type IntegrationProvider,
} from '@/lib/api/integrations';
import { Plug, type IconGlyph } from '@/lib/icons';
import { hardNavigate } from '@/lib/navigation/hard-navigate';
import { projectDestination } from '@/lib/navigation/project-destination';
import { useProjectContext, useWorkspaceCapability } from '@/lib/project/project-context';

import { usePropertyChoice } from './property-choice';
import { oauthErrorMessage, useDataSources, type SourceStep } from './data-sources';
import { Notice } from '@/components/ui/notice';
import { Section, SectionHeader, SectionTitle } from '@/components/ui/section';
import { StateBlock } from '@/components/ui/state-block';

function useOAuthReturn() {
  const [params, setParams] = useSearchParams();
  const [result] = useState(() => ({
    connected: params.get('connected'),
    error: params.get('error'),
  }));
  const client = useQueryClient();
  useEffect(() => {
    if (!result.connected && !result.error) return;
    if (result.connected) void refreshImportedReads(client);
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete('connected');
        next.delete('error');
        return next;
      },
      { replace: true },
    );
  }, [client, result, setParams]);
  const connected = isIntegrationProvider(result.connected) ? GRANT_FAMILY[result.connected] : null;
  return { connected, error: result.error };
}

type FamilyProviders = [IntegrationProvider, ...IntegrationProvider[]];

type Row =
  | { kind: 'connect'; family: GrantFamily; providers: FamilyProviders }
  | {
      kind: 'source';
      provider: IntegrationProvider;
      step: Exclude<SourceStep, { kind: 'connect' }>;
    };

function setupRows(
  providers: readonly IntegrationProvider[],
  steps: ReadonlyMap<IntegrationProvider, SourceStep>,
): Row[] {
  const rows: Row[] = [];
  for (const provider of providers) {
    const step = steps.get(provider) ?? { kind: 'connect' };
    if (step.kind !== 'connect') {
      rows.push({ kind: 'source', provider, step });
      continue;
    }
    const family = GRANT_FAMILY[provider];
    const existing = rows.find(
      (row): row is Extract<Row, { kind: 'connect' }> =>
        row.kind === 'connect' && row.family === family,
    );
    if (existing) existing.providers.push(provider);
    else rows.push({ kind: 'connect', family, providers: [provider] });
  }
  return rows;
}

function RowFrame({
  Icon: glyph,
  title,
  status,
  action,
  children,
}: Readonly<{
  Icon: IconGlyph;
  title: string;
  status: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
}>) {
  return (
    <Stack as="li" gap="compact" className={ledgerItemClasses()}>
      <Inline
        gap="compact"
        className="desktop:flex-row desktop:items-center flex-col items-stretch"
      >
        <Inline gap="compact" className="flex-1 items-start">
          <Icon icon={glyph} className="text-ink-2" />
          <div className="min-w-0">
            <div className={textRole('body', 'truncate')}>{title}</div>
            <div className="type-caption">{status}</div>
          </div>
        </Inline>
        {action ? <Inline className="max-w-full shrink-0 flex-wrap">{action}</Inline> : null}
      </Inline>
      {children}
    </Stack>
  );
}

function setupTitle(
  required: readonly IntegrationProvider[],
  steps: ReadonlyMap<IntegrationProvider, SourceStep>,
  connectTitle: string,
): string {
  const pending = required.map((provider) => ({
    provider,
    step: steps.get(provider) ?? { kind: 'connect' as const },
  }));
  if (pending.some(({ step }) => step.kind === 'connect')) return connectTitle;
  const reconnect = pending.find(({ step }) => step.kind === 'reconnect');
  if (reconnect) return `Reconnect ${FAMILY_META[GRANT_FAMILY[reconnect.provider]].title}`;
  const choose = pending.find(({ step }) => step.kind === 'choose');
  if (choose) return `Choose the ${PROVIDER_META[choose.provider].noun}`;
  return 'Data sources';
}

function ConnectButton({
  family,
  onConnect,
}: Readonly<{ family: GrantFamily; onConnect: () => void }>) {
  if (family === 'google') return <ActionButton action="connectGoogle" onClick={onConnect} />;
  return (
    <Button variant="secondary" onClick={onConnect}>
      <Icon icon={Plug} />
      Connect {FAMILY_META[family].title}
    </Button>
  );
}

function ConnectRow({
  family,
  providers,
  required,
  canManage,
  startConnect,
}: Readonly<{
  family: GrantFamily;
  providers: FamilyProviders;
  required: boolean;
  canManage: boolean;
  startConnect: (family: GrantFamily) => void;
}>) {
  return (
    <RowFrame
      Icon={PROVIDER_META[providers[0]].Icon}
      title={joinProviderLabels(providers)}
      status={required ? 'Not connected' : 'Optional'}
      action={
        canManage ? (
          <ConnectButton family={family} onConnect={() => startConnect(family)} />
        ) : (
          <span className="type-caption">Ask a workspace owner or admin</span>
        )
      }
    />
  );
}

function SourceRow({
  provider,
  step,
  projectId,
  canManage,
  autoStart,
  startConnect,
}: Readonly<{
  provider: IntegrationProvider;
  step: Exclude<SourceStep, { kind: 'connect' }>;
  projectId: string;
  canManage: boolean;
  autoStart: boolean;
  startConnect: (family: GrantFamily) => void;
}>) {
  const source = PROVIDER_META[provider];
  const family = GRANT_FAMILY[provider];
  const familyName = FAMILY_META[family].title;
  if (step.kind === 'reconnect')
    return (
      <RowFrame
        Icon={source.Icon}
        title={source.label}
        status={`${familyName} needs your consent again. Imported data is kept.`}
        action={
          canManage ? (
            <Button variant="secondary" onClick={() => startConnect(family)}>
              Reconnect {familyName}
            </Button>
          ) : null
        }
      />
    );
  if (step.kind === 'ready')
    return (
      <RowFrame
        Icon={source.Icon}
        title={source.label}
        status={
          <Inline as="span" gap="meta" className="min-w-0">
            {step.connection.provider === 'ga4' ? (
              <InlineFigure>{step.mapping.property_ref}</InlineFigure>
            ) : (
              <ClampText>{step.mapping.property_ref}</ClampText>
            )}
            <BackfillProgress
              workspaceId={step.connection.workspace_id}
              connectionId={step.connection.id}
            />
          </Inline>
        }
      />
    );
  const status = 'Connected';
  if (!canManage)
    return (
      <RowFrame Icon={source.Icon} title={source.label} status={status}>
        <p className="type-caption">Ask a workspace owner or admin to choose it.</p>
      </RowFrame>
    );
  return (
    <ChooseRow
      provider={provider}
      connection={step.connection}
      projectId={projectId}
      autoStart={autoStart}
      status={status}
    />
  );
}

function ChooseRow({
  status,
  ...choice
}: Readonly<Parameters<typeof usePropertyChoice>[0] & { status: string }>) {
  const source = PROVIDER_META[choice.provider];
  const { action, body } = usePropertyChoice(choice);
  return (
    <RowFrame Icon={source.Icon} title={source.label} status={status} action={action}>
      {body}
    </RowFrame>
  );
}

function unconnectedFamilies({
  sources,
  oauth,
  rows,
}: Readonly<{
  sources: ReturnType<typeof useDataSources>;
  oauth: ReturnType<typeof useOAuthReturn>;
  rows: readonly Row[];
}>): GrantFamily[] | null {
  if (sources.error || oauth.error || oauth.connected) return null;
  const families: GrantFamily[] = [];
  for (const row of rows) {
    if (row.kind !== 'connect') return null;
    families.push(row.family);
  }
  return families;
}

function UnconnectedState({
  heading,
  icon,
  families,
  canManage,
  startConnect,
}: Readonly<{
  heading: string;
  icon?: IconGlyph;
  families: readonly GrantFamily[];
  canManage: boolean;
  startConnect: (family: GrantFamily) => void;
}>) {
  const [lead, ...rest] = families;
  const action =
    canManage && lead ? (
      <>
        <ConnectButton family={lead} onConnect={() => startConnect(lead)} />
        {rest.slice(0, 1).map((family) => (
          <Button key={family} variant="quiet" onClick={() => startConnect(family)}>
            <Icon icon={Plug} />
            Connect {FAMILY_META[family].title}
          </Button>
        ))}
      </>
    ) : (
      <span className="type-caption">Ask a workspace owner or admin to connect it.</span>
    );
  return <StateBlock kind="empty" icon={icon} heading={heading} action={action} />;
}

export function DataSourceSetup({
  required,
  optional = [],
  title,
  whenReady = null,
  unconnected,
}: Readonly<{
  required: readonly IntegrationProvider[];
  optional?: readonly IntegrationProvider[];
  title: string;
  whenReady?: ReactNode;
  unconnected?: Readonly<{ heading: string; icon?: IconGlyph }>;
}>) {
  const { activeProject, activeWorkspaceId } = useProjectContext();
  const canManage = useWorkspaceCapability('manage_credentials');
  const location = useLocation();
  const [params] = useSearchParams();
  const providers = [...required, ...optional];
  const sources = useDataSources(activeWorkspaceId, activeProject?.id ?? null, providers);
  const oauth = useOAuthReturn();

  if (!activeProject || !activeWorkspaceId || sources.loading) return null;
  const allReady = required.every((provider) => sources.steps.get(provider)?.kind === 'ready');
  if (!sources.error && allReady && !oauth.error) return whenReady;

  const startConnect = (family: GrantFamily) =>
    hardNavigate(
      integrationsApi.oauthStartUrl(
        FAMILY_META[family].connectProvider,
        activeWorkspaceId,
        projectDestination(location.pathname, params, activeProject.id),
      ),
    );

  const rows = setupRows(providers, sources.steps);
  const families = unconnectedFamilies({ sources, oauth, rows });
  if (unconnected && families)
    return (
      <UnconnectedState
        {...unconnected}
        families={families}
        canManage={canManage}
        startConnect={startConnect}
      />
    );
  return (
    <SetupCard
      required={required}
      title={title}
      rows={rows}
      sources={sources}
      oauth={oauth}
      canManage={canManage}
      projectId={activeProject.id}
      startConnect={startConnect}
    />
  );
}

function SetupCard({
  required,
  title,
  rows,
  sources,
  oauth,
  canManage,
  projectId,
  startConnect,
}: Readonly<{
  required: readonly IntegrationProvider[];
  title: string;
  rows: readonly Row[];
  sources: ReturnType<typeof useDataSources>;
  oauth: ReturnType<typeof useOAuthReturn>;
  canManage: boolean;
  projectId: string;
  startConnect: (family: GrantFamily) => void;
}>) {
  return (
    <Section
      data-testid="data-source-setup"
      className="mx-auto w-full max-w-[var(--container-prose)]"
    >
      <SectionHeader>
        <SectionTitle>
          {sources.error ? 'Data sources' : setupTitle(required, sources.steps, title)}
        </SectionTitle>
      </SectionHeader>
      <Stack gap="compact">
        {oauth.error ? <Notice tone="negative">{oauthErrorMessage(oauth.error)}</Notice> : null}
        {oauth.connected ? (
          <Notice tone="positive">{FAMILY_META[oauth.connected].title} connected.</Notice>
        ) : null}
        {sources.error ? (
          <Notice
            kind="read"
            title="Couldn't load your data sources"
            error={sources.error}
            fallback="Couldn't load your data sources. Check your connection and try again."
            onRetry={sources.retry}
          />
        ) : (
          <ul className={ledgerClasses()}>
            {rows.map((row) =>
              row.kind === 'connect' ? (
                <ConnectRow
                  key={`connect-${row.family}`}
                  family={row.family}
                  providers={row.providers}
                  required={row.providers.some((provider) => required.includes(provider))}
                  canManage={canManage}
                  startConnect={startConnect}
                />
              ) : (
                <SourceRow
                  key={row.provider}
                  provider={row.provider}
                  step={row.step}
                  projectId={projectId}
                  canManage={canManage}
                  autoStart={oauth.connected === GRANT_FAMILY[row.provider]}
                  startConnect={startConnect}
                />
              ),
            )}
          </ul>
        )}
      </Stack>
    </Section>
  );
}
