import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { enforceSubjectRequest } from '../src/abuse/usage.ts';
import { createApp } from '../src/app.ts';
import { policy } from '../src/config.ts';
import { ROUTE_CONTRACTS } from '../src/openapi/routes.ts';
import { auditTenant } from './audit-fixtures.ts';
import { prompt, promptSet } from './prompt-fixtures.ts';
import { TEST_SESSION_COOKIE, sessionToken, testConfig, testDatabase } from './support.ts';
import { VisibilityFixtures, type Tenant } from './visibility-fixtures.ts';

const config = testConfig();
const db = testDatabase(config);
const app = createApp(config, db);
const fixtures = new VisibilityFixtures(db);

afterEach(async () => {
  await fixtures.cleanup();
});
afterAll(async () => {
  await db.destroy();
});

/** A workspace whose projects satisfy the public contract. */
async function withApiAccess<T extends Tenant>(tenant: T): Promise<T> {
  await validProjects(tenant.workspaceId);
  return tenant;
}

/** The shared project fixture's benchmark mode predates the project contract's enum. */
async function validProjects(workspaceId: string) {
  await db
    .updateTable('projects')
    .set({ benchmark_mode: 'consumer_like' })
    .where('workspace_id', '=', workspaceId)
    .execute();
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

async function errorCode(response: Response): Promise<string> {
  return ((await response.json()) as { error: { code: string } }).error.code;
}

async function securityEvents(keyId: string): Promise<string[]> {
  const rows = await db
    .selectFrom('security_events')
    .select('event')
    .where('target_id', '=', keyId)
    .orderBy('occurred_at')
    .execute();
  return rows.map((row) => row.event);
}

describe('API keys', () => {
  it('authenticates the shown secret by prefix and refuses a forged secret with the same prefix', async () => {
    const tenant = await withApiAccess(await fixtures.tenant());
    const { key, secret } = await createKey(tenant);
    expect(secret.startsWith(key.prefix)).toBe(true);
    expect(key.prefix).toMatch(/^cl_live_[0-9A-Za-z]{8}$/u);
    expect(key.scopes).toEqual(['read']);

    const listed = await api(secret, '/projects');
    expect(listed.status).toBe(200);
    expect(((await listed.json()) as { items: { id: string }[] }).items.map((p) => p.id)).toEqual([
      tenant.projectId,
    ]);

    const forged = await api(`${key.prefix}${'x'.repeat(43)}`, '/projects');
    expect(forged.status).toBe(401);
    expect(await errorCode(forged)).toBe('invalid_api_key');
    const cookieOnly = await app.request(`/v1/projects`, {
      headers: {
        cookie: `${TEST_SESSION_COOKIE}=${await sessionToken({ sub: tenant.userId, ver: 0 })}`,
      },
    });
    expect(cookieOnly.status).toBe(401);
    expect(await securityEvents(key.id)).toEqual(['api_key.create']);
  });

  it('narrows a key to its creator’s live role', async () => {
    const tenant = await withApiAccess(await fixtures.tenant());
    const admin = await fixtures.user();
    await fixtures.member(tenant.workspaceId, admin, 'admin');
    const { secret } = await createKey(
      { ...tenant, userId: admin },
      { scopes: ['prompts:write', 'audits:run'] },
    );
    const topic = (name: string) =>
      api(secret, `/projects/${tenant.projectId}/topics`, {
        body: { name },
        idempotencyKey: randomUUID(),
      });
    expect((await topic('Trail shoes')).status).toBe(201);

    const memberId = await db
      .selectFrom('workspace_members')
      .select('id')
      .where('workspace_id', '=', tenant.workspaceId)
      .where('user_id', '=', admin)
      .executeTakeFirstOrThrow();
    await db
      .updateTable('workspace_members')
      .set({ role: 'viewer' })
      .where('id', '=', memberId.id)
      .execute();
    const demoted = await topic('Road shoes');
    expect(demoted.status).toBe(403);
    expect(await errorCode(demoted)).toBe('workspace_role_forbidden');
    expect((await api(secret, `/projects/${tenant.projectId}/topics`)).status).toBe(200);
  });

  it('stops a key while an operator has disabled its creator', async () => {
    const tenant = await withApiAccess(await fixtures.tenant());
    const { secret } = await createKey(tenant);
    const active = (value: boolean) =>
      db.updateTable('users').set({ is_active: value }).where('id', '=', tenant.userId).execute();
    expect((await api(secret, '/projects')).status).toBe(200);
    await active(false);
    try {
      const disabled = await api(secret, '/projects');
      expect(disabled.status).toBe(401);
      expect(await errorCode(disabled)).toBe('invalid_api_key');
    } finally {
      await active(true);
    }
    expect((await api(secret, '/projects')).status).toBe(200);
  });

  it('refuses revoked and expired keys and records each refusal once per hour', async () => {
    const tenant = await withApiAccess(await fixtures.tenant());
    const { key, secret } = await createKey(tenant);
    const revoke = await browser(
      tenant.userId,
      tenant.workspaceId,
      `/api-keys/${key.id}/revoke`,
      {},
    );
    expect(revoke.status).toBe(200);
    expect(((await revoke.json()) as { state: string }).state).toBe('revoked');
    expect((await api(secret, '/projects')).status).toBe(401);
    expect((await api(secret, '/projects')).status).toBe(401);
    expect(await securityEvents(key.id)).toEqual([
      'api_key.create',
      'api_key.revoke',
      'api_key.rejected_revoked',
    ]);

    const expiring = await createKey(tenant);
    await db
      .updateTable('api_keys')
      .set({ expires_at: new Date(Date.now() - 1000) })
      .where('id', '=', expiring.key.id)
      .execute();
    const expired = await api(expiring.secret, '/projects');
    expect(expired.status).toBe(401);
    expect(await securityEvents(expiring.key.id)).toEqual([
      'api_key.create',
      'api_key.rejected_expired',
    ]);
  });
});

describe('public API requests', () => {
  it('replays a repeated Idempotency-Key and refuses it for a different body', async () => {
    const tenant = await withApiAccess(await fixtures.tenant());
    const { secret } = await createKey(tenant, { scopes: ['prompts:write'] });
    const path = `/projects/${tenant.projectId}/topics`;
    const first = await api(secret, path, { body: { name: 'Trail shoes' }, idempotencyKey: 'k-1' });
    expect(first.status).toBe(201);
    const created = (await first.json()) as { id: string };
    const replay = await api(secret, path, {
      body: { name: 'Trail shoes' },
      idempotencyKey: 'k-1',
    });
    expect(replay.status).toBe(201);
    expect(replay.headers.get('idempotent-replayed')).toBe('true');
    expect(((await replay.json()) as { id: string }).id).toBe(created.id);
    const conflict = await api(secret, path, {
      body: { name: 'Road shoes' },
      idempotencyKey: 'k-1',
    });
    expect(conflict.status).toBe(409);
    expect(await errorCode(conflict)).toBe('idempotency_conflict');
    const missing = await api(secret, path, { body: { name: 'Road shoes' } });
    expect(missing.status).toBe(422);
    const topics = await db
      .selectFrom('topics')
      .select('name')
      .where('project_id', '=', tenant.projectId)
      .execute();
    expect(topics.map((topic) => topic.name)).toEqual(['Trail shoes']);
  });

  it('answers 429 with Retry-After once the key’s minute is spent', async () => {
    const tenant = await withApiAccess(await fixtures.tenant());
    const { key, secret } = await createKey(tenant);
    const {
      operation,
      limit,
      window_seconds: windowSeconds,
    } = policy.public_api.rate_limits.api_key;
    await enforceSubjectRequest(db, 'api_key', key.id, {
      operation,
      limit,
      windowSeconds,
      amount: limit,
    });
    const throttled = await api(secret, '/projects');
    expect(throttled.status).toBe(429);
    expect(Number(throttled.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
  });

  it('keeps a key inside its project allowlist and its workspace', async () => {
    const tenant = await withApiAccess(await fixtures.tenant());
    const other = await fixtures.project(tenant.workspaceId);
    const otherSet = await promptSet(db, other);
    const otherPrompt = await prompt(db, otherSet, 'Which trail shoes grip wet rock?');
    await validProjects(tenant.workspaceId);
    const foreign = await withApiAccess(await fixtures.tenant());
    const { secret } = await createKey(tenant, {
      scopes: ['prompts:write'],
      project_ids: [tenant.projectId],
    });
    const listed = (await (await api(secret, '/projects')).json()) as { items: { id: string }[] };
    expect(listed.items.map((item) => item.id)).toEqual([tenant.projectId]);
    expect((await api(secret, `/projects/${other}/topics`)).status).toBe(404);
    expect((await api(secret, `/projects/${foreign.projectId}/topics`)).status).toBe(404);
    // A prompt from another project is not reachable through an allowed project's path.
    const crossed = await api(secret, `/projects/${tenant.projectId}/prompts/${otherPrompt}`, {
      method: 'PATCH',
      body: { enabled: false },
    });
    expect(crossed.status).toBe(404);
    const untouched = await db
      .selectFrom('prompts')
      .select('enabled')
      .where('id', '=', otherPrompt)
      .executeTakeFirstOrThrow();
    expect(untouched.enabled).toBe(true);
  });

  it('refuses every public write to a read-only key', async () => {
    const tenant = await withApiAccess(await fixtures.tenant());
    const { secret } = await createKey(tenant);
    const writes = ROUTE_CONTRACTS.filter(
      (contract) =>
        contract.exposure === 'public' &&
        contract.method !== 'get' &&
        !contract.path.endsWith('/audits/estimate'),
    );
    expect(writes.map((contract) => `${contract.method} ${contract.path}`)).toEqual(
      expect.arrayContaining([
        'post /v1/projects/{project_id}/audits',
        'patch /v1/projects/{project_id}/prompts/{prompt_id}',
        'delete /v1/projects/{project_id}/competitors/{competitor_id}',
        'post /v1/projects/{project_id}/audit-schedules',
        'post /v1/projects/{project_id}/actions/{action_id}/declaration',
      ]),
    );
    for (const contract of writes) {
      const path = contract.path
        .replace(/^\/v1/u, '')
        .replace('{project_id}', tenant.projectId)
        .replaceAll(/\{[a-z_]+\}/gu, randomUUID());
      const response = await api(secret, path, {
        method: contract.method.toUpperCase(),
        body: {},
        idempotencyKey: randomUUID(),
      });
      expect([contract.path, response.status]).toEqual([contract.path, 403]);
    }
  });

  it('launches an audit in one call only within max_attempts', async () => {
    const tenant = await withApiAccess(await auditTenant(db, fixtures));
    const { secret } = await createKey(tenant, { scopes: ['audits:run'] });
    const request = { prompt_set_id: tenant.setId, engines: ['chatgpt'] };
    const estimate = (await (
      await api(secret, `/projects/${tenant.projectId}/audits/estimate`, { body: request })
    ).json()) as { maximum_attempt_count: number };

    const refused = await api(secret, `/projects/${tenant.projectId}/audits`, {
      body: { ...request, max_attempts: estimate.maximum_attempt_count - 1 },
      idempotencyKey: 'launch-1',
    });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({
      error: {
        code: 'estimate_exceeds_limit',
        details: { maximum_attempt_count: estimate.maximum_attempt_count },
      },
    });

    const launched = await api(secret, `/projects/${tenant.projectId}/audits`, {
      body: { ...request, max_attempts: estimate.maximum_attempt_count },
      idempotencyKey: 'launch-2',
    });
    expect(launched.status).toBe(201);
    // One launch, one audit per market: the default market alone here.
    const [audit, ...others] = (await launched.json()) as { id: string; status: string }[];
    expect([audit?.status, others]).toEqual(['queued', []]);
    const listed = (await (await api(secret, `/projects/${tenant.projectId}/audits`)).json()) as {
      items: { id: string }[];
    };
    expect(listed.items.map((item) => item.id)).toEqual([audit?.id]);
  });

  it('adds, renames and removes one tracked competitor at a time', async () => {
    const tenant = await withApiAccess(await fixtures.tenant());
    const { secret } = await createKey(tenant, { scopes: ['competitors:write'] });
    const root = `/projects/${tenant.projectId}/competitors`;
    const added = await api(secret, root, {
      body: { name: 'Stride', aliases: ['Stride Original'], domains: ['stride.example'] },
      idempotencyKey: 'c-1',
    });
    expect(added.status).toBe(201);
    const { id } = (await added.json()) as { id: string };
    const duplicate = await api(secret, root, { body: { name: 'STRIDE' }, idempotencyKey: 'c-2' });
    expect(duplicate.status).toBe(409);
    const renamed = await api(secret, `${root}/${id}`, {
      method: 'PATCH',
      body: { name: 'Stride Running' },
    });
    expect(await renamed.json()).toMatchObject({
      id,
      name: 'Stride Running',
      aliases: ['Stride Original'],
      domains: ['stride.example'],
    });
    expect((await api(secret, `${root}/${id}`, { method: 'DELETE' })).status).toBe(204);
    expect(await (await api(secret, root)).json()).toEqual([]);
    expect((await api(secret, `${root}/${id}`, { method: 'DELETE' })).status).toBe(404);
  });

  it('creates a batch of prompts all together or not at all', async () => {
    const tenant = await withApiAccess(await auditTenant(db, fixtures));
    const { secret } = await createKey(tenant, { scopes: ['prompts:write'] });
    const path = `/projects/${tenant.projectId}/prompt-sets/${tenant.setId}/prompts`;
    const repeated = await api(secret, path, {
      body: {
        prompts: [
          { text: 'Which running shoes last longest?' },
          { text: 'Which running shoes last longest?' },
        ],
      },
      idempotencyKey: 'p-1',
    });
    expect(repeated.status).toBe(409);
    const created = await api(secret, path, {
      body: {
        prompts: [
          { text: 'Which running shoes last longest?' },
          { text: 'Which running shoes suit wide feet?', cohort: 'brand_diagnostic' },
        ],
      },
      idempotencyKey: 'p-2',
    });
    expect(created.status).toBe(201);
    const listed = (await (
      await api(secret, `/projects/${tenant.projectId}/prompts?limit=2`)
    ).json()) as {
      items: { text: string; latest_measurement: { state: string } }[];
      next_cursor: string | null;
    };
    expect(listed.items.map((item) => [item.text, item.latest_measurement.state])).toEqual([
      ['Which running shoes suit road use?', 'not_measured'],
      ['Which running shoes last longest?', 'not_measured'],
    ]);
    const next = (await (
      await api(
        secret,
        `/projects/${tenant.projectId}/prompts?limit=2&cursor=${listed.next_cursor}`,
      )
    ).json()) as { items: { text: string }[]; next_cursor: string | null };
    // Brand diagnostics have no per-prompt visibility reading.
    expect(next).toMatchObject({
      items: [
        {
          text: 'Which running shoes suit wide feet?',
          latest_measurement: { state: 'unavailable' },
        },
      ],
      next_cursor: null,
    });
    // A cursor belongs to its endpoint and filters.
    const elsewhere = await api(
      secret,
      `/projects/${tenant.projectId}/prompts?limit=2&status=archived&cursor=${listed.next_cursor}`,
    );
    expect(elsewhere.status).toBe(400);
    expect(await errorCode(elsewhere)).toBe('invalid_cursor');
  });

  it('publishes every public operation in the OpenAPI document without a key', async () => {
    const response = await app.request('/v1/openapi.json');
    expect(response.status).toBe(200);
    const document = (await response.json()) as {
      paths: Record<string, Record<string, unknown>>;
      components: { schemas: Record<string, unknown> };
    };
    expect(document.paths['/v1/projects/{project_id}/audits']).toHaveProperty('post');
    expect(Object.keys(document.paths).every((path) => path.startsWith('/v1/'))).toBe(true);
    // Shared shapes are named once and every reference resolves to one.
    expect(document.paths['/v1/projects/{project_id}/prompt-sets/{prompt_set_id}']).toMatchObject({
      get: {
        responses: {
          200: {
            content: { 'application/json': { schema: { $ref: '#/components/schemas/PromptSet' } } },
          },
        },
      },
    });
    const refs = [
      ...JSON.stringify(document).matchAll(/"\$ref":"#\/components\/schemas\/([^"]+)"/g),
    ];
    expect(refs.filter(([, name]) => !(name! in document.components.schemas))).toEqual([]);
  });
});
