import { randomUUID } from 'node:crypto';

import { Hono, type Context } from 'hono';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { budget, spendBudget } from '../src/abuse/usage.ts';
import { createApp } from '../src/app.ts';
import { WorkspaceContext } from '../src/auth/workspace.ts';
import { policy } from '../src/config.ts';
import type { AppEnv } from '../src/context.ts';
import { onError } from '../src/errors.ts';
import { ROUTE_CONTRACTS } from '../src/openapi/routes.ts';
import { withIdempotency } from '../src/public-api/idempotency.ts';
import { requirePathOwnership } from '../src/public-api/ownership.ts';
import { auditTenant } from './audit-fixtures.ts';
import { actionRow } from './opportunity-fixtures.ts';
import { prompt, promptSet, topic } from './prompt-fixtures.ts';
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

/** A public write behind `withIdempotency`, authenticated as the given key. */
function idempotentApp(
  workspaceId: string,
  apiKeyId: string,
  handler: (c: Context<AppEnv>) => Promise<Response>,
) {
  const idempotent = new Hono<AppEnv>();
  idempotent.onError(onError);
  idempotent.use(async (c, next) => {
    c.set('workspace', new WorkspaceContext(workspaceId, 'owner'));
    c.set('apiKey', { id: apiKeyId, projectIds: null });
    await next();
  });
  idempotent.post('/write', (c) => withIdempotency(db, c, () => handler(c)));
  return idempotent;
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

  it('answers a retry of a failed write "outcome unknown", not "in progress"', async () => {
    const tenant = await withApiAccess(await fixtures.tenant());
    const { key } = await createKey(tenant, { scopes: ['prompts:write'] });
    const writes: string[] = [];
    const idempotent = idempotentApp(tenant.workspaceId, key.id, async (c) => {
      const kind = c.req.query('kind') ?? '';
      writes.push(kind);
      if (kind === 'throw') throw new Error('write crashed after commit');
      return c.json({ ok: false }, 503);
    });
    const send = (kind: string, idempotencyKey: string) =>
      idempotent.request(`/write?kind=${kind}`, {
        method: 'POST',
        headers: { 'idempotency-key': idempotencyKey, 'content-type': 'application/json' },
        body: '{}',
      });

    expect((await send('throw', 'crash-1')).status).toBe(500);
    expect((await send('unavailable', 'fail-1')).status).toBe(503);
    for (const [kind, idempotencyKey] of [
      ['throw', 'crash-1'],
      ['unavailable', 'fail-1'],
    ] as const) {
      const retry = await send(kind, idempotencyKey);
      expect(retry.status).toBe(409);
      expect(await retry.json()).toMatchObject({
        error: { code: 'idempotency_outcome_unknown', retryable: false },
      });
    }
    expect(writes).toEqual(['throw', 'unavailable']);
  });

  it('answers "in progress" while a claim is fresh and "outcome unknown" once it is stale', async () => {
    const tenant = await withApiAccess(await fixtures.tenant());
    const { key } = await createKey(tenant, { scopes: ['prompts:write'] });
    let finish = () => {};
    const running = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let started = () => {};
    const claimed = new Promise<void>((resolve) => {
      started = resolve;
    });
    const idempotent = idempotentApp(tenant.workspaceId, key.id, async (c) => {
      started();
      await running;
      return c.json({ ok: true }, 201);
    });
    const send = () =>
      idempotent.request('/write', {
        method: 'POST',
        headers: { 'idempotency-key': 'slow-1', 'content-type': 'application/json' },
        body: '{}',
      });

    const first = send();
    await claimed;
    const inProgress = await send();
    expect(inProgress.status).toBe(409);
    expect(await inProgress.json()).toMatchObject({
      error: { code: 'idempotency_conflict', retryable: true },
    });

    const stale = policy.public_api.idempotency.in_progress_max_seconds + 1;
    await db
      .updateTable('api_idempotency')
      .set({ created_at: new Date(Date.now() - stale * 1000) })
      .where('api_key_id', '=', key.id)
      .execute();
    const abandoned = await send();
    expect(abandoned.status).toBe(409);
    expect(await abandoned.json()).toMatchObject({
      error: { code: 'idempotency_outcome_unknown', retryable: false },
    });
    finish();
    expect((await first).status).toBe(201);
  });

  it('answers 429 with Retry-After once the key’s minute is spent', async () => {
    const tenant = await withApiAccess(await fixtures.tenant());
    const { key, secret } = await createKey(tenant);
    const perKey = budget('public_api_key');
    await spendBudget(db, perKey, key.id, { amount: perKey.limit });
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

  it('refuses every public write that names another project’s record and leaves it unchanged', async () => {
    const tenant = await withApiAccess(await fixtures.tenant());
    const other = await fixtures.project(tenant.workspaceId);
    await validProjects(tenant.workspaceId);
    const scope = { workspace_id: tenant.workspaceId, project_id: other };
    const setId = await promptSet(db, other);
    const auditId = await fixtures.audit(
      { ...tenant, projectId: other },
      { status: 'running', completedAt: null },
    );
    const action = actionRow(scope, {
      group_key: 'page:guide',
      target_kind: 'page',
      target_label: 'Guide',
    });
    await db.insertInto('actions').values(action).execute();
    const scheduleId = randomUUID();
    await db
      .insertInto('audit_schedules')
      .values({
        ...scope,
        id: scheduleId,
        prompt_set_id: setId,
        audit_scope: 'brand',
        cadence: 'weekly',
        enabled: true,
        engines: JSON.stringify(['chatgpt']),
        failure_count: 0,
        last_error: '',
        timezone: 'UTC',
        created_at: new Date(),
        updated_at: new Date(),
      })
      .execute();
    const candidateId = randomUUID();
    await db
      .insertInto('observed_entity_candidates')
      .values({
        ...scope,
        id: candidateId,
        audit_id: auditId,
        name: 'Fleet Feet',
        domain: 'fleetfeet.example',
        qualification_reason: 'Cited across prompts and engines',
        prompt_count: 2,
        engine_count: 2,
        market_relevant: true,
        analyzer_version: 'observed-competitor-v1',
        source_analysis_ids: JSON.stringify([randomUUID()]),
        source_artifact_ids: JSON.stringify([]),
        status: 'pending',
        created_at: new Date(),
      })
      .execute();
    const foreignIds: Record<string, string> = {
      prompt_set_id: setId,
      prompt_id: await prompt(db, setId, 'Which trail shoes grip wet rock?'),
      topic_id: await topic(db, other, 'Trail running'),
      action_id: action.id,
      audit_id: auditId,
      competitor_id: await fixtures.competitor(other, { name: 'Globex' }),
      schedule_id: scheduleId,
      candidate_id: candidateId,
    };
    const bodies: Record<string, unknown> = {
      'post /v1/projects/{project_id}/prompt-sets/{prompt_set_id}/generate': {},
      'post /v1/projects/{project_id}/prompt-sets/{prompt_set_id}/import': { prompts: [] },
      'post /v1/projects/{project_id}/prompt-sets/{prompt_set_id}/candidates/review': {
        accept_ids: [randomUUID()],
        reject_ids: [],
      },
      'post /v1/projects/{project_id}/prompt-sets/{prompt_set_id}/prompts': {
        prompts: [{ text: 'Which trail shoes drain fast?' }],
      },
      'patch /v1/projects/{project_id}/prompts/{prompt_id}': { enabled: false },
      'patch /v1/projects/{project_id}/topics/{topic_id}': { name: 'Road running' },
      'patch /v1/projects/{project_id}/actions/{action_id}': { status: 'dismissed' },
      'post /v1/projects/{project_id}/actions/{action_id}/declaration': {
        declared_implemented_at: new Date().toISOString(),
      },
      'patch /v1/projects/{project_id}/competitors/{competitor_id}': { name: 'Initech' },
      'patch /v1/projects/{project_id}/audit-schedules/{schedule_id}': { enabled: false },
    };
    const state = async () => ({
      prompts: await db
        .selectFrom('prompts')
        .select(['text', 'enabled', 'status'])
        .where('prompt_set_id', '=', setId)
        .execute(),
      topics: await db
        .selectFrom('topics')
        .select('name')
        .where('project_id', '=', other)
        .execute(),
      action: await db
        .selectFrom('actions')
        .select('status')
        .where('id', '=', action.id)
        .executeTakeFirstOrThrow(),
      audit: await db
        .selectFrom('audits')
        .select('status')
        .where('id', '=', auditId)
        .executeTakeFirstOrThrow(),
      competitors: await db
        .selectFrom('competitors')
        .select('name')
        .where('project_id', '=', other)
        .execute(),
      schedule: await db
        .selectFrom('audit_schedules')
        .select('enabled')
        .where('id', '=', scheduleId)
        .executeTakeFirstOrThrow(),
      candidate: await db
        .selectFrom('observed_entity_candidates')
        .select('status')
        .where('id', '=', candidateId)
        .executeTakeFirstOrThrow(),
    });
    const before = await state();
    const { secret } = await createKey(tenant, {
      scopes: [
        'prompts:write',
        'actions:write',
        'audits:run',
        'competitors:write',
        'schedules:write',
      ],
      project_ids: [tenant.projectId],
    });
    const writes = ROUTE_CONTRACTS.filter(
      (contract) =>
        contract.exposure === 'public' &&
        contract.method !== 'get' &&
        /\{(?!project_id)[a-z_]+_id\}/u.test(contract.path),
    );
    const outcomes = [];
    for (const contract of writes) {
      const path = contract.path
        .replace(/^\/v1/u, '')
        .replace('{project_id}', tenant.projectId)
        .replaceAll(/\{([a-z_]+)\}/gu, (_, name: string) => foreignIds[name] ?? `missing:${name}`);
      const response = await api(secret, path, {
        method: contract.method.toUpperCase(),
        body: bodies[`${contract.method} ${contract.path}`] ?? {},
        idempotencyKey: randomUUID(),
      });
      outcomes.push(`${response.status} ${contract.method} ${contract.path}`);
    }
    expect(outcomes.filter((outcome) => !outcome.startsWith('404 '))).toEqual([]);
    expect(outcomes).toHaveLength(16);
    expect(await state()).toEqual(before);
  });

  it('fails closed on a path ID parameter with no listed owner', async () => {
    const tenant = await fixtures.tenant();
    const params = { project_id: tenant.projectId, widget_id: randomUUID() };
    for (const access of ['read', 'write'] as const)
      await expect(
        requirePathOwnership(db, tenant.workspaceId, tenant.projectId, params, access),
      ).rejects.toThrow('Public path parameter widget_id has no owner');
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
