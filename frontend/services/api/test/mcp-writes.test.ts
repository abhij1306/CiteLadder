import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, expect, it, onTestFinished, vi } from 'vitest';
import { ApiError } from '../src/errors.ts';
import { mcpPolicy } from '../src/mcp/config.ts';
import { admitWriteCall } from '../src/mcp/registration.ts';
import type { McpPrincipal } from '../src/mcp/types.ts';
import { dispatchWrite } from '../src/mcp/write-tools.ts';
import { auditTenant } from './audit-fixtures.ts';
import { topic } from './prompt-fixtures.ts';
import { testConfig, testDatabase } from './support.ts';
import { VisibilityFixtures } from './visibility-fixtures.ts';

const config = testConfig();
const db = testDatabase(config);
const fixtures = new VisibilityFixtures(db);
const clients: string[] = [];

afterEach(async () => {
  await fixtures.cleanup();
});
afterAll(async () => {
  if (clients.length)
    await db.deleteFrom('mcp_oauth_clients').where('client_id', 'in', clients).execute();
  await db.destroy();
});

async function connection(
  tenant: { userId: string; workspaceId: string },
  scopes = ['citeladder:read', 'citeladder:write'],
): Promise<McpPrincipal> {
  const clientId = randomUUID();
  clients.push(clientId);
  await db
    .insertInto('mcp_oauth_clients')
    .values({
      id: randomUUID(),
      client_id: clientId,
      client_metadata: JSON.stringify({ client_name: 'test' }),
      client_secret_encrypted: '',
      created_at: new Date(),
    })
    .execute();
  const principal = {
    userId: tenant.userId,
    grantId: randomUUID(),
    workspaceIds: [tenant.workspaceId],
    tokenHash: randomUUID(),
    canWrite: scopes.includes('citeladder:write'),
  };
  await db
    .insertInto('mcp_oauth_grants')
    .values({
      id: principal.grantId,
      client_id: clientId,
      user_id: tenant.userId,
      workspace_ids: JSON.stringify(principal.workspaceIds),
      scopes: JSON.stringify(scopes),
      resource: 'https://protocol.example.test/mcp',
      access_token_hash: principal.tokenHash,
      refresh_token_hash: randomUUID(),
      access_expires_at: new Date(Date.now() + 3600000),
      refresh_expires_at: new Date(Date.now() + 7200000),
      revoked_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    })
    .execute();
  return principal;
}
const call = (principal: McpPrincipal, name: Parameters<typeof dispatchWrite>[1], args: unknown) =>
  dispatchWrite({ db, config, principal, origin: 'https://app.example.test' }, name, args);
const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => 'succeeded',
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );
async function promptTexts(setId: string) {
  return (
    await db
      .selectFrom('prompts')
      .select(['text', 'status'])
      .where('prompt_set_id', '=', setId)
      .orderBy('created_at')
      .execute()
  ).map((row) => `${row.text} [${row.status}]`);
}
async function setRole(tenant: { userId: string; workspaceId: string }, role: string) {
  await db
    .updateTable('workspace_members')
    .set({ role })
    .where('user_id', '=', tenant.userId)
    .where('workspace_id', '=', tenant.workspaceId)
    .execute();
}

