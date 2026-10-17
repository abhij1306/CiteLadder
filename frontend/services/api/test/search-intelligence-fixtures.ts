/** Search Intelligence rows a dataset hangs from: a tested connection and a confirmed run. */
import { randomUUID } from 'node:crypto';

import { policy } from '../src/config.ts';
import type { Database } from '../src/db/database.ts';

/** A succeeded, confirmed acquisition run for the tenant's project; returns its id. */
export async function searchIntelligenceRun(
  db: Database,
  tenant: { workspaceId: string; projectId: string; userId: string },
): Promise<string> {
  const connectionId = randomUUID(),
    runId = randomUUID(),
    at = new Date();
  await db
    .insertInto('provider_connections')
    .values({
      id: connectionId,
      workspace_id: tenant.workspaceId,
      label: 'DataForSEO',
      transport_provider: 'dataforseo',
      api_key_encrypted: 'ciphertext',
      base_url: '',
      credential_revision: randomUUID(),
      active: true,
      last_test_status: 'ok',
      created_at: at,
      updated_at: at,
    })
    .execute();
  await db
    .insertInto('search_intelligence_runs')
    .values({
      id: runId,
      workspace_id: tenant.workspaceId,
      project_id: tenant.projectId,
      actor_user_id: tenant.userId,
      connection_id: connectionId,
      connection_revision: randomUUID(),
      account_identity: 'account',
      credential_source: 'byok',
      estimated_credits: null,
      charged_credits: null,
      platform_call_id: null,
      status: 'succeeded',
      action: 'analysis',
      idempotency_key: runId,
      frozen_scope: '{}',
      call_plan: '[]',
      reused_datasets: '[]',
      pricing_version: policy.search_intelligence.price_version,
      estimated_cost_usd: '0.1',
      planned_calls: 1,
      completed_calls: 1,
      planned_rows: 10,
      received_rows: 10,
      uncertain_calls: 0,
      error_code: '',
      error_detail: '',
      expires_at: at,
      confirmed_at: at,
      created_at: at,
      updated_at: at,
    })
    .execute();
  return runId;
}
