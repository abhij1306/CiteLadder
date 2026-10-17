import { afterAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.ts';
import { TEST_SESSION_COOKIE, sessionToken, testConfig, testDatabase } from './support.ts';
import { VisibilityFixtures, type Tenant } from './visibility-fixtures.ts';

const config = testConfig();
const db = testDatabase(config);
const app = createApp(config, db);
const fixtures = new VisibilityFixtures(db);
afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});

async function call(
  tenant: Pick<Tenant, 'userId' | 'workspaceId'>,
  projectId: string,
  body?: unknown,
) {
  const response = await app.request(`/api/v1/projects/${projectId}/overview/layout`, {
    method: body === undefined ? 'GET' : 'PUT',
    headers: {
      cookie: `${TEST_SESSION_COOKIE}=${await sessionToken({ sub: tenant.userId, ver: 0 })}`,
      'x-workspace-id': tenant.workspaceId,
      'content-type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

const DEFAULT_WIDGETS = [
  { key: 'project_state', size: 'half' },
  { key: 'citation_share', size: 'half' },
  { key: 'movement', size: 'half' },
  { key: 'next_action', size: 'half' },
  { key: 'missing_prompts', size: 'full' },
  { key: 'ranked_actions', size: 'half' },
  { key: 'progress_proof', size: 'half' },
  { key: 'company_facts', size: 'full' },
];

describe('Overview layout', () => {
  it('serves the default until saved, then the saved layout, and resets to the default', async () => {
    const tenant = await fixtures.tenant();
    expect(await call(tenant, tenant.projectId)).toEqual({
      status: 200,
      body: { widgets: DEFAULT_WIDGETS, version: 0, customized: false, updated_at: null },
    });

    const widgets = [
      { key: 'perception', size: 'full' },
      { key: 'project_state', size: 'half' },
    ];
    const saved = await call(tenant, tenant.projectId, { widgets, expected_version: 0 });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ widgets, version: 1, customized: true });
    expect((await call(tenant, tenant.projectId)).body).toMatchObject({ widgets, version: 1 });

    const reset = await call(tenant, tenant.projectId, { widgets: null, expected_version: 1 });
    expect(reset.body).toMatchObject({ widgets: DEFAULT_WIDGETS, version: 2, customized: false });
  });

  it('refuses a stale version and a repeated widget without changing the layout', async () => {
    const tenant = await fixtures.tenant();
    const widgets = [{ key: 'movement', size: 'full' }];
    await call(tenant, tenant.projectId, { widgets, expected_version: 0 });

    const stale = await call(tenant, tenant.projectId, {
      widgets: [{ key: 'perception', size: 'half' }],
      expected_version: 0,
    });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ error: { code: 'overview_layout_conflict' } });

    const repeated = await call(tenant, tenant.projectId, {
      widgets: [
        { key: 'movement', size: 'half' },
        { key: 'movement', size: 'full' },
      ],
      expected_version: 1,
    });
    expect(repeated.status).toBe(422);
    expect((await call(tenant, tenant.projectId)).body).toMatchObject({ widgets, version: 1 });
  });

  it('lets viewers read but not edit, and hides another workspace project', async () => {
    const tenant = await fixtures.tenant();
    const viewer = await fixtures.user();
    await fixtures.member(tenant.workspaceId, viewer, 'viewer');
    const reader = { userId: viewer, workspaceId: tenant.workspaceId };
    expect((await call(reader, tenant.projectId)).status).toBe(200);
    expect(
      (await call(reader, tenant.projectId, { widgets: null, expected_version: 0 })).status,
    ).toBe(403);

    const stranger = await fixtures.tenant();
    expect((await call(stranger, tenant.projectId)).status).toBe(404);
    expect(
      (await call(stranger, tenant.projectId, { widgets: null, expected_version: 0 })).status,
    ).toBe(404);
  });
});
