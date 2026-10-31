import { randomUUID } from 'node:crypto';
import { policy } from '../src/config.ts';
import { afterAll, beforeEach, expect, it } from 'vitest';
import { authorizedWorkspaceIds } from '../src/mcp/data.ts';
import { dispatchTool } from '../src/mcp/tools.ts';
import { fetchRecord } from '../src/mcp/retrieval.ts';
import { agentTools } from '../src/agent/tool-adapters.ts';
import type { McpPrincipal } from '../src/mcp/types.ts';
import { prompt, promptSet, topic } from './prompt-fixtures.ts';
import { testDatabase } from './support.ts';
import { VisibilityFixtures, type Tenant } from './visibility-fixtures.ts';
import { actionFixture, type ActionSeed } from './action-support.ts';
import { attachOrCreateAction } from '../src/opportunities/actions.ts';
import { getVisibility } from '../src/visibility/dashboard.ts';
import { SiteFixtures, type SiteSeed } from './site-health-fixtures.ts';
import { seedImport } from './referral-fixtures.ts';

const db = testDatabase();
const fixtures = new VisibilityFixtures(db);
const siteFixtures = new SiteFixtures(db);
const clients: string[] = [];
let tenant: Tenant;
let principal: McpPrincipal;
const origin = 'https://app.example.test';
beforeEach(async () => {
  tenant = await fixtures.tenant();
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
  principal = {
    userId: tenant.userId,
    grantId: randomUUID(),
    workspaceIds: [tenant.workspaceId],
    tokenHash: randomUUID(),
    canWrite: false,
  };
  await db
    .insertInto('mcp_oauth_grants')
    .values({
      id: principal.grantId,
      client_id: clientId,
      user_id: tenant.userId,
      workspace_ids: JSON.stringify(principal.workspaceIds),
      scopes: JSON.stringify(['citeladder:read']),
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
});
afterAll(async () => {
  await siteFixtures.cleanup();
  await fixtures.cleanup();
  await db.deleteFrom('mcp_oauth_clients').where('client_id', 'in', clients).execute();
  await db.destroy();
});
const read = (name: string, args: Record<string, unknown> = {}) =>
  dispatchTool(db, principal, name, { project_id: tenant.projectId, ...args }, origin);
/** A complete fetched document carries its record once, as the text. */
const record = (document: Record<string, unknown>) => JSON.parse(String(document.text));

it('retains the selected Site Health snapshot and partial/unknown coverage when newer snapshots arrive', async () => {
  const seed = await siteFixtures.crawl();
  const member = {
    kind: 'member' as const,
    userId: seed.userId,
    workspaceId: seed.workspaceId,
    projectId: seed.projectId,
  };
  const first = await siteFixtures.snapshot(seed);
  const render = (snapshot_id?: string) =>
    dispatchTool(
      db,
      member,
      'render_site_health',
      { project_id: seed.projectId, snapshot_id },
      origin,
    );
  expect(await render()).toMatchObject({
    selection: { snapshot_id: first },
    evidence: {
      crawl_id: seed.crawlId,
      measurement_states: { coverage: 'partial', aeo: 'unknown' },
      scores: { aeo_readiness: null },
    },
  });
  await siteFixtures.snapshot({ ...seed, crawlId: await siteFixtures.sibling(seed) }, 'complete');
  expect(await render(first)).toMatchObject({
    selection: { snapshot_id: first },
    evidence: {
      snapshot_id: first,
      crawl_id: seed.crawlId,
      measurement_states: { coverage: 'partial' },
    },
  });
  await expect(render(randomUUID())).rejects.toThrow('unavailable');
});

it('pins the Visibility review to canonical measures and source-to-answer evidence even after a newer audit exists', async () => {
  expect((await read('render_visibility')).evidence).toMatchObject({ state: 'unavailable' });
  const auditId = await fixtures.audit(tenant, { completedAt: new Date('2026-10-01T00:00:00Z') });
  const snapshotId = await fixtures.metricSnapshot(tenant, auditId, {
    metrics: {
      total_completed: 2,
      brand_mention_count: 1,
      owned_citation_response_count: 0,
      brand_mention_rate: 0.5,
      owned_citation_rate: 0,
      per_prompt: [],
      coverage: { requested: 2, failed: 0, not_run: 0 },
    },
  });
  const execution = await fixtures.execution(tenant, {
    auditId,
    answerText: 'Acme retained answer',
    analysis: { citations: [{ url: 'https://publisher.example/a', domain: 'publisher.example' }] },
  });
  const rendered = await read('render_visibility', { view: 'overview' });
  const handoff = new URL((rendered.links as { application: string }).application);
  expect([handoff.pathname, handoff.searchParams.get('project')]).toEqual([
    '/visibility',
    tenant.projectId,
  ]);
  const canonical = await getVisibility(
    db,
    { workspaceId: tenant.workspaceId, projectId: tenant.projectId },
    {
      auditId,
      logicalEngine: null,
      baselineId: null,
      selectionMode: 'run',
      fromAt: null,
      toAt: null,
      configurationKey: null,
      cohort: 'core',
    },
  );
  expect(rendered).toMatchObject({
    selection: { audit_id: auditId },
    evidence: {
      visibility_rate: canonical.visibility_rate,
      owned_citation_rate: 0,
      counts: canonical.counts,
    },
  });
  await fixtures.audit(tenant, { completedAt: new Date('2026-10-02T00:00:00Z') });
  const sources = await read('render_visibility', { audit_id: auditId, view: 'sources' });
  expect(sources).toMatchObject({
    selection: { audit_id: auditId },
    evidence: {
      coverage: { responses: 1 },
      items: [expect.objectContaining({ key: 'publisher.example' })],
    },
  });
  const answers = await read('read_visibility_results', {
    audit_id: auditId,
    domain: 'publisher.example',
  });
  expect(answers.items).toEqual([expect.objectContaining({ task_id: execution.taskId })]);
  expect(
    (await fetchRecord(db, principal, `citeladder://visibility_result/${execution.taskId}`, origin))
      .text,
  ).toContain('Acme retained answer');
  expect(
    (await read('read_visibility_results', { audit_id: auditId, url: 'https://other.example/' }))
      .items,
  ).toEqual([]);
  const trends = await read('read_visibility_trends', {
    from_at: '2026-10-01T00:00:00Z',
    to_at: '2026-10-01T23:59:59Z',
  });
  expect(trends.points).toEqual([
    expect.objectContaining({
      audit_id: auditId,
      source_snapshot_ids: [snapshotId],
      brand_mention_rate: 0.5,
      owned_citation_rate: 0,
    }),
  ]);
});

it('refuses foreign render objects, unsupported filters, forged totals and revoked grants', async () => {
  const foreign = await fixtures.tenant();
  const foreignAudit = await fixtures.audit(foreign);
  await expect(read('render_visibility', { project_id: foreign.projectId })).rejects.toThrow(
    'not found',
  );
  await expect(read('render_visibility', { audit_id: foreignAudit })).rejects.toThrow('not found');
  await expect(read('read_visibility_overview', { baseline_id: foreignAudit })).rejects.toThrow(
    'not found',
  );
  await expect(read('render_site_health', { snapshot_id: randomUUID() })).rejects.toThrow(
    'unavailable',
  );
  for (const args of [
    { view: 'sources', from_at: '2026-10-01T00:00:00Z' },
    { view: 'trends', audit_id: foreignAudit },
    { visibility_rate: 100 },
    { view: 'overview', level: 'url' },
  ])
    await expect(read('render_visibility', args)).rejects.toThrow();
  await expect(
    read('read_visibility_trends', {
      from_at: '2026-10-02T00:00:00Z',
      to_at: '2026-10-01T00:00:00Z',
    }),
  ).rejects.toThrow('after');
  await expect(
    read('read_visibility_trends', {
      from_at: '2020-01-01T00:00:00Z',
      to_at: '2026-10-01T00:00:00Z',
    }),
  ).rejects.toThrow('limited');
  for (const name of ['read_visibility_trends', 'render_visibility'])
    await expect(
      read(name, {
        ...(name === 'render_visibility' ? { view: 'trends' } : {}),
        from_at: '0000-01-01T00:00:00Z',
        to_at: '0000-01-02T00:00:00Z',
      }),
    ).rejects.toThrow('valid datetimes');
  await db
    .updateTable('mcp_oauth_grants')
    .set({ revoked_at: new Date() })
    .where('id', '=', principal.grantId)
    .execute();
  await expect(read('render_visibility')).rejects.toThrow('not found');
});

it('keeps crawlability unavailable without a crawl, including business context', async () => {
  expect(await read('read_ai_crawlability')).toMatchObject({
    state: 'unavailable',
    reason: 'no_site_crawl',
  });
  const context = await read('get_project_business_context', { sections: ['crawlability'] });
  expect(context.crawlability).toMatchObject({ state: 'unavailable', reason: 'no_site_crawl' });
});

it('pages prompts stably while context includes only active prompts and foreign IDs cannot fetch', async () => {
  const set = await promptSet(db, tenant.projectId);
  const nets = await topic(db, tenant.projectId, 'Golf nets', 'Home practice');
  // No prompt yet, yet a proposal may still file new questions under it.
  const kicking = await topic(db, tenant.projectId, 'Kicking nets');
  // Distinct instants: same-millisecond fixtures would page in random-UUID order.
  const at = (offset: number) => new Date(Date.UTC(2026, 0, 1) + offset);
  const first = await prompt(db, set, 'Acme first', { createdAt: at(0), topicId: nets });
  const second = await prompt(db, set, 'Acme second', { createdAt: at(1) });
  const retired = await prompt(db, set, 'Acme retired', { status: 'retired', createdAt: at(2) });
  // Accepted from a grounded candidate: the portfolio says so without the query identity.
  await db
    .updateTable('prompts')
    .set({
      generation_evidence: JSON.stringify({
        evidence_refs: [
          { kind: 'business_map_cell', offering: 'Shoes' },
          { kind: 'observed_query', source: 'gsc', id: randomUUID() },
        ],
      }),
    })
    .where('id', '=', second)
    .execute();
  const page = await read('read_prompt_portfolio', { limit: 1 });
  expect(page.items).toEqual([
    expect.objectContaining({ id: first, grounded: false, topic_id: nets, topic: 'Golf nets' }),
  ]);
  // One prompt per page still lists every topic.
  expect([page.topics, page.topics_truncated]).toEqual([
    [
      { id: nets, name: 'Golf nets', description: 'Home practice' },
      { id: kicking, name: 'Kicking nets', description: '' },
    ],
    false,
  ]);
  const next = await read('read_prompt_portfolio', {
    limit: 1,
    cursor: (page.pagination as { next_cursor: string }).next_cursor,
  });
  expect(next.items).toEqual([expect.objectContaining({ id: second, grounded: true })]);
  expect(JSON.stringify(next.items)).not.toContain('observed_query');
  const context = await read('get_project_business_context', { sections: ['prompts'] });
  expect((context.prompts as { items: { id: string }[] }).items.map((r) => r.id)).toEqual([
    first,
    second,
  ]);
  expect(
    record(await fetchRecord(db, principal, `citeladder://prompt/${retired}`, origin)),
  ).toMatchObject({ status: 'retired' });
  const foreign = await fixtures.tenant();
  const secret = await prompt(db, await promptSet(db, foreign.projectId), 'Acme private');
  await expect(fetchRecord(db, principal, `citeladder://prompt/${secret}`, origin)).rejects.toThrow(
    'not found',
  );
  const searched = await dispatchTool(db, principal, 'search', { query: 'private' }, origin);
  expect(searched.results).toEqual([]);
});

it('excludes system tenants and reevaluates an already loaded credential after account or grant changes', async () => {
  const system = await fixtures.systemWorkspace();
  await db
    .updateTable('mcp_oauth_grants')
    .set({ workspace_ids: JSON.stringify([tenant.workspaceId, system]) })
    .where('id', '=', principal.grantId)
    .execute();
  expect(await authorizedWorkspaceIds(db, principal)).toEqual([tenant.workspaceId]);
  await db.updateTable('users').set({ is_active: false }).where('id', '=', tenant.userId).execute();
  expect(await authorizedWorkspaceIds(db, principal)).toEqual([]);
  await db.updateTable('users').set({ is_active: true }).where('id', '=', tenant.userId).execute();
  await db
    .updateTable('mcp_oauth_grants')
    .set({ revoked_at: new Date() })
    .where('id', '=', principal.grantId)
    .execute();
  await expect(read('read_prompt_portfolio')).rejects.toThrow('not found');
});

it('keeps a missing exact query window and unmeasured snapshots unavailable while no connections is observed', async () => {
  expect(
    await read('read_query_evidence', { window_start: '2026-09-01', window_end: '2026-09-02' }),
  ).toMatchObject({
    state: 'unavailable',
    reason: 'exact_query_evidence_window_not_projected',
  });
  expect(await read('read_site_health')).toMatchObject({
    state: 'unavailable',
    reason: 'no_site_snapshot',
  });
  expect(
    await read('read_ai_referrals', { start_date: '2026-09-01', end_date: '2026-09-02' }),
  ).toMatchObject({ state: 'unavailable', reason: 'no_ai_referrals_snapshot' });
  expect(await read('read_integration_status')).toMatchObject({
    state: 'available',
    connection_count: 0,
    stage: 'not_connected',
  });
  const before = await db
    .selectFrom('analytics_tasks')
    .select('id')
    .where('workspace_id', '=', tenant.workspaceId)
    .execute();
  await read('get_project_business_context');
  expect(
    await db
      .selectFrom('analytics_tasks')
      .select('id')
      .where('workspace_id', '=', tenant.workspaceId)
      .execute(),
  ).toEqual(before);
});

it('fetches the exact page analysis after a newer analysis replaces it, with facts and evaluations', async () => {
  const seed = await actionFixture<ActionSeed>('content');
  try {
    const source = await db
      .selectFrom('site_page_analyses')
      .selectAll()
      .where('crawl_id', '=', seed.crawl_id)
      .orderBy('id')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('site_url_observations')
      .values({
        id: randomUUID(),
        workspace_id: seed.workspace_id,
        project_id: seed.project_id,
        crawl_id: seed.crawl_id,
        site_url_id: source.site_url_id,
        observed_url: 'https://acme.example/',
        final_url: 'https://acme.example/',
        source_kind: 'seed',
        depth: 0,
        status_code: 200,
        content_type: 'text/html',
        title: 'Acme',
        rewrite_reason: '',
        rewrite_version: 'test',
        value_kind: 'page',
        value_priority: 0,
        created_at: new Date(),
      })
      .execute();
    principal.userId = seed.user_id;
    await db
      .updateTable('mcp_oauth_grants')
      .set({ user_id: seed.user_id, workspace_ids: JSON.stringify([seed.workspace_id]) })
      .where('id', '=', principal.grantId)
      .execute();
    const args = { project_id: seed.project_id, crawl_id: seed.crawl_id, limit: 1 };
    const page = await dispatchTool(db, principal, 'read_site_pages', args, origin);
    expect(page.items as unknown[]).toHaveLength(1);
    await db
      .updateTable('site_page_analyses')
      .set({ is_current: false })
      .where('id', '=', source.id)
      .execute();
    const finalId = randomUUID();
    await db
      .insertInto('site_page_analyses')
      .values({ ...source, id: finalId, is_current: true, aeo_readiness_score: 99 })
      .execute();
    const fetched = await fetchRecord(db, principal, `citeladder://site_page/${source.id}`, origin);
    expect(record(fetched)).toMatchObject({
      id: source.id,
      aeo_readiness_score: source.aeo_readiness_score,
      artifact: { id: source.artifact_id, normalized_facts: expect.any(Object) },
    });
    const evaluation = await db
      .selectFrom('site_rule_evaluations')
      .select('id')
      .where('analysis_id', '=', source.id)
      .executeTakeFirstOrThrow();
    expect(
      (record(fetched) as { evaluations: { id: string }[] }).evaluations.map((r) => r.id),
    ).toContain(evaluation.id);
    const final = record(
      await fetchRecord(db, principal, `citeladder://site_page/${finalId}`, origin),
    );
    expect(final.evaluations).toEqual(record(fetched).evaluations);
    expect(final.issues).toEqual(record(fetched).issues);
    expect(final.issues).not.toEqual([]);
    const scope = {
      userId: seed.user_id,
      workspaceId: seed.workspace_id,
      projectId: seed.project_id,
    };
    const tool = agentTools(db);
    const readPart = async (id: string) => {
      const result = await tool.execute(db, scope, 'fetch', { id }, AbortSignal.timeout(5000));
      expect(result.status).toBe('completed');
      expect(result.omissions).toEqual([]);
      expect(result.text.length).toBeLessThanOrEqual(policy.agent.tool_result_max_chars);
      return JSON.parse(result.text);
    };
    const first = await readPart(`citeladder://site_page/${finalId}`);
    const parts = first.metadata.part_uris as string[];
    const whole = parts.length
      ? JSON.parse((await Promise.all(parts.map(readPart))).map((part) => part.text).join(''))
      : JSON.parse(first.text);
    expect(whole.issues).toEqual(final.issues);
    expect(whole.evaluations).toEqual(final.evaluations);
  } finally {
    await db.deleteFrom('mcp_oauth_grants').where('id', '=', principal.grantId).execute();
    await db.deleteFrom('workspaces').where('id', '=', seed.workspace_id).execute();
    await db.deleteFrom('users').where('id', '=', seed.user_id).execute();
  }
});

it('exposes published dataset aggregates without treating them as backlink edges or letting auxiliary data replace identity', async () => {
  const scope = { workspace_id: tenant.workspaceId, project_id: tenant.projectId };
  const connectionId = randomUUID(),
    runId = randomUUID(),
    datasetId = randomUUID(),
    rowId = randomUUID();
  await db
    .insertInto('provider_connections')
    .values({
      id: connectionId,
      workspace_id: tenant.workspaceId,
      label: 'DataForSEO',
      transport_provider: 'dataforseo',
      api_key_encrypted: 'fixture',
      base_url: '',
      credential_revision: randomUUID(),
      active: true,
      last_test_status: policy.search_intelligence.connection_test_ok,
      created_at: new Date(),
      updated_at: new Date(),
    })
    .execute();
  await db
    .insertInto('search_intelligence_runs')
    .values({
      ...scope,
      id: runId,
      actor_user_id: tenant.userId,
      connection_id: connectionId,
      connection_revision: randomUUID(),
      account_identity: 'test',
      credential_source: 'byok',
      estimated_credits: null,
      charged_credits: null,
      platform_call_id: null,
      status: 'completed',
      action: 'analysis',
      idempotency_key: runId,
      frozen_scope: '{}',
      call_plan: '[]',
      reused_datasets: '[]',
      pricing_version: policy.search_intelligence.price_version,
      estimated_cost_usd: '0',
      planned_calls: 1,
      completed_calls: 1,
      planned_rows: 1,
      received_rows: 1,
      uncertain_calls: 0,
      error_code: '',
      error_detail: '',
      expires_at: new Date(Date.now() + 600000),
      created_at: new Date(),
      updated_at: new Date(),
    })
    .execute();
  await db
    .insertInto('search_intelligence_datasets')
    .values({
      ...scope,
      id: datasetId,
      run_id: runId,
      dataset_kind: 'referring_domains',
      scope_hash: datasetId,
      target_domain: 'acme.example',
      target_hostname: 'acme.example',
      target_origin: 'https://acme.example',
      comparison_origin: '',
      language_code: 'en',
      status: 'published',
      coverage: 'complete',
      requested_rows: 1,
      raw_rows_received: 1,
      unique_rows_saved: 1,
      truncated: false,
      summary: '{}',
      provider_filters: '{}',
      parser_version: '1',
      published_at: new Date(),
      created_at: new Date(),
    })
    .execute();
  await db
    .insertInto('search_intelligence_rows')
    .values({
      ...scope,
      id: rowId,
      dataset_id: datasetId,
      provider_row_key: 'row',
      row_kind: 'referring_domains',
      keyword: '',
      domain: 'publisher.example',
      url: '',
      intent: '',
      backlinks: 0,
      auxiliary: JSON.stringify({ id: 'forged', project_id: 'forged', backlinks: 42 }),
      created_at: new Date(),
    })
    .execute();
  const page = await read('read_search_dataset', { dataset_id: datasetId, limit: 1 });
  expect(page).toMatchObject({
    dataset: { dataset_kind: 'referring_domains' },
    aggregate_not_individual_links: true,
  });
  const fetched = await fetchRecord(db, principal, `citeladder://search_row/${rowId}`, origin);
  expect(record(fetched)).toMatchObject({ id: rowId, project_id: tenant.projectId, backlinks: 0 });
  await db
    .updateTable('search_intelligence_datasets')
    .set({ status: 'collecting' })
    .where('id', '=', datasetId)
    .execute();
  await expect(
    fetchRecord(db, principal, `citeladder://search_row/${rowId}`, origin),
  ).rejects.toThrow('not found');
});

it('keeps answer identity through the visibility owner and refuses another project', async () => {
  const auditId = await fixtures.audit(tenant);
  const { taskId } = await fixtures.execution(tenant, {
    auditId,
    analysis: {
      brandMentioned: true,
      citations: [{ url: 'https://publisher.example/review', title: 'Review' }],
    },
    taskEvents: [{ query: 'acme review' }],
  });
  const page = await read('read_visibility_results', { audit_id: auditId });
  const items = page.items as {
    task_id: string;
    record_uri: string;
    citations: { url: string }[];
  }[];
  expect(items.map((item) => [item.task_id, item.citations[0]?.url])).toEqual([
    [taskId, 'https://publisher.example/review'],
  ]);
  const answer = await fetchRecord(db, principal, items[0]!.record_uri, origin);
  expect(answer.metadata).toMatchObject({
    project_id: tenant.projectId,
    record_type: 'visibility_result',
  });
  expect(new URL(String(answer.url)).pathname).toBe(`/runs/${auditId}`);
  const foreign = await fixtures.tenant();
  await expect(
    dispatchTool(
      db,
      principal,
      'read_visibility_results',
      { project_id: foreign.projectId, audit_id: auditId },
      origin,
    ),
  ).rejects.toThrow('not found');
  await expect(
    read('read_visibility_results', { audit_id: await fixtures.audit(foreign) }),
  ).rejects.toThrow('not found');
});

it('lists only active Actions as the current work and reads a dismissed one only by name', async () => {
  const scope = { workspaceId: tenant.workspaceId, projectId: tenant.projectId };
  const attach = (topic: string) =>
    db
      .transaction()
      .execute((trx) => attachOrCreateAction(trx, scope, 'planned_page', topic, tenant.userId));
  const kept = await attach('Buyer guide');
  const dismissed = await attach('Old guide');
  await db
    .updateTable('actions')
    .set({ status: 'dismissed' })
    .where('id', '=', dismissed.id)
    .execute();
  const current = await read('read_actions');
  expect((current.items as { id: string }[]).map((item) => item.id)).toEqual([kept.id]);
  expect(current.status_counts).toMatchObject({ open: 1, dismissed: 1 });
  expect((await read('read_actions', { status: 'dismissed' })).items as { id: string }[]).toEqual([
    expect.objectContaining({ id: dismissed.id }),
  ]);
  const one = await read('read_actions', { action_id: dismissed.id });
  expect(one.action).toMatchObject({ id: dismissed.id, status: 'dismissed' });
  const searched = await dispatchTool(db, principal, 'search', { query: 'guide' }, origin);
  expect((searched.results as { id: string }[]).map((r) => r.id)).toEqual([
    `citeladder://action/${kept.id}`,
  ]);
});

it('serves answer perception with the same numbers as the Perception read, and its quotes', async () => {
  expect(await read('read_perception')).toMatchObject({
    state: 'unavailable',
    reason: 'no_completed_run',
  });
  const auditId = await fixtures.audit(tenant, {
    configuration: {
      brand_name: 'Acme',
      perception: { extractor_version: 'mcp-test', template_version: 't', metrics_version: 'm' },
    },
  });
  const { taskId, analysisId } = await fixtures.execution(tenant, { auditId, analysis: {} });
  await db
    .updateTable('response_analyses')
    .set({
      entity_assessments: JSON.stringify([
        { entity_id: 'brand:acme', entity_name: 'Acme', entity_kind: 'brand', state: 'mentioned' },
      ]),
    })
    .where('id', '=', analysisId!)
    .execute();
  const { artifact_id } = await db
    .selectFrom('response_analyses')
    .select('artifact_id')
    .where('id', '=', analysisId!)
    .executeTakeFirstOrThrow();
  const perceptionId = randomUUID();
  await db
    .insertInto('answer_perceptions')
    .values({
      id: perceptionId,
      workspace_id: tenant.workspaceId,
      project_id: tenant.projectId,
      audit_id: auditId,
      task_id: taskId,
      analysis_id: analysisId!,
      artifact_id,
      extractor_version: 'mcp-test',
      template_version: 't',
      outcome: 'classified',
      created_at: new Date(),
    })
    .execute();
  await db
    .insertInto('entity_sentiments')
    .values({
      id: randomUUID(),
      workspace_id: tenant.workspaceId,
      perception_id: perceptionId,
      entity_id: 'brand:acme',
      entity_name: 'Acme',
      entity_kind: 'brand',
      label: 'negative',
      confidence: 0.9,
      low_confidence: false,
      passage_spans: JSON.stringify([]),
      aspects: JSON.stringify([
        { theme: 'pricing', polarity: 'negative', quote: 'Acme is pricey', start: 0, end: 14 },
      ]),
    })
    .execute();
  const summary = await read('read_perception', { audit_id: auditId });
  expect(summary).toMatchObject({
    state: 'available',
    perception_state: 'value',
    coverage: { mentions: 1, classified: 1 },
    brand: { score: { negative: 1, net_sentiment: -100 } },
    artifact_refs: [expect.objectContaining({ id: expect.stringContaining(auditId) })],
  });
  const quotes = await read('read_perception', { view: 'quotes', polarity: 'negative' });
  expect(quotes.items).toEqual([
    expect.objectContaining({ text: 'Acme is pricey', run_id: auditId, execution_id: taskId }),
  ]);
});

it('serves ads in ChatGPT answers with the same numbers as the Ads read', async () => {
  const auditId = await fixtures.audit(tenant);
  const { taskId, analysisId } = await fixtures.execution(tenant, {
    auditId,
    engine: 'chatgpt_search',
    analysis: {},
  });
  const { artifact_id } = await db
    .updateTable('response_analyses')
    .set({ ads_parser_version: 'chatgpt-ads-1' })
    .where('id', '=', analysisId!)
    .returning('artifact_id')
    .executeTakeFirstOrThrow();
  await db
    .insertInto('answer_ad_observations')
    .values({
      id: randomUUID(),
      workspace_id: tenant.workspaceId,
      project_id: tenant.projectId,
      audit_id: auditId,
      task_id: taskId,
      artifact_id,
      parser_version: 'chatgpt-ads-1',
      rank_absolute: 1,
      advertiser_name: 'Rival',
      advertiser_domain: 'rival.example',
      landing_url_raw: 'https://rival.example/a?gclid=1',
      landing_url_canonical: 'https://rival.example/a',
      title: 'Rival A',
      snippet: '',
      ownership: 'competitor',
      created_at: new Date(),
    })
    .execute();
  await fixtures.execution(tenant, { auditId, engine: 'claude', analysis: {} });
  expect(await read('read_ai_ads', { audit_id: auditId })).toMatchObject({
    state: 'available',
    ads_state: 'value',
    presence: { answers: 1, answers_with_ads: 1, rate: 1 },
    engines: [
      { engine: 'chatgpt_search', applicability: 'applicable' },
      { engine: 'claude', applicability: 'not_applicable', presence: null },
    ],
    advertisers: [{ name: 'Rival', domain: 'rival.example', appearances: 1, share: 1 }],
    creatives: { items: [{ title: 'Rival A', landing_url: 'https://rival.example/a' }] },
    artifact_refs: [expect.objectContaining({ id: expect.stringContaining(auditId) })],
  });
});

/** A finalized, measured page observed in the crawl. */
async function sitePage(seed: SiteSeed, path: string) {
  const page = await siteFixtures.page(seed, path, {}, { observed: true });
  await db
    .updateTable('site_page_analyses')
    .set({
      finalized_at: new Date(),
      web_fundamentals_state: 'measured',
      web_fundamentals_score: 80,
      aeo_measurement_state: 'limited_evidence',
    })
    .where('id', '=', page.analysisId)
    .execute();
  return page;
}
/** A failing evaluation of `ruleId` on the page's current analysis, and its issue. */
async function siteIssue(
  seed: SiteSeed,
  page: Awaited<ReturnType<typeof sitePage>>,
  ruleId: string,
) {
  const rule = policy.site_health.rule_catalog.find((item) => item.rule_id === ruleId)!;
  const { source_evaluation_ids } = await db
    .selectFrom('site_page_analyses')
    .select('source_evaluation_ids')
    .where('id', '=', page.analysisId)
    .executeTakeFirstOrThrow();
  const evaluationId = await siteFixtures.evaluation(seed, page, ruleId, 'missing');
  await db
    .updateTable('site_page_analyses')
    .set({ source_evaluation_ids: [...(source_evaluation_ids ?? []), evaluationId] })
    .where('id', '=', page.analysisId)
    .execute();
  await db
    .insertInto('site_issues')
    .values({
      id: randomUUID(),
      workspace_id: seed.workspaceId,
      project_id: seed.projectId,
      crawl_id: seed.crawlId,
      site_url_id: page.id,
      analysis_id: page.analysisId,
      evaluation_id: evaluationId,
      source_artifact_id: page.artifactId,
      rule_id: ruleId,
      rule_version: rule.rule_version,
      dimension: rule.dimension,
      category: rule.category,
      severity: rule.severity,
      finding_class: rule.finding_class,
      description: rule.description,
      remediation: rule.remediation,
      analyzer_version: policy.site_health.versions.analyzer,
      created_at: new Date(),
    })
    .execute();
}
const siteMember = (seed: SiteSeed) => ({
  kind: 'member' as const,
  userId: seed.userId,
  workspaceId: seed.workspaceId,
  projectId: seed.projectId,
});

it("lists exactly the pages a Site Health rule affects, with each page's failing rules in compact rows", async () => {
  const seed = await siteFixtures.crawl();
  const titled = await sitePage(seed, '/pricing');
  const described = await sitePage(seed, '/docs');
  await sitePage(seed, '/clean');
  await siteIssue(seed, titled, 'technical.title_present');
  await siteIssue(seed, titled, 'technical.meta_description_present');
  await siteIssue(seed, described, 'technical.meta_description_present');
  const pages = (args: Record<string, unknown>) =>
    dispatchTool(
      db,
      siteMember(seed),
      'read_site_pages',
      { project_id: seed.projectId, ...args },
      origin,
    );

  const affected = await pages({ rule_id: 'technical.meta_description_present' });
  expect(affected.items).toEqual([
    {
      site_url_id: described.id,
      url: 'https://example.test/docs',
      title: null,
      page_kind: 'product',
      status: 'completed',
      web_fundamentals_score: 80,
      aeo_readiness_score: null,
      aeo_measurement_state: 'limited_evidence',
      issue_count: 1,
      issue_rules: { advisory: ['technical.meta_description_present'] },
      inbound_count: null,
      depth_from_home: null,
      record_uri: `citeladder://site_page/${described.analysisId}`,
    },
    expect.objectContaining({
      site_url_id: titled.id,
      issue_count: 2,
      issue_rules: {
        advisory: ['technical.meta_description_present'],
        defect: ['technical.title_present'],
      },
    }),
  ]);
  const one = await pages({ rule_id: 'technical.title_present', limit: 1 });
  expect((one.items as { site_url_id: string }[]).map((item) => item.site_url_id)).toEqual([
    titled.id,
  ]);
  expect((one.pagination as { next_cursor: string | null }).next_cursor).toBeNull();
  // A cursor is bound to its filter, and an unknown rule or page kind is refused, not "no pages".
  const firstPage = await pages({ rule_id: 'technical.meta_description_present', limit: 1 });
  await expect(
    pages({
      rule_id: 'technical.title_present',
      cursor: (firstPage.pagination as { next_cursor: string }).next_cursor,
    }),
  ).rejects.toThrow('cursor is invalid');
  await expect(pages({ rule_id: 'technical.no_such_rule' })).rejects.toThrow(
    "Unknown rule_id 'technical.no_such_rule'",
  );
  await expect(pages({ page_kind: 'categories' })).rejects.toThrow('page_kind');
});

it('reads the internal links of several pages in one call, by page URL rather than internal neighbor ids', async () => {
  const seed = await siteFixtures.crawl();
  const [home, docs, blog] = [
    await sitePage(seed, '/'),
    await sitePage(seed, '/docs'),
    await sitePage(seed, '/blog'),
  ];
  const metrics = async (page: typeof home, inbound: number) =>
    db
      .insertInto('site_page_link_metrics')
      .values({
        id: randomUUID(),
        workspace_id: seed.workspaceId,
        project_id: seed.projectId,
        crawl_id: seed.crawlId,
        site_url_id: page.id,
        inbound_count: inbound,
        outbound_count: 1,
        main_content_inbound_count: inbound,
        main_content_outbound_count: 1,
        nofollow_inbound_count: 0,
        depth_from_home: 1,
        source_page_count: inbound,
        authority_share: 0,
        authority_rank: 1,
        anchor_diagnostics: JSON.stringify([]),
        top_inbound: JSON.stringify([
          {
            rel: [],
            url: 'https://example.test/',
            nofollow: false,
            site_url_id: home.id,
            anchor_count: 2,
            main_content: true,
          },
        ]),
        top_outbound: JSON.stringify([]),
        extractor_version: policy.site_health.versions.extractor,
        formula_version: policy.site_health.link_metrics.formula_version,
        created_at: new Date(),
      })
      .execute();
  await metrics(docs, 3);
  await metrics(blog, 5);
  const missing = randomUUID();
  const links = await dispatchTool(
    db,
    siteMember(seed),
    'read_site_links',
    { project_id: seed.projectId, site_url_ids: [blog.id, docs.id, missing] },
    origin,
  );
  const items = links.items as { url: string; inbound_count: number; top_inbound: unknown[] }[];
  expect(
    items
      .map((item) => [item.url, item.inbound_count, item.top_inbound])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  ).toEqual([
    [
      'https://example.test/blog',
      5,
      [{ url: 'https://example.test/', anchor_count: 2, main_content: true, nofollow: false }],
    ],
    [
      'https://example.test/docs',
      3,
      [{ url: 'https://example.test/', anchor_count: 2, main_content: true, nofollow: false }],
    ],
  ]);
  expect(links.missing_site_url_ids).toEqual([missing]);
  expect(links.versions).toEqual({
    extractor: policy.site_health.versions.extractor,
    formula: policy.site_health.link_metrics.formula_version,
  });
});

it('reports performance as not connected until a search source is connected, then as not projected', async () => {
  expect(await read('read_performance', { range: 'month' })).toMatchObject({
    state: 'unavailable',
    reason: 'not_connected',
    readiness_stage: 'not_connected',
  });
  await seedImport(db, {
    ...tenant,
    dataset: 'gsc_day_daily',
    window: ['2026-09-01', '2026-09-30'],
    provider: 'gsc',
  });
  expect(await read('read_performance', { range: '3_months' })).toMatchObject({
    state: 'unavailable',
    reason: 'performance_range_not_projected',
    readiness_stage: 'connected',
  });
});

it('reads cited sources for the latest run when no audit_id is named', async () => {
  expect(await read('read_visibility_sources')).toMatchObject({
    state: 'unavailable',
    reason: 'no_completed_run',
  });
  const first = await fixtures.audit(tenant, { completedAt: new Date('2026-10-01T00:00:00Z') });
  await fixtures.execution(tenant, {
    auditId: first,
    answerText: 'Acme answer',
    analysis: { citations: [{ url: 'https://publisher.example/a', domain: 'publisher.example' }] },
  });
  expect(await read('read_visibility_sources')).toMatchObject({
    state: 'available',
    audit_id: first,
    coverage: { responses: 1 },
    items: [expect.objectContaining({ key: 'publisher.example' })],
    artifact_refs: [expect.objectContaining({ id: first })],
  });
  const latest = await fixtures.audit(tenant, { completedAt: new Date('2026-10-02T00:00:00Z') });
  expect(await read('read_visibility_sources')).toMatchObject({
    audit_id: latest,
    coverage: { responses: 0 },
    items: [],
  });
  expect(await read('read_visibility_sources', { audit_id: first })).toMatchObject({
    audit_id: first,
    coverage: { responses: 1 },
  });
});
