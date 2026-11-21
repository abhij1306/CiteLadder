import { randomUUID } from 'node:crypto';

import { createApp } from '../src/app.ts';
import { TEST_SESSION_COOKIE, sessionToken, testConfig, testDatabase } from './support.ts';
import { VisibilityFixtures, type Json, type Tenant } from './visibility-fixtures.ts';

export type Body = Record<string, unknown>;
export type Row = Record<string, unknown>;

export const route = (tenant: Tenant, suffix = '') =>
  `/api/v1/projects/${tenant.projectId}/visibility${suffix}`;

export function frozen(overrides: Record<string, unknown> = {}): Json {
  return {
    brand_name: 'Acme Corp',
    brand_aliases: [],
    owned_domains: ['acme.example'],
    competitors: [{ name: 'Globex', aliases: [], domains: ['globex.example'] }],
    country_code: 'US',
    language_code: 'en',
    benchmark_mode: 'standard',
    panel_hash: 'panel-1',
    prompt_selection: 'set',
    engine_routes: {
      chatgpt: { transport_provider: 'test', transport_model: 'model-a', retrieval_enabled: true },
    },
    measurement_policy: {
      retrieval_enabled: true,
      max_output_tokens: 1000,
      answer_instruction: '',
    },
    ...overrides,
  } as Json;
}

export function visibilityReads() {
  const config = testConfig();
  const db = testDatabase(config);
  const fixtures = new VisibilityFixtures(db);
  const app = createApp(config, db);

  async function get(
    tenant: Tenant,
    path: string,
    query: Record<string, string | string[]> = {},
  ): Promise<{ status: number; body: Body & Row[] }> {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      for (const item of [value].flat()) search.append(key, item);
    }
    const token = await sessionToken({ sub: tenant.userId, ver: 0 });
    const suffix = search.size ? `?${search}` : '';
    const response = await app.request(`${path}${suffix}`, {
      headers: { cookie: `${TEST_SESSION_COOKIE}=${token}` },
    });
    return { status: response.status, body: (await response.json()) as Body & Row[] };
  }

  async function measuredRun(
    tenant: Tenant,
    completedAt: string,
    metrics: Record<string, unknown>,
    options: {
      visibilityScore?: number;
      analyzerVersion?: string;
      configuration?: Json;
      finalize?: boolean;
    } = {},
  ): Promise<string> {
    const auditId = await fixtures.audit(tenant, {
      completedAt: new Date(completedAt),
      configuration: options.configuration ?? frozen(),
    });
    await fixtures.metricSnapshot(tenant, auditId, {
      metrics: { ...metrics, per_engine: { chatgpt: metrics } } as Json,
      visibilityScore: options.visibilityScore,
      analyzerVersion: options.analyzerVersion,
      finalize: options.finalize,
    });
    return auditId;
  }

  async function newMarket(tenant: Tenant): Promise<string> {
    const marketId = randomUUID();
    await db
      .insertInto('project_markets')
      .values({
        id: marketId,
        workspace_id: tenant.workspaceId,
        project_id: tenant.projectId,
        label: 'United Kingdom',
        country_code: 'GB',
        language_code: 'en',
        created_at: new Date(),
      })
      .execute();
    return marketId;
  }

  return { db, fixtures, get, measuredRun, newMarket };
}
