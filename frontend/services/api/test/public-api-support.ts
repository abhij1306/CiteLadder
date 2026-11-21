import { expect } from 'vitest';

import { createApp } from '../src/app.ts';
import { TEST_SESSION_COOKIE, sessionToken, testConfig, testDatabase } from './support.ts';
import { VisibilityFixtures, type Tenant } from './visibility-fixtures.ts';

export function publicApiHarness() {
  const config = testConfig();
  const db = testDatabase(config);
  const app = createApp(config, db);
  const fixtures = new VisibilityFixtures(db);

  async function validProjects(workspaceId: string) {
    await db
      .updateTable('projects')
      .set({ benchmark_mode: 'consumer_like' })
      .where('workspace_id', '=', workspaceId)
      .execute();
  }

  async function withApiAccess<T extends Tenant>(tenant: T): Promise<T> {
    await validProjects(tenant.workspaceId);
    return tenant;
  }

  async function browser(userId: string, workspaceId: string, path: string, body?: unknown) {
    return app.request(`/api/v1${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        cookie: `${TEST_SESSION_COOKIE}=${await sessionToken({ sub: userId, ver: 0 })}`,
        'x-workspace-id': workspaceId,
        'content-type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  async function createKey(
    tenant: Tenant,
    input: { scopes?: string[]; project_ids?: string[]; expires_at?: string } = {},
  ) {
    const response = await browser(tenant.userId, tenant.workspaceId, '/api-keys', {
      name: 'CI export',
      ...input,
    });
    expect(response.status).toBe(201);
    return (await response.json()) as {
      key: { id: string; prefix: string; scopes: string[] };
      secret: string;
    };
  }

  function api(
    secret: string,
    path: string,
    options: { method?: string; body?: unknown; idempotencyKey?: string } = {},
  ) {
    return app.request(`/v1${path}`, {
      method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
      headers: {
        authorization: `Bearer ${secret}`,
        'content-type': 'application/json',
        ...(options.idempotencyKey ? { 'idempotency-key': options.idempotencyKey } : {}),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
  }

  return { config, db, app, fixtures, validProjects, withApiAccess, browser, createKey, api };
}
