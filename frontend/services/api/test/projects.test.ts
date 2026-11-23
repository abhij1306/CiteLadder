import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.ts';
import { projectSchema } from '@citeladder/contracts/project';
import { projectCreate, projectUpdate } from '../src/projects/inputs.ts';
import {
  createProject,
  readProject,
  updateProject,
  deleteProject,
} from '../src/projects/service.ts';
import { appendCostProjection } from '../src/audits/costs.ts';
import { commandCenter } from '../src/projects/command-center.ts';
import { prompt, promptSet } from './prompt-fixtures.ts';
import { COMPETITORS_WRITE } from '../src/commands/competitors.ts';
import {
  TEST_SESSION_COOKIE,
  Fixtures,
  ownerActor,
  sessionToken,
  testConfig,
  testDatabase,
} from './support.ts';
import { VisibilityFixtures } from './visibility-fixtures.ts';

describe('project owner', () => {
  const db = testDatabase();
  const fixtures = new Fixtures(db);
  const measurements = new VisibilityFixtures(db);
  afterAll(async () => {
    await measurements.cleanup();
    await fixtures.cleanup();
    await db.destroy();
  });
  async function tenant() {
    const userId = await fixtures.user();
    const workspaceId = await fixtures.ownedWorkspace(userId);
    return { userId, workspaceId };
  }
  it('persists identity and provenance, updates collections atomically and remaps market', async () => {
    const t = await tenant();
    const created = await createProject(
      db,
      t.workspaceId,
      t.userId,
      projectCreate.parse({
        name: 'Acme',
        brand_name: 'Acme',
        brand: { aliases: [' ACME ', 'Acme'] },
        country_code: 'IN',
        language_code: 'en',
        owned_domains: ['acme.com'],
        description: ' Reviewed description ',
        products_services: ['Analytics', 'analytics', ' '],
        competitors: [{ name: 'Globex', domains: ['globex.com'] }],
      }),
    );
    const scope = { workspaceId: t.workspaceId, projectId: created.id };
    expect(projectSchema.parse(created)).toMatchObject({
      brand: { aliases: ['ACME'] },
      owned_domains: ['acme.com'],
    });
    const profile = await db
      .selectFrom('brand_profiles')
      .selectAll()
      .where('project_id', '=', created.id)
      .executeTakeFirstOrThrow();
    expect(profile.sources).toMatchObject({
      description: { origin: 'manual', review_state: 'confirmed', reviewed_by: t.userId },
    });
    expect(profile.products_services).toEqual(['Analytics']);
    const renamed = await createApp(testConfig(), db).request(`/api/v1/projects/${created.id}`, {
      method: 'PATCH',
      headers: {
        cookie: `${TEST_SESSION_COOKIE}=${await sessionToken({ sub: t.userId, ver: 0 })}`,
        'X-Workspace-Id': t.workspaceId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Renamed' }),
    });
    expect(renamed.status).toBe(200);
    expect(await renamed.json()).toEqual({
      ...created,
      name: 'Renamed',
      updated_at: expect.any(String),
    });
    const changed = await updateProject(
      db,
      ownerActor(t.workspaceId, t.userId, COMPETITORS_WRITE),
      created.id,
      projectUpdate.parse({
        brand_name: 'New Acme',
        brand: { aliases: [] },
        country_code: 'GLOBAL',
        competitors: [],
        unintended_domains: ['unrelated.com'],
      }),
    );
    expect(changed).toMatchObject({
      brand_name: 'New Acme',
      brand: { aliases: [] },
      competitors: [],
      unintended_domains: ['unrelated.com'],
    });
    expect(
      await db
        .selectFrom('projects')
        .select('serp_location_code')
        .where('id', '=', created.id)
        .executeTakeFirst(),
    ).toEqual({ serp_location_code: 0 });
    await expect(readProject(db, { ...scope, workspaceId: randomUUID() })).rejects.toMatchObject({
      status: 404,
    });
    await deleteProject(db, scope);
    await expect(readProject(db, scope)).rejects.toMatchObject({ status: 404 });
  });
  it('keeps competitor and domain rows, IDs and logos across repeated editor saves', async () => {
    const t = await tenant();
    const created = await createProject(
      db,
      t.workspaceId,
      t.userId,
      projectCreate.parse({
        name: 'Repeat',
        brand_name: 'Repeat',
        owned_domains: ['repeat.com'],
        competitors: [
          { name: 'Globex', domains: ['globex.com'] },
          { name: 'Initech', domains: ['initech.com'] },
        ],
      }),
    );
    const globex = created.competitors.find((item) => item.name === 'Globex')!;
    const logoId = randomUUID();
    const logoDomain = `logo-${logoId}.example`;
    const now = new Date();
    await db
      .insertInto('brand_logo_assets')
      .values({
        id: logoId,
        domain: logoDomain,
        status: 'ready',
        source_url: `https://${logoDomain}/icon.png`,
        content_type: 'image/png',
        image_data: Buffer.from([1]),
        byte_size: 1,
        sha256: 'a'.repeat(64),
        fetched_at: now,
        retry_after: null,
        created_at: now,
        updated_at: now,
      })
      .execute();
    await db
      .updateTable('competitors')
      .set({ logo_asset_id: logoId })
      .where('id', '=', globex.id)
      .execute();
    const ownedIds = async () =>
      (
        await db
          .selectFrom('owned_domains')
          .select(['id', 'domain'])
          .where('project_id', '=', created.id)
          .orderBy('domain')
          .execute()
      ).map((row) => [row.domain, row.id]);
    const repeatId = (await ownedIds())[0]![1];
    const app = createApp(testConfig(), db);
    const save = async (body: unknown) =>
      app.request(`/api/v1/projects/${created.id}`, {
        method: 'PATCH',
        headers: {
          cookie: `${TEST_SESSION_COOKIE}=${await sessionToken({ sub: t.userId, ver: 0 })}`,
          'X-Workspace-Id': t.workspaceId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    const edit = {
      owned_domains: ['repeat.com', 'repeat.net'],
      competitors: [
        { name: 'globex', aliases: ['Globex Corp'], domains: ['globex.com'] },
        { name: 'Hooli', domains: ['hooli.com'] },
      ],
    };
    const first = await save(edit);
    expect(first.status).toBe(200);
    const once = projectSchema.parse(await first.json());
    const domainsOnce = await ownedIds();
    const second = projectSchema.parse(await (await save(edit)).json());
    const hooli = once.competitors.find((item) => item.name === 'Hooli')!;
    expect(second.competitors).toEqual(once.competitors);
    expect(
      second.competitors.map(({ id, name, aliases, domains, logo_url }) => ({
        id,
        name,
        aliases,
        domains,
        has_logo: logo_url !== null,
      })),
    ).toEqual([
      {
        id: globex.id,
        name: 'globex',
        aliases: ['Globex Corp'],
        domains: ['globex.com'],
        has_logo: true,
      },
      { id: hooli.id, name: 'Hooli', aliases: [], domains: ['hooli.com'], has_logo: false },
    ]);
    expect(domainsOnce[0]).toEqual(['repeat.com', repeatId]);
    expect(domainsOnce.map(([domain]) => domain)).toEqual(['repeat.com', 'repeat.net']);
    expect(await ownedIds()).toEqual(domainsOnce);
    const saved = await save({ owned_domains: ['REPEAT.com'] });
    expect(saved.status).toBe(200);
    expect(await ownedIds()).toEqual([['REPEAT.com', repeatId]]);
    const renamed = await save({
      competitors: [{ id: globex.id, name: 'Globex Group', domains: ['globex.com'] }],
    });
    expect(projectSchema.parse(await renamed.json()).competitors).toEqual([
      expect.objectContaining({ id: globex.id, name: 'Globex Group', aliases: [] }),
    ]);
    const renamedLogo = second.competitors.find((item) => item.id === globex.id)!.logo_url;
    expect(
      (await readProject(db, { workspaceId: t.workspaceId, projectId: created.id })).competitors[0]!
        .logo_url,
    ).toBe(renamedLogo);
    const foreign = await save({ competitors: [{ id: randomUUID(), name: 'Ghost' }] });
    expect(foreign.status).toBe(404);
    const duplicate = await save({ competitors: [{ name: 'Hooli' }, { name: 'hooli' }] });
    expect(duplicate.status).toBe(409);
    for (const tooLong of [
      { owned_domains: [`${'a'.repeat(252)}.com`] },
      { brand: { aliases: ['a'.repeat(256)] } },
      { competitors: [{ name: 'Globex', domains: [`${'g'.repeat(252)}.com`] }] },
    ])
      expect((await save(tooLong)).status).toBe(422);
    await db.deleteFrom('brand_logo_assets').where('id', '=', logoId).execute();
  });
  it('defaults common-word names to needing context and saves only touched, tracked rules', async () => {
    const t = await tenant();
    const created = await createProject(
      db,
      t.workspaceId,
      t.userId,
      projectCreate.parse({
        name: 'Target',
        brand_name: 'Target',
        products_services: ['Home goods'],
        competitors: [{ name: 'Globex', domains: ['globex.com'] }],
      }),
    );
    expect(created.brand.matching).toMatchObject({
      mode: 'context_required',
      common_word: true,
      context_terms: ['Home goods', 'Globex'],
    });
    expect(created.competitors[0]!.matching).toMatchObject({ mode: 'always', common_word: false });
    const changed = await updateProject(
      db,
      ownerActor(t.workspaceId, t.userId, COMPETITORS_WRITE),
      created.id,
      projectUpdate.parse({
        entity_matching: [
          { name: 'Globex', mode: 'context_required', context_terms: ['retail'] },
          { name: 'Untracked Co', mode: 'context_required' },
        ],
      }),
    );
    expect(changed.competitors[0]!.matching).toMatchObject({
      mode: 'context_required',
      context_terms: ['retail'],
    });
    const profile = await db
      .selectFrom('brand_profiles')
      .select('business_context')
      .where('project_id', '=', created.id)
      .executeTakeFirstOrThrow();
    expect(
      Object.keys(
        (profile.business_context as { entity_matching: { entities: object } }).entity_matching
          .entities,
      ),
    ).toEqual(['globex']);
  });
  it('resolves project links through membership and keeps viewers read only', async () => {
    const t = await tenant();
    const project = await createProject(
      db,
      t.workspaceId,
      t.userId,
      projectCreate.parse({ name: 'Linked' }),
    );
    const viewer = await fixtures.user();
    await fixtures.member(t.workspaceId, viewer, 'viewer');
    const other = await tenant();
    const app = createApp(testConfig(), db);
    const headers = {
      cookie: `${TEST_SESSION_COOKIE}=${await sessionToken({ sub: viewer, ver: 0 })}`,
      'X-Workspace-Id': other.workspaceId,
    };
    const response = await app.request(`/api/v1/projects/${project.id}`, { headers });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ workspace_id: t.workspaceId });
    const denied = await app.request(`/api/v1/projects/${project.id}`, {
      method: 'PATCH',
      headers: { ...headers, 'X-Workspace-Id': t.workspaceId, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'No' }),
    });
    expect(denied.status).toBe(403);
    const foreign = await app.request(`/api/v1/projects/${project.id}`, {
      headers: {
        cookie: `${TEST_SESSION_COOKIE}=${await sessionToken({ sub: other.userId, ver: 0 })}`,
      },
    });
    expect(foreign.status).toBe(404);
  });
  it('changes a project only through the active workspace that holds it', async () => {
    const t = await tenant();
    const project = await createProject(
      db,
      t.workspaceId,
      t.userId,
      projectCreate.parse({ name: 'Held' }),
    );
    const other = await tenant();
    const writer = await fixtures.user();
    await fixtures.member(t.workspaceId, writer, 'member');
    await fixtures.member(other.workspaceId, writer, 'member');
    const app = createApp(testConfig(), db);
    const cookie = `${TEST_SESSION_COOKIE}=${await sessionToken({ sub: writer, ver: 0 })}`;
    const rename = (workspaceId: string, name: string) =>
      app.request(`/api/v1/projects/${project.id}`, {
        method: 'PATCH',
        headers: {
          cookie,
          'X-Workspace-Id': workspaceId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name }),
      });
    expect((await rename(other.workspaceId, 'Elsewhere')).status).toBe(404);
    const held = await rename(t.workspaceId, 'Renamed');
    expect(held.status).toBe(200);
    expect(await held.json()).toMatchObject({ name: 'Renamed' });
  });
  it.each(['admin', 'member', 'viewer'] as const)(
    'admits project creation by workspace write capability for %s',
    async (role) => {
      const t = await tenant();
      const user = await fixtures.user();
      await fixtures.member(t.workspaceId, user, role);
      const headers = {
        cookie: `${TEST_SESSION_COOKIE}=${await sessionToken({ sub: user, ver: 0 })}`,
        'X-Workspace-Id': t.workspaceId,
        'Content-Type': 'application/json',
      };
      const response = await createApp(testConfig(), db).request('/api/v1/projects', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Role project' }),
      });
      expect(response.status).toBe(role === 'viewer' ? 403 : 201);
    },
  );
  it('lists only projects in the authorized workspace', async () => {
    const a = await tenant();
    const b = await tenant();
    const project = await createProject(
      db,
      a.workspaceId,
      a.userId,
      projectCreate.parse({ name: 'Mine' }),
    );
    await createProject(db, b.workspaceId, b.userId, projectCreate.parse({ name: 'Foreign' }));
    const app = createApp(testConfig(), db);
    const response = await app.request('/api/v1/projects', {
      headers: {
        cookie: `${TEST_SESSION_COOKIE}=${await sessionToken({ sub: a.userId, ver: 0 })}`,
        'X-Workspace-Id': a.workspaceId,
      },
    });
    expect(await response.json()).toEqual([
      {
        id: project.id,
        name: 'Mine',
        brand_name: project.brand_name,
        website_url: project.website_url,
        brand: { logo_url: null },
      },
    ]);
    // Without a test cookie the request acts as the local user, in its own workspace.
    const local = await app.request('/api/v1/projects');
    expect(local.status).toBe(200);
    expect(((await local.json()) as { id: string }[]).map((row) => row.id)).not.toContain(
      project.id,
    );
  });
  it("keeps a deleted project's answer-engine costs with their exact source IDs", async () => {
    const retained = new VisibilityFixtures(db);
    const t = await retained.tenant();
    const audit = await retained.audit(t);
    const { taskId } = await retained.execution(t, { auditId: audit });
    const artifact = await db
      .selectFrom('raw_response_artifacts')
      .select('id')
      .where('task_id', '=', taskId)
      .executeTakeFirstOrThrow();
    const projection = await db
      .transaction()
      .execute((trx) => appendCostProjection(trx, t.workspaceId, artifact.id));
    await deleteProject(db, { workspaceId: t.workspaceId, projectId: t.projectId });
    expect(
      await db
        .selectFrom('execution_cost_projections')
        .select(['audit_id', 'task_id', 'raw_response_artifact_id'])
        .where('id', '=', projection!.id)
        .execute(),
    ).toEqual([{ audit_id: audit, task_id: taskId, raw_response_artifact_id: artifact.id }]);
  });
  it('deletes a project with audit history', async () => {
    const retained = new VisibilityFixtures(db);
    const t = await retained.tenant();
    const audit = await retained.audit(t);
    await retained.execution(t, { auditId: audit });
    await deleteProject(db, { workspaceId: t.workspaceId, projectId: t.projectId });
    expect(
      await db.selectFrom('projects').select('id').where('id', '=', t.projectId).execute(),
    ).toEqual([]);
    expect(await db.selectFrom('audits').select('id').where('id', '=', audit).execute()).toEqual(
      [],
    );
  });
  it('lets an admin delete a project but not a member', async () => {
    const t = await tenant();
    const project = await createProject(
      db,
      t.workspaceId,
      t.userId,
      projectCreate.parse({ name: 'Disposable' }),
    );
    const app = createApp(testConfig(), db);
    const remove = async (role: 'member' | 'admin') => {
      const user = await fixtures.user();
      await fixtures.member(t.workspaceId, user, role);
      const token = await sessionToken({ sub: user, ver: 0 });
      const response = await app.request(`/api/v1/projects/${project.id}`, {
        method: 'DELETE',
        headers: { cookie: `${TEST_SESSION_COOKIE}=${token}` },
      });
      return response.status;
    };
    expect(await remove('member')).toBe(403);
    expect(await remove('admin')).toBe(204);
  });

  it('overview reads persisted state and counts only enabled active prompts', async () => {
    const t = await tenant();
    const project = await createProject(
      db,
      t.workspaceId,
      t.userId,
      projectCreate.parse({ name: 'Overview' }),
    );
    const scope = { workspaceId: t.workspaceId, projectId: project.id };
    expect((await commandCenter(db, scope, null)).next_action).toMatchObject({
      kind: 'configure_prompts',
      href: '/prompts',
    });
    const set = await promptSet(db, project.id);
    await prompt(db, set, 'Which service?');
    const disabled = await prompt(db, set, 'Which vendor?');
    await db.updateTable('prompts').set({ enabled: false }).where('id', '=', disabled).execute();
    const view = await commandCenter(db, scope, null);
    expect(view).toMatchObject({
      active_prompt_count: 1,
      next_action: { kind: 'audit', href: '/runs' },
      report_available: false,
      loop: { tracked: { state: 'not_run' } },
      state: { visibility: { value: null, delta: null } },
    });
    const running = await new VisibilityFixtures(db).audit(
      { userId: t.userId, ...scope },
      { status: 'running', completedAt: null },
    );
    expect((await commandCenter(db, scope, null)).next_action).toMatchObject({
      kind: 'audit_running',
      href: `/runs/${running}`,
    });
    await expect(
      commandCenter(db, { workspaceId: t.workspaceId, projectId: project.id }, randomUUID()),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('reads the action order once for the overview and versions its actions with it', async () => {
    const t = await tenant();
    const project = await createProject(
      db,
      t.workspaceId,
      t.userId,
      projectCreate.parse({ name: 'Ordered' }),
    );
    const scope = { workspaceId: t.workspaceId, projectId: project.id };
    const now = new Date();
    await db
      .insertInto('opportunity_orders')
      .values({
        id: randomUUID(),
        workspace_id: t.workspaceId,
        project_id: project.id,
        ordered_keys: '[]',
        version: 3,
        updated_by_user_id: t.userId,
        created_at: now,
        updated_at: now,
      })
      .execute();
    let orderReads = 0;
    const observed = db.withPlugin({
      transformQuery: ({ node }) => {
        if (
          node.kind === 'SelectQueryNode' &&
          JSON.stringify(node).includes('"opportunity_orders"')
        )
          orderReads += 1;
        return node;
      },
      transformResult: ({ result }) => Promise.resolve(result),
    });

    const view = await commandCenter(observed, scope, null);

    expect(view.action_order_version).toBe(3);
    expect(orderReads).toBe(1);
  });
});
