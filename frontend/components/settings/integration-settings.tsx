'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { useEffect, useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { CrawlLogConnections } from '@/components/ai-traffic/crawl-log-connections';
import { Card, CardContent } from '@/components/ui/card';
import { Stack } from '@/components/ui/layout';
import { ReadError } from '@/components/ui/read-error';
import { Skeleton } from '@/components/ui/skeleton';
import { GRANT_FAMILY, type GrantFamily, type GrantModel } from '@/components/settings/grant-model';
import { IntegrationCardView } from '@/components/settings/integration-card-view';
import { IntegrationsEmptyState } from '@/components/settings/integrations-empty-state';
import { integrationsApi, type IntegrationConnection } from '@/lib/api/integrations';
import { oauthErrorMessage } from '@/components/integrations/data-sources';
import { queryKeys } from '@/lib/api/query-keys';
import { useActiveWorkspaceId } from '@/lib/project/project-context';

/** Display order of connection sub-rows inside a grant card (gsc before ga4). */
const PROVIDER_ORDER: Record<IntegrationConnection['provider'], number> = {
  gsc: 0,
  ga4: 1,
  bing: 2,
};

const FAMILY_ORDER: GrantFamily[] = ['google', 'microsoft'];

/**
 * Group the flat `GET /integrations` connection list into per-grant cards:
 * connections sharing a `grant_id` ride ONE OAuth grant (one Google consent ⇒
 * gsc + ga4 rows; one Microsoft consent ⇒ bing). Grant status + scopes are
 * grant-level, so they are read off any connection in the group (deduped).
 */
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

/**
 * OAuth-callback result notice (contract C2): the backend callback 302s to
 * `/settings?tab=integrations&connected=<provider>` / `&error=<code>`. The
 * params are captured once on mount and then stripped from the URL by the
 * panel, so a refresh never re-shows a stale notice.
 */
function CallbackNotice({
  notice,
}: Readonly<{ notice: { connected: string | null; error: string | null } }>) {
  if (notice.connected) {
    const family =
      notice.connected === 'gsc' || notice.connected === 'ga4' || notice.connected === 'bing'
        ? GRANT_FAMILY[notice.connected]
        : null;
    if (family === 'google') {
      return (
        <Alert tone="success">
          <strong>Google connected.</strong> Search Console and Analytics 4 are now linked on one
          shared OAuth grant. Select a property for each below to start importing — nothing syncs
          until a property is chosen.
        </Alert>
      );
    }
    if (family === 'microsoft') {
      return (
        <Alert tone="success">
          <strong>Bing connected.</strong> Bing Webmaster Tools is now linked. Select a property
          below to start importing — nothing syncs until a property is chosen.
        </Alert>
      );
    }
    return (
      <Alert tone="success">
        <strong>Integration connected.</strong> Select a property below to start importing — nothing
        syncs until a property is chosen.
      </Alert>
    );
  }
  if (notice.error) {
    return (
      <Alert tone="danger">
        <strong>Connection failed.</strong> {oauthErrorMessage(notice.error)}
      </Alert>
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

  // C2 callback params — captured once (like the ?tab= deep link), then
  // cleaned from the URL so they don't linger across refresh/share.
  const [notice] = useState(() => ({
    connected: searchParams.get('connected'),
    error: searchParams.get('error'),
  }));
  const hasCallbackParams = searchParams.has('connected') || searchParams.has('error');
  useEffect(() => {
    if (!hasCallbackParams) return;
    // A fresh connect changes the list — refetch before stripping the params.
    if (notice.connected) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.integrations.all });
    }
    // Shallow URL cleanup, NOT a redirect: the params have already been captured
    // into `notice`, so this only rewrites the address bar. A route navigation
    // would re-render every mounted settings panel for nothing.
    window.history.replaceState(null, '', '/settings?tab=integrations');
  }, [hasCallbackParams, notice.connected, queryClient]);

  const connectionsQuery = useQuery({
    queryKey: queryKeys.integrations.connections(workspaceId),
    queryFn: ({ signal }) => integrationsApi.list({ signal, workspaceId }),
    enabled: workspaceId !== null,
  });

  const connections = connectionsQuery.data ?? [];
  const grants = groupIntoGrants(connections);

  if (!workspaceId) return <Alert tone="info">Loading your workspace…</Alert>;

  return (
    <Stack gap="workspace">
      <CallbackNotice notice={notice} />

      {connectionsQuery.isError ? (
        <ReadError
          error={connectionsQuery.error}
          fallback="Could not load integrations. Check your connection and try again."
          onRetry={() => void connectionsQuery.refetch()}
          pending={connectionsQuery.isFetching}
        />
      ) : null}

      {connectionsQuery.isLoading ? (
        <div className="grid gap-[var(--workspace-gap)] xl:grid-cols-2">
          {[0, 1].map((i) => (
            <Card key={i}>
              <CardContent>
                <Stack gap="compact">
                  <Skeleton className="h-5 w-24" />
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                </Stack>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}

      {!connectionsQuery.isLoading && !connectionsQuery.isError && connections.length === 0 ? (
        <IntegrationsEmptyState workspaceId={workspaceId} />
      ) : null}

      {!connectionsQuery.isLoading && !connectionsQuery.isError && connections.length > 0 ? (
        <div className="grid [grid-template-columns:repeat(auto-fit,minmax(min(100%,520px),1fr))] gap-[var(--workspace-gap)]">
          {FAMILY_ORDER.map((family) => (
            <IntegrationCardView
              workspaceId={workspaceId}
              key={family}
              family={family}
              grant={grants.find((grant) => grant.family === family) ?? null}
            />
          ))}
        </div>
      ) : null}
      <CrawlLogConnections />
    </Stack>
  );
}
