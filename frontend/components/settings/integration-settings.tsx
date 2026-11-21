import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { useEffect, useState } from 'react';

import { CrawlLogConnections } from '@/components/ai-traffic/crawl-log-connections';
import {
  FAMILY_META,
  GRANT_FAMILY,
  type GrantFamily,
  type GrantModel,
} from '@/components/settings/grant-model';
import { IntegrationCardView } from '@/components/settings/integration-card-view';
import { IntegrationsEmptyState } from '@/components/settings/integrations-empty-state';
import {
  integrationsQueries,
  refreshIntegrations,
  type IntegrationConnection,
} from '@/lib/api/integrations';
import { oauthErrorMessage } from '@/components/integrations/data-sources';
import { useActiveWorkspaceId } from '@/lib/project/project-context';
import { Notice, readErrorProps } from '@/components/ui/notice';
import { SettingsGroup } from '@/components/ui/setting-row';
import { StateBlock } from '@/components/ui/state-block';

const PROVIDER_ORDER: Record<IntegrationConnection['provider'], number> = {
  gsc: 0,
  ga4: 1,
  bing: 2,
};

const FAMILY_ORDER: GrantFamily[] = ['google', 'microsoft'];

function groupIntoGrants(connections: IntegrationConnection[]): GrantModel[] {
  const byGrant = new Map<string, GrantModel['connections']>();
  for (const connection of connections) {
    const group = byGrant.get(connection.grant_id);
    if (group) group.push(connection);
    else byGrant.set(connection.grant_id, [connection]);
  }
  const grants: GrantModel[] = [];
  for (const [grantId, grouped] of byGrant) {
    // Sorted in place: the group is this function's own, and sorting keeps it non-empty.
    const sorted = grouped.sort((a, b) => PROVIDER_ORDER[a.provider] - PROVIDER_ORDER[b.provider]);
    const [first] = sorted;
    grants.push({
      grantId,
      family: GRANT_FAMILY[first.provider],
      status: first.grant_status,
      scopes: [...new Set(sorted.flatMap((connection) => connection.granted_scopes))],
      connections: sorted,
    });
  }
  return grants.sort((a, b) => FAMILY_ORDER.indexOf(a.family) - FAMILY_ORDER.indexOf(b.family));
}

function CallbackNotice({
  notice,
}: Readonly<{ notice: { connected: string | null; error: string | null } }>) {
  if (notice.connected) {
    const family =
      notice.connected === 'gsc' || notice.connected === 'ga4' || notice.connected === 'bing'
        ? GRANT_FAMILY[notice.connected]
        : null;
    return (
      <Notice tone="positive">
        <strong>{family ? FAMILY_META[family].title : 'Integration'} connected.</strong> Nothing
        imports until you choose a property.
      </Notice>
    );
  }
  if (notice.error) {
    return (
      <Notice tone="negative">
        <strong>Connection failed.</strong> {oauthErrorMessage(notice.error)}
      </Notice>
    );
  }
  return null;
}

/**
 * Settings → Integrations panel: the 4th settings tab and the OAuth
 * callback landing surface (C2). Lists every workspace connection as per-grant
 * cards (Google → GSC + GA4 sub-rows on one shared grant; Microsoft → Bing),
 * shows the callback result notice, and offers Connect for any grant family
 * with no grant yet. Credentials never appear here — the backend never
 * serializes tokens and Connect/Reconnect is a full-page 302
 * navigation, never an apiClient fetch.
 */
export function IntegrationSettings() {
  const queryClient = useQueryClient();
  const searchParams = useSearchParams()[0];
  const workspaceId = useActiveWorkspaceId();

  const [notice] = useState(() => ({
    connected: searchParams.get('connected'),
    error: searchParams.get('error'),
  }));
  const hasCallbackParams = searchParams.has('connected') || searchParams.has('error');
  useEffect(() => {
    if (!hasCallbackParams) return;
    if (notice.connected) void refreshIntegrations(queryClient);
    // Shallow URL cleanup, NOT a redirect: the params have already been captured
    // into `notice`, so this only rewrites the address bar. A route navigation
    // would re-render every mounted settings panel for nothing.
    window.history.replaceState(null, '', '/settings?tab=integrations');
  }, [hasCallbackParams, notice.connected, queryClient]);

  const connectionsQuery = useQuery({
    ...integrationsQueries.connections(workspaceId),
    enabled: workspaceId !== null,
  });

  const connections = connectionsQuery.data ?? [];
  const grants = groupIntoGrants(connections);

  if (!workspaceId)
    return <StateBlock kind="loading" label="Loading your workspace…" shape={{ kind: 'list' }} />;

  const settled = !connectionsQuery.isLoading && !connectionsQuery.isError;
  return (
    <>
      <CallbackNotice notice={notice} />
      {settled && connections.length > 0 ? null : (
        <SettingsGroup title="Search and analytics">
          {connectionsQuery.isError ? (
            <StateBlock
              kind="error"
              title="Couldn't load integrations"
              {...readErrorProps(connectionsQuery)}
              fallback="Couldn't load integrations. Check your connection and try again."
            />
          ) : null}
          {connectionsQuery.isLoading ? (
            <StateBlock kind="loading" label="Loading integrations…" shape={{ kind: 'list' }} />
          ) : null}
          {settled ? <IntegrationsEmptyState workspaceId={workspaceId} /> : null}
        </SettingsGroup>
      )}
      {settled && connections.length > 0
        ? FAMILY_ORDER.map((family) => (
            <IntegrationCardView
              workspaceId={workspaceId}
              key={family}
              family={family}
              grant={grants.find((grant) => grant.family === family) ?? null}
            />
          ))
        : null}
      <CrawlLogConnections />
    </>
  );
}
