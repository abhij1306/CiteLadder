import type { Database } from '../db/database.ts';
import { providerPolicy } from './config.ts';
import { tenantConnections } from './connections.ts';

/** Read only the latest persisted probe; never test or repair a connection. */
export async function connectionStates(db: Database, workspaceId: string, at = new Date()) {
  const connections = await tenantConnections(db, workspaceId)
    .where('c.active', '=', true)
    .orderBy('c.created_at', 'desc')
    .orderBy('c.id', 'desc')
    .execute();
  const ids = connections.map((row) => row.id);
  const probes = ids.length
    ? await db
        .selectFrom('provider_connection_tests')
        .selectAll()
        .where('workspace_id', '=', workspaceId)
        .where('connection_id', 'in', ids)
        .distinctOn('connection_id')
        .orderBy('connection_id')
        .orderBy('created_at', 'desc')
        .orderBy('id', 'desc')
        .execute()
    : [];
  return {
    workspace_id: workspaceId,
    providers: providerPolicy.catalog.map((entry) => {
      const route = providerPolicy.routes[entry.key as keyof typeof providerPolicy.routes];
      const connection = connections.find(
        (row) => row.transport_provider === route?.transport_provider,
      );
      const probe = probes.find((row) => row.connection_id === connection?.id);
      const paused =
        connection?.paused_at != null &&
        (connection.pause_until == null || connection.pause_until > at);
      let state: 'unavailable' | 'missing' | 'failed' | 'connected';
      let reason: string | null;
      if (!entry.adapter_shipped) {
        state = 'unavailable';
        reason = entry.unavailable_reason;
      } else if (!connection?.api_key_encrypted || !probe || connection.last_tested_at == null) {
        state = 'missing';
        reason = 'verification_required';
      } else if (paused || probe.status !== 'ok') {
        state = 'failed';
        reason = paused ? connection.pause_reason || 'unknown' : probe.error_code || 'unknown';
      } else {
        state = 'connected';
        reason = null;
      }
      return {
        key: entry.key,
        label: entry.label,
        state,
        safe_reason: reason,
        grant_key: entry.grant_key,
        latest_probe:
          state === 'missing' || state === 'unavailable' || !probe
            ? null
            : {
                status: probe.status === 'ok' ? ('ok' as const) : ('failed' as const),
                safe_reason: reason,
                tested_at: probe.created_at.toISOString(),
                model: probe.transport_model || null,
                latency_ms: probe.latency_ms,
              },
      };
    }),
  };
}