it('previews a prompt add without writing, then activates it once on confirmation', async () => {
  const tenant = await auditTenant(db, fixtures);
  const principal = await connection(tenant);
  const prepared = await call(principal, 'prepare_add_prompts', {
    project_id: tenant.projectId,
    prompts: [
      { text: 'Which running shoes last longest?' },
      { text: 'Which running shoes suit road use?' },
    ],
  });
  expect(prepared).toMatchObject({
    state: 'needs_confirmation',
    preview:
      'Add 1 active prompt(s) to "Set": "Which running shoes last longest?". Dropped: "Which running shoes suit road use?" (An equivalent prompt already exists in this set).',
    dropped: [
      {
        text: 'Which running shoes suit road use?',
        reason: 'An equivalent prompt already exists in this set',
      },
    ],
  });
  expect(String(prepared.preview)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  expect(await promptTexts(tenant.setId)).toEqual(['Which running shoes suit road use? [active]']);

  const token = { confirmation_token: String(prepared.confirmation_token) };
  expect(await call(principal, 'confirm_change', token)).toMatchObject({
    state: 'changed',
    change: 'add_prompts',
    summary: 'Added 1 active prompt(s).',
  });
  expect(await promptTexts(tenant.setId)).toEqual([
    'Which running shoes suit road use? [active]',
    'Which running shoes last longest? [active]',
  ]);
  expect(await failure(call(principal, 'confirm_change', token))).toBe(
    'This change was already confirmed.',
  );
  expect(
    (
      await db
        .selectFrom('security_events')
        .select(['event', 'target_id'])
        .where('actor_id', '=', tenant.userId)
        .where('event', 'like', 'mcp.write.%')
        .execute()
    ).map((row) => [row.event, row.target_id]),
  ).toEqual([['mcp.write.add_prompts', tenant.projectId]]);
});

it('files a confirmed prompt with no cohort by brand naming, as the browser does', async () => {
  const tenant = await auditTenant(db, fixtures);
  const principal = await connection(tenant);
  const prepared = await call(principal, 'prepare_add_prompts', {
    project_id: tenant.projectId,
    prompts: [
      { text: 'Is Acme Running good for marathon training?' },
      { text: 'Which running shoes last longest?' },
      { text: 'Is Acme Running sold in Europe?', cohort: 'core' },
    ],
  });
  expect(prepared.dropped).toEqual([]);
  await call(principal, 'confirm_change', {
    confirmation_token: String(prepared.confirmation_token),
  });
  const rows = await db
    .selectFrom('prompts')
    .select(['text', 'cohort'])
    .where('prompt_set_id', '=', tenant.setId)
    .orderBy('text')
    .execute();
  expect(rows.map((row) => `${row.text} [${row.cohort}]`)).toEqual([
    'Is Acme Running good for marathon training? [brand_diagnostic]',
    'Is Acme Running sold in Europe? [core]',
    'Which running shoes last longest? [core]',
    'Which running shoes suit road use? [core]',
  ]);
});

it('runs a token confirmed twice at once exactly one time', async () => {
  const tenant = await auditTenant(db, fixtures);
  const principal = await connection(tenant);
  const prepared = await call(principal, 'prepare_add_prompts', {
    project_id: tenant.projectId,
    prompts: [{ text: 'Which running shoes last longest?' }],
  });
  const token = { confirmation_token: String(prepared.confirmation_token) };
  const outcomes = await Promise.all([
    failure(call(principal, 'confirm_change', token)),
    failure(call(principal, 'confirm_change', token)),
  ]);
  expect(outcomes.sort()).toEqual(['This change was already confirmed.', 'succeeded']);
  expect(await promptTexts(tenant.setId)).toEqual([
    'Which running shoes suit road use? [active]',
    'Which running shoes last longest? [active]',
  ]);
});

it('keeps a passing prompt whose identical earlier copy failed binding', async () => {
  const tenant = await auditTenant(db, fixtures);
  const principal = await connection(tenant);
  const topicId = await topic(db, tenant.projectId, 'Trail boots', 'Boots for muddy trails');
  const prepared = await call(principal, 'prepare_add_prompts', {
    project_id: tenant.projectId,
    prompts: [
      { text: 'Which trail boots grip mud best?' },
      { text: 'Which trail boots grip mud best?', topic_id: topicId },
    ],
  });
  expect(prepared).toMatchObject({
    state: 'needs_confirmation',
    dropped: [{ text: 'Which trail boots grip mud best?' }],
  });
  expect(String(prepared.preview)).toContain('Add 1 active prompt(s)');
});

it('archives, refiles and activates a selection only on confirmation, all or nothing', async () => {
  const tenant = await auditTenant(db, fixtures);
  const principal = await connection(tenant);
  const prepare = (args: Record<string, unknown>) =>
    call(principal, 'prepare_update_prompts', { project_id: tenant.projectId, ...args });
  const confirm = async (prepared: Record<string, unknown>) =>
    call(principal, 'confirm_change', { confirmation_token: String(prepared.confirmation_token) });
  const filedUnder = async () =>
    (
      await db
        .selectFrom('prompts')
        .select('topic_id')
        .where('id', '=', tenant.promptId)
        .executeTakeFirstOrThrow()
    ).topic_id;

  const archive = await prepare({ change: 'archive', prompt_ids: [tenant.promptId] });
  expect(archive.preview).toBe(
    'Archive 1 prompt(s): "Which running shoes suit road use?". Future audits stop measuring them; past results stay.',
  );
  expect(await promptTexts(tenant.setId)).toEqual(['Which running shoes suit road use? [active]']);
  expect(await confirm(archive)).toMatchObject({
    change: 'update_prompts',
    summary: 'Archived 1 prompt(s).',
  });
  expect(await promptTexts(tenant.setId)).toEqual([
    'Which running shoes suit road use? [archived]',
  ]);

  const shoes = await topic(db, tenant.projectId, 'Running shoes');
  const refile = await prepare({
    change: 'assign_topic',
    prompt_ids: [tenant.promptId],
    topic_id: shoes,
  });
  expect(refile.preview).toBe(
    'File 1 prompt(s) under the topic "Running shoes": "Which running shoes suit road use?". Past runs keep the topic they had.',
  );
  expect(await filedUnder()).toBeNull();
  await confirm(refile);
  expect(await filedUnder()).toBe(shoes);

  const elsewhere = await auditTenant(db, fixtures);
  expect(
    await failure(
      prepare({ change: 'activate', prompt_ids: [tenant.promptId, elsewhere.promptId] }),
    ),
  ).toBe('1 prompt(s) were not found in this project');
  expect(await failure(prepare({ change: 'assign_topic', prompt_ids: [tenant.promptId] }))).toBe(
    'change assign_topic needs topic_id; pass null to take the prompts out of every topic.',
  );
  expect(
    await failure(prepare({ change: 'activate', prompt_ids: [tenant.promptId], topic_id: null })),
  ).toBe('topic_id goes only with change assign_topic.');

  const activate = await prepare({ change: 'activate', prompt_ids: [tenant.promptId] });
  expect(activate).toMatchObject({ prompt_slots: { used: 1 } });
  await confirm(activate);
  expect(await promptTexts(tenant.setId)).toEqual(['Which running shoes suit road use? [active]']);
  expect(await promptTexts(elsewhere.setId)).toEqual([
    'Which running shoes suit road use? [active]',
  ]);
  expect(
    await db
      .selectFrom('mcp_confirmations')
      .select('kind')
      .where('grant_id', '=', principal.grantId)
      .where('consumed_at', 'is not', null)
      .execute(),
  ).toEqual([{ kind: 'update_prompts' }, { kind: 'update_prompts' }, { kind: 'update_prompts' }]);
});

it('accepts and rejects competitor suggestions of its own project only', async () => {
  const tenant = await auditTenant(db, fixtures);
  const principal = await connection(tenant);
  const auditId = await fixtures.audit(tenant);
  const suggestion = async (projectId: string, audit: string, name: string) => {
    const id = randomUUID();
    await db
      .insertInto('observed_entity_candidates')
      .values({
        id,
        workspace_id: tenant.workspaceId,
        project_id: projectId,
        audit_id: audit,
        name,
        kind: 'cited_domain',
        domain: `${name.toLowerCase().replaceAll(' ', '')}.example`,
        citation_count: 2,
        engine_total: 2,
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
    return id;
  };
  const review = (suggestionId: string, decision: string) =>
    call(principal, 'review_competitor_suggestion', {
      project_id: tenant.projectId,
      suggestion_id: suggestionId,
      decision,
    });
  const fleet = await suggestion(tenant.projectId, auditId, 'Fleet Feet');
  const runner = await suggestion(tenant.projectId, auditId, 'Runner Hub');
  const sibling = await fixtures.project(tenant.workspaceId);
  const theirs = await suggestion(
    sibling,
    await fixtures.audit({ ...tenant, projectId: sibling }),
    'Road Runner',
  );

  expect(await review(fleet, 'accept')).toMatchObject({
    change: 'review_competitor_suggestion',
    summary: 'Now tracking Fleet Feet.',
  });
  expect(await review(runner, 'reject')).toMatchObject({
    summary: 'Rejected the suggestion Runner Hub.',
  });
  expect(await failure(review(runner, 'accept'))).toBe(
    'This suggestion was rejected; add the competitor instead',
  );
  expect(await failure(review(theirs, 'accept'))).toMatch(/not found/i);
  const statuses = await db
    .selectFrom('observed_entity_candidates')
    .select(['name', 'status'])
    .where('id', 'in', [fleet, runner, theirs])
    .orderBy('name')
    .execute();
  expect(statuses).toEqual([
    { name: 'Fleet Feet', status: 'accepted' },
    { name: 'Road Runner', status: 'pending' },
    { name: 'Runner Hub', status: 'rejected' },
  ]);
  expect(
    (
      await db
        .selectFrom('competitors')
        .select('name')
        .where('workspace_id', '=', tenant.workspaceId)
        .execute()
    ).map((row) => row.name),
  ).toEqual(['Fleet Feet']);
});

it('refuses a confirmation after expiry, revocation, demotion or from another connection', async () => {
  const tenant = await auditTenant(db, fixtures);
  const principal = await connection(tenant);
  const prepare = async () =>
    String(
      (
        await call(principal, 'prepare_add_prompts', {
          project_id: tenant.projectId,
          prompts: [{ text: 'Which running shoes last longest?' }],
        })
      ).confirmation_token,
    );

  const expired = await prepare();
  await db
    .updateTable('mcp_confirmations')
    .set({ expires_at: new Date(Date.now() - 1000) })
    .where('grant_id', '=', principal.grantId)
    .execute();
  expect(await failure(call(principal, 'confirm_change', { confirmation_token: expired }))).toBe(
    'This confirmation expired. Prepare the change again and confirm it within ten minutes.',
  );

  const other = await connection(tenant);
  expect(
    await failure(call(other, 'confirm_change', { confirmation_token: await prepare() })),
  ).toBe('This confirmation token is not valid for this connection. Prepare the change again.');

  const demoted = await prepare();
  await setRole(tenant, 'viewer');
  expect(await failure(call(principal, 'confirm_change', { confirmation_token: demoted }))).toBe(
    'Workspace member access is required',
  );
  await setRole(tenant, 'owner');

  const narrowed = await prepare();
  await db
    .updateTable('mcp_oauth_grants')
    .set({ scopes: JSON.stringify(['citeladder:read']) })
    .where('id', '=', principal.grantId)
    .execute();
  expect(await failure(call(principal, 'confirm_change', { confirmation_token: narrowed }))).toBe(
    'This connection can only read. Reconnect CiteLadder and tick Allow changes to make changes.',
  );
  await db
    .updateTable('mcp_oauth_grants')
    .set({ scopes: JSON.stringify(['citeladder:read', 'citeladder:write']) })
    .where('id', '=', principal.grantId)
    .execute();

  const revoked = await prepare();
  await db
    .updateTable('mcp_oauth_grants')
    .set({ revoked_at: new Date() })
    .where('id', '=', principal.grantId)
    .execute();
  expect(await failure(call(principal, 'confirm_change', { confirmation_token: revoked }))).toBe(
    'Project was not found in this account',
  );
  expect(await promptTexts(tenant.setId)).toEqual(['Which running shoes suit road use? [active]']);
});

it('refuses changes to a read-only grant, a viewer and a project in another workspace', async () => {
  const tenant = await auditTenant(db, fixtures);
  const elsewhere = await auditTenant(db, fixtures);
  const args = { project_id: tenant.projectId, name: 'Trail running' };
  expect(
    await failure(call(await connection(tenant, ['citeladder:read']), 'create_topic', args)),
  ).toBe('Unknown tool: create_topic');
  const principal = await connection(tenant);
  expect(
    await failure(call(principal, 'create_topic', { ...args, project_id: elsewhere.projectId })),
  ).toBe('Project was not found in this account');
  await setRole(tenant, 'viewer');
  expect(await failure(call(principal, 'create_topic', args))).toBe(
    'Workspace member access is required',
  );
  expect(
    await db
      .selectFrom('topics')
      .select('name')
      .where('project_id', '=', tenant.projectId)
      .execute(),
  ).toEqual([]);
});

it('runs a direct change at once and keeps named records inside the project', async () => {
  const tenant = await auditTenant(db, fixtures);
  const principal = await connection(tenant);
  const created = await call(principal, 'create_topic', {
    project_id: tenant.projectId,
    name: 'Trail running',
  });
  expect(created).toMatchObject({
    state: 'changed',
    change: 'create_topic',
    summary: 'Created the topic "Trail running".',
  });
  const sibling = await fixtures.project(tenant.workspaceId);
  expect(
    await failure(
      call(principal, 'rename_topic', {
        project_id: sibling,
        topic_id: (created.topic as { id: string }).id,
        name: 'Road running',
      }),
    ),
  ).toBe('Topic not found');
});

it('stops tracking a competitor and deletes a topic by name, keeping its prompts', async () => {
  const tenant = await auditTenant(db, fixtures);
  const principal = await connection(tenant);
  const sibling = await fixtures.project(tenant.workspaceId);
  await call(principal, 'add_competitor', { project_id: tenant.projectId, name: 'Fleet Feet' });
  await call(principal, 'add_competitor', { project_id: sibling, name: 'Fleet Feet' });
  expect(
    await call(principal, 'remove_competitor', {
      project_id: tenant.projectId,
      name: 'fleet feet',
    }),
  ).toMatchObject({
    state: 'changed',
    change: 'remove_competitor',
    summary: 'Stopped tracking Fleet Feet.',
  });
  const competitorNames = (projectId: string) =>
    db.selectFrom('competitors').select('name').where('project_id', '=', projectId).execute();
  expect(await competitorNames(tenant.projectId)).toEqual([]);
  expect(await competitorNames(sibling)).toEqual([{ name: 'Fleet Feet' }]);
  expect(
    await failure(
      call(principal, 'remove_competitor', { project_id: tenant.projectId, name: 'Fleet Feet' }),
    ),
  ).toBe('No competitor named "Fleet Feet" was found in this project');

  const topicId = await topic(db, tenant.projectId, 'Road running');
  await db
    .updateTable('prompts')
    .set({ topic_id: topicId })
    .where('id', '=', tenant.promptId)
    .execute();
  expect(
    await call(principal, 'delete_topic', { project_id: tenant.projectId, name: 'ROAD RUNNING' }),
  ).toMatchObject({
    change: 'delete_topic',
    summary: 'Deleted the topic "Road running"; its prompts are kept without a topic.',
  });
  expect(
    await db
      .selectFrom('prompts')
      .select(['text', 'topic_id', 'status'])
      .where('prompt_set_id', '=', tenant.setId)
      .execute(),
  ).toEqual([{ text: 'Which running shoes suit road use?', topic_id: null, status: 'active' }]);
});

it('saves a reviewed topic plan as one change and refuses a topic from another project', async () => {
  const tenant = await auditTenant(db, fixtures);
  const principal = await connection(tenant);
  const nets = await topic(db, tenant.projectId, 'Golf net');
  const mats = await topic(db, tenant.projectId, 'Hitting mats');
  const sibling = await fixtures.project(tenant.workspaceId);
  const foreign = await topic(db, sibling, 'Putting greens');
  expect(
    await failure(
      call(principal, 'confirm_topics', { project_id: tenant.projectId, delete: [foreign] }),
    ),
  ).toBe('Topic not found');
  const saved = await call(principal, 'confirm_topics', {
    project_id: tenant.projectId,
    create: [{ name: 'Golf simulator enclosures' }],
    rename: [{ id: nets, name: 'Golf nets' }],
    delete: [mats],
  });
  expect(saved).toMatchObject({ state: 'changed', change: 'confirm_topics' });
  expect((saved.topics as { name: string }[]).map((item) => item.name).toSorted()).toEqual([
    'Golf nets',
    'Golf simulator enclosures',
  ]);
  expect(
    (
      await db
        .selectFrom('topics')
        .select('name')
        .where('project_id', 'in', [tenant.projectId, sibling])
        .orderBy('name')
        .execute()
    ).map((row) => row.name),
  ).toEqual(['Golf nets', 'Golf simulator enclosures', 'Putting greens']);
  expect(
    await db
      .selectFrom('security_events')
      .select('event')
      .where('actor_id', '=', tenant.userId)
      .where('event', 'like', 'mcp.write.%')
      .execute(),
  ).toEqual([{ event: 'mcp.write.confirm_topics' }]);
});

it('refuses topic previews and generation runs the owner refuses, before any model call', async () => {
  const tenant = await auditTenant(db, fixtures);
  const principal = await connection(tenant);
  expect(await failure(call(principal, 'preview_topics', { project_id: tenant.projectId }))).toBe(
    'Add at least one offering before proposing topics',
  );
  await topic(db, tenant.projectId, 'Road running');
  expect(
    await failure(
      call(principal, 'generate_prompts', {
        project_id: tenant.projectId,
        run_key: 'run-1',
        distribution: { comparison_share: 0.2 },
      }),
    ),
  ).toBe('Add a competitor before generating comparison prompts');
  expect(
    await failure(
      call(principal, 'generate_prompts', {
        project_id: tenant.projectId,
        run_key: 'run-2',
        seed_query_ids: [randomUUID()],
      }),
    ),
  ).toBe('Seed queries need their search data source');
  expect(
    await db
      .selectFrom('prompt_generation_runs')
      .select('id')
      .where('project_id', '=', tenant.projectId)
      .execute(),
  ).toEqual([]);
  await setRole(tenant, 'viewer');
  expect(
    await failure(
      call(principal, 'generate_prompts', { project_id: tenant.projectId, run_key: 'run-3' }),
    ),
  ).toBe('Workspace member access is required');
});

it('replays a retried generation run by its run key instead of generating again', async () => {
  const tenant = await auditTenant(db, fixtures);
  const principal = await connection(tenant);
  await db
    .insertInto('prompt_generation_runs')
    .values({
      id: randomUUID(),
      workspace_id: tenant.workspaceId,
      project_id: tenant.projectId,
      prompt_set_id: tenant.setId,
      generator_version: '1',
      request: JSON.stringify({ count: 10, idempotency_key: 'agreed-run' }),
      provenance: JSON.stringify({ candidates_generated: 0 }),
      created_at: new Date(),
    })
    .execute();
  const retried = await call(principal, 'generate_prompts', {
    project_id: tenant.projectId,
    run_key: 'agreed-run',
    count: 10,
  });
  expect(retried).toMatchObject({
    state: 'changed',
    suggestions: [],
    summary:
      'Staged 0 of 10 requested suggestion(s) for review. Nothing is tracked until the user accepts them in CiteLadder.',
    review_url: `https://app.example.test/prompts/build?step=review&project=${tenant.projectId}`,
  });
  expect(
    await failure(
      call(principal, 'generate_prompts', {
        project_id: tenant.projectId,
        run_key: 'agreed-run',
        count: 5,
      }),
    ),
  ).toBe('Idempotency-Key was used for another generation request');
  expect(
    await db
      .selectFrom('prompt_generation_runs')
      .select('id')
      .where('workspace_id', '=', tenant.workspaceId)
      .execute(),
  ).toHaveLength(1);
});

it('launches an audit only on confirmation, within the frozen estimate', async () => {
  const tenant = await auditTenant(db, fixtures);
  const principal = await connection(tenant);
  const prepared = await call(principal, 'prepare_launch_audit', {
    project_id: tenant.projectId,
    engines: ['chatgpt'],
  });
  expect(prepared).toMatchObject({
    state: 'needs_confirmation',
    maximum_attempt_count: expect.any(Number),
  });
  expect(prepared.max_attempts).toBe(prepared.maximum_attempt_count);
  const audits = () =>
    db.selectFrom('audits').select('status').where('project_id', '=', tenant.projectId).execute();
  expect(await audits()).toEqual([]);
  expect(
    await call(principal, 'confirm_change', {
      confirmation_token: String(prepared.confirmation_token),
    }),
  ).toMatchObject({
    state: 'changed',
    change: 'launch_audit',
    audits: [{ status: 'queued', market: { id: null } }],
  });
  expect(await audits()).toEqual([{ status: 'queued' }]);
});

it('creates a prepared schedule in its project only on confirmation, recording the change', async () => {
  const tenant = await auditTenant(db, fixtures);
  const principal = await connection(tenant);
  const prepared = await call(principal, 'prepare_schedule', {
    project_id: tenant.projectId,
    cadence: 'weekly',
    engines: ['chatgpt'],
    timezone: 'Europe/London',
    next_run_at: '2030-01-07T09:00:00+00:00',
  });
  const schedules = () =>
    db
      .selectFrom('audit_schedules')
      .select(['project_id', 'cadence', 'timezone'])
      .where('workspace_id', '=', tenant.workspaceId)
      .execute();
  const receipts = () =>
    db
      .selectFrom('security_events')
      .select(['event', 'target_id'])
      .where('workspace_id', '=', tenant.workspaceId)
      .where('event', 'like', 'mcp.write.%')
      .execute();
  expect(await schedules()).toEqual([]);
  expect(
    await call(principal, 'confirm_change', {
      confirmation_token: String(prepared.confirmation_token),
    }),
  ).toMatchObject({ state: 'changed', change: 'schedule' });
  expect(await schedules()).toEqual([
    { project_id: tenant.projectId, cadence: 'weekly', timezone: 'Europe/London' },
  ]);
  expect(await receipts()).toEqual([{ event: 'mcp.write.schedule', target_id: tenant.projectId }]);
});

it('spends a narrower per-connection budget on changes', async () => {
  const tenant = await auditTenant(db, fixtures);
  const principal = await connection(tenant);
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-01T10:00:15Z') });
  onTestFinished(() => {
    vi.useRealTimers();
  });
  for (let index = 0; index < mcpPolicy.write_call_grant_limit; index++)
    await admitWriteCall(db, principal.grantId);
  const refused = await admitWriteCall(db, principal.grantId).catch((error: unknown) => error);
  expect(refused).toBeInstanceOf(ApiError);
  expect((refused as ApiError).status).toBe(429);
});
