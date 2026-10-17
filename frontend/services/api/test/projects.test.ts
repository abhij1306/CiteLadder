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
import { commandCenter } from '../src/projects/command-center.ts';
import { policy } from '../src/config.ts';
import { prompt, promptSet } from './prompt-fixtures.ts';
import {
  TEST_SESSION_COOKIE,
  Fixtures,
  sessionToken,
  testConfig,
  testDatabase,
} from './support.ts';
import { VisibilityFixtures } from './visibility-fixtures.ts';
import { actionFixture, type ActionSeed } from './action-support.ts';

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
      scope,
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
      context_terms: ['Home goods'],
    });
    expect(created.competitors[0]!.matching).toMatchObject({ mode: 'always', common_word: false });
    const scope = { workspaceId: t.workspaceId, projectId: created.id };
    const changed = await updateProject(
      db,
      scope,
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
    expect(((await response.json()) as { id: string }[]).map((row) => row.id)).toEqual([
      project.id,
    ]);
    // Without a test cookie the request acts as the local user, in its own workspace.
    const local = await app.request('/api/v1/projects');
    expect(local.status).toBe(200);
    expect(((await local.json()) as { id: string }[]).map((row) => row.id)).not.toContain(
      project.id,
    );
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
    // Measurement leads the ladder: without prompts there is nothing to measure.
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
    // A first audit under way is reported as running, not as a step to take.
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
  it('retains exact declaration and verified observation IDs in resolved action summaries', async () => {
    // Immutable fixture evidence is retained until the disposable database is dropped.
    const seeded = await actionFixture<ActionSeed>('seed');
    const actionId = seeded.actions.missing_structured_data!;
    const action = await db
      .selectFrom('actions')
      .select('opportunity_snapshot_id')
      .where('id', '=', actionId)
      .executeTakeFirstOrThrow();
    const scope = { workspaceId: seeded.workspace_id, projectId: seeded.project_id };
    const now = new Date();
    const implementationId = randomUUID();
    await db
      .insertInto('opportunity_implementation_events')
      .values({
        id: implementationId,
        workspace_id: scope.workspaceId,
        project_id: scope.projectId,
        action_id: actionId,
        actor_user_id: seeded.user_id,
        created_at: now,
        declared_implemented_at: now,
        expected_checks: '[]',
        idempotency_key: implementationId,
        member_opportunity_ids: '[]',
        opportunity_snapshot_id: action.opportunity_snapshot_id!,
        output_revision_id: null,
        request_fingerprint: 'recorded-test',
        target_external_url: null,
        target_site_url_ids: '[]',
      })
      .execute();
    const verifiedId = randomUUID();
    await db
      .insertInto('opportunity_verification_events')
      .values({
        id: verifiedId,
        workspace_id: scope.workspaceId,
        project_id: scope.projectId,
        implementation_event_id: implementationId,
        audit_id: null,
        crawl_id: null,
        created_at: now,
        observed_at: now,
        idempotency_key: verifiedId,
        limitations: '[]',
        observation_kind: 'verified',
        result: '{}',
        source_analysis_ids: '[]',
        source_metric_ids: '[]',
        source_rule_evaluation_ids: '[]',
        verifier_version: '1',
      })
      .execute();
    const observation = await db
      .selectFrom('opportunity_verification_events')
      .selectAll()
      .where('id', '=', verifiedId)
      .executeTakeFirstOrThrow();
    await db
      .insertInto('opportunity_verification_events')
      .values({
        ...observation,
        id: randomUUID(),
        idempotency_key: randomUUID(),
        created_at: new Date(now.getTime() + 1000),
      })
      .execute();
    await db
      .updateTable('audits')
      .set({ status: 'failed' })
      .where('project_id', '=', scope.projectId)
      .execute();
    expect((await commandCenter(db, scope, null)).resolved_actions).toMatchObject({
      count: 1,
      evidence: [
        {
          action_id: actionId,
          implementation_event_ids: [implementationId],
          verification_event_ids: [verifiedId],
        },
      ],
    });
  }, 60_000);
  it('overview compares frozen measurements and keeps unknown metrics distinct from observed zero', async () => {
    const t = await measurements.tenant();
    await db
      .updateTable('projects')
      .set({ benchmark_mode: 'consumer_like' })
      .where('id', '=', t.projectId)
      .execute();
    await measurements.brand(t.projectId, 'Acme Corp');
    const configuration = {
      brand_name: 'Acme Corp',
      brand_aliases: [],
      owned_domains: ['acme.example'],
      competitors: [],
      country_code: 'US',
      language_code: 'en',
      benchmark_mode: 'consumer_like',
      panel_hash: 'panel-1',
      engine_routes: { chatgpt: { transport_provider: 'test', transport_model: 'test' } },
      measurement_policy: {
        retrieval_enabled: true,
        max_output_tokens: 1000,
        answer_instruction: '',
      },
    };
    async function measured(
      at: string,
      count: number,
      score: number,
      config = configuration,
      status = 'completed',
    ) {
      const id = await measurements.audit(t, {
        completedAt: new Date(at),
        configuration: config,
        status,
      });
      const aggregate = {
        total_completed: 2,
        brand_mention_count: count,
        owned_citation_response_count: 0,
        brand_mention_rate: count / 2,
        owned_citation_rate: 0,
        competitor_mention_rate: {},
        competitor_citation_rate: {},
        share_of_voice: { mention_counts: { 'Acme Corp': count } },
        coverage: { requested: 2, failed: 0, not_run: 0 },
      };
      await measurements.metricSnapshot(t, id, {
        metrics: { ...aggregate, per_engine: { chatgpt: aggregate } },
        visibilityScore: score,
      });
      return id;
    }
    const baseline = await measured('2026-03-01T00:00:00Z', 0, 0);
    for (let index = 0; index < policy.projects.command_center_max_audits; index++) {
      await measurements.audit(t, {
        completedAt: new Date(Date.UTC(2025, 0, 1) + index * 86400000),
        configuration: { ...configuration, panel_hash: 'older-panel' },
      });
    }
    await measured('2026-03-02T00:00:00Z', 1, 20, {
      ...configuration,
      panel_hash: 'different-panel',
    });
    // A partially completed run is read like a completed one, as on the Visibility page.
    const current = await measured(
      '2026-03-03T00:00:00Z',
      2,
      40,
      configuration,
      'partially_completed',
    );
    const view = await commandCenter(db, t, null);
    expect(view).toMatchObject({
      measurement: {
        audit_id: current,
        comparable_audit_id: baseline,
        analyzer_version: 'test',
        scoring_rule_version: 'test',
      },
      // Visibility is the mention rate (2 of 2 answers), not the weighted score (40).
      state: { visibility: { value: 100, delta: 100 } },
      track: { citation_share: { value: 0, delta: 0 } },
      report_available: true,
      stale: false,
    });
    const historical = await commandCenter(db, t, baseline);
    expect(historical).toMatchObject({ stale: true, loop: { tracked: { freshness: 'unknown' } } });
    expect(
      await db
        .selectFrom('metric_snapshots')
        .select('audit_id')
        .where('id', '=', view.measurement!.metric_snapshot_id!)
        .executeTakeFirst(),
    ).toEqual({ audit_id: current });
    expect(historical.state.visibility).toEqual({
      value: 0,
      delta: null,
    });
    await expect(
      commandCenter(db, { ...t, workspaceId: randomUUID() }, null),
    ).rejects.toMatchObject({ status: 404 });
  });
});
