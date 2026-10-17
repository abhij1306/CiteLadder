/**
 * The persisted visibility reads over HTTP: executions, the Sources series
 * and URL detail, and the AI Overview rates.
 *
 * Includes workspace isolation on every route.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.ts';
import { record } from '../src/db/json.ts';
import { TEST_SESSION_COOKIE, sessionToken, testConfig, testDatabase } from './support.ts';
import { VisibilityFixtures, type Tenant } from './visibility-fixtures.ts';
import { actionRow, opportunityRow } from './opportunity-fixtures.ts';

const config = testConfig();
const db = testDatabase(config);
const fixtures = new VisibilityFixtures(db);
const app = createApp(config, db);

const CONFIGURATION = {
  brand_name: 'Acme Corp',
  owned_domains: ['acme.example'],
  competitors: [{ name: 'Globex', aliases: ['Globex'], domains: ['globex.example'] }],
};

type Body = Record<string, unknown>;

async function get(
  tenant: Tenant | null,
  path: string,
  options: { query?: Record<string, string | string[]>; workspace?: string; method?: string } = {},
): Promise<{ status: number; body: Body; headers: Headers }> {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(options.query ?? {})) {
    for (const item of [value].flat()) search.append(key, item);
  }
  const headers: Record<string, string> = {};
  if (tenant) {
    const token = await sessionToken({ sub: tenant.userId, ver: 0 });
    headers.cookie = `${TEST_SESSION_COOKIE}=${token}`;
  }
  if (options.workspace) headers['x-workspace-id'] = options.workspace;
  const query = search.size ? `?${search}` : '';
  const response = await app.request(`${path}${query}`, {
    method: options.method ?? 'GET',
    headers,
  });
  return {
    status: response.status,
    body: (await response.json()) as Body,
    headers: response.headers,
  };
}

afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});

describe('GET /executions/{execution_id}', () => {
  let tenant: Tenant;
  let outsider: Tenant;

  beforeAll(async () => {
    tenant = await fixtures.tenant();
    outsider = await fixtures.tenant();
  });

  it('serves the persisted analysis, ordered citations and frozen provenance', async () => {
    const auditId = await fixtures.audit(tenant, {
      configuration: { measurement_policy: { retrieval_enabled: true } },
    });
    const { taskId, analysisId } = await fixtures.execution(tenant, {
      auditId,
      analysis: {
        brandMentioned: true,
        brandFirstOffset: 4,
        score: { competitors_mentioned: ['Globex'] },
        createdAt: new Date('2026-03-01T10:20:30.123Z'),
        citations: [
          { url: 'https://acme.example/a', isOwned: true },
          { url: 'https://globex.example/b', matched: 'Globex' },
        ],
      },
    });

    const { status, body } = await get(tenant, `/api/v1/executions/${taskId}`);

    expect(status).toBe(200);
    expect(body).toMatchObject({
      id: taskId,
      task_id: taskId,
      analysis_id: analysisId,
      audit_id: auditId,
      retrieval_enabled: true,
      brand_mentioned: true,
      brand_first_offset: 4,
      competitors_mentioned: ['Globex'],
      // An LLM execution has no observed surface: null, not an empty one.
      search_surface: null,
      created_at: '2026-03-01T10:20:30.123000Z',
    });
    expect((body.citations as Body[]).map((citation) => [citation.ordinal, citation.url])).toEqual([
      [0, 'https://acme.example/a'],
      [1, 'https://globex.example/b'],
    ]);
  });

  it('is not found from another workspace or to the local user', async () => {
    const auditId = await fixtures.audit(tenant);
    const { taskId } = await fixtures.execution(tenant, { auditId });

    const foreign = await get(outsider, `/api/v1/executions/${taskId}`);
    expect(foreign.status).toBe(404);
    expect(record(foreign.body.error).message).toBe('Execution not found');
    expect((await get(null, `/api/v1/executions/${taskId}`)).status).toBe(404);
  });

  it('keeps the three surface signals independent', async () => {
    const auditId = await fixtures.audit(tenant, { configuration: CONFIGURATION });
    const surfaceExecution = (analysis: object, links: string[] = []) =>
      fixtures.execution(tenant, {
        auditId,
        engine: 'google_ai_overview',
        analysis,
        observation: { links },
      });
    const named = await surfaceExecution({ brandMentioned: true, brandFirstOffset: 0 });
    const cited = await surfaceExecution({
      ownedCited: true,
      citations: [{ url: 'https://acme.example/pricing', isOwned: true }],
    });
    const linked = await surfaceExecution({}, [
      'https://acme.example/guide',
      'https://globex.example/x',
    ]);

    const signals = async (taskId: string) => {
      const { body } = await get(tenant, `/api/v1/executions/${taskId}`);
      const entities = (body.search_surface as { entities: Body[] }).entities;
      return entities.map((entity) => [entity.name, entity.mentioned, entity.linked, entity.cited]);
    };
    expect(await signals(named.taskId)).toEqual([
      ['Acme Corp', true, false, false],
      ['Globex', false, false, false],
    ]);
    expect(await signals(cited.taskId)).toEqual([
      ['Acme Corp', false, false, true],
      ['Globex', false, false, false],
    ]);
    expect(await signals(linked.taskId)).toEqual([
      ['Acme Corp', false, true, false],
      ['Globex', false, true, false],
    ]);
  });

  it('derives mention order from offsets, with no order for an unnamed brand', async () => {
    const auditId = await fixtures.audit(tenant, { configuration: CONFIGURATION });
    const order = async (brandFirstOffset: number | null) => {
      const { taskId } = await fixtures.execution(tenant, {
        auditId,
        engine: 'google_ai_overview',
        analysis: {
          brandMentioned: brandFirstOffset !== null,
          brandFirstOffset,
          score: { brand_first_offset: brandFirstOffset, competitor_first_offsets: { Globex: 5 } },
          competitorMentions: ['Globex'],
        },
        observation: {},
      });
      const { body } = await get(tenant, `/api/v1/executions/${taskId}`);
      const entities = (body.search_surface as { entities: Body[] }).entities;
      return entities.map((entity) => entity.mention_order);
    };
    expect(await order(null)).toEqual([null, 1]);
    expect(await order(0)).toEqual([1, 2]);
  });

  it('answers another method 405 and a malformed id with the validation envelope', async () => {
    const auditId = await fixtures.audit(tenant);
    const { taskId } = await fixtures.execution(tenant, { auditId });
    const post = await get(tenant, `/api/v1/executions/${taskId}`, { method: 'POST' });
    expect(post.status).toBe(405);
    expect(post.headers.get('allow')).toBe('GET');

    const malformed = await get(tenant, '/api/v1/executions/not-a-uuid');
    expect(malformed.status).toBe(422);
    expect(malformed.body.error).toMatchObject({
      code: 'validation_error',
      details: { errors: [{ loc: ['execution_id'], type: 'uuid_parsing' }] },
    });
    expect(malformed.headers.get('cache-control')).toBe('private, no-store, max-age=0');
  });
});

describe('GET /projects/{project_id}/visibility/surface-rates', () => {
  let tenant: Tenant;
  const rates = (
    target: Tenant,
    query: Record<string, string | string[]> = {},
    workspace?: string,
  ) =>
    get(target, `/api/v1/projects/${target.projectId}/visibility/surface-rates`, {
      query: { engine: 'google_ai_overview', ...query },
      workspace,
    });

  beforeAll(async () => {
    tenant = await fixtures.tenant();
  });

  it('excludes failed retrievals from every denominator', async () => {
    const auditId = await fixtures.audit(tenant, { configuration: CONFIGURATION });
    const observed = (promptIndex: number, observation: object, analysis: object | null = {}) =>
      fixtures.execution(tenant, {
        auditId,
        engine: 'google_ai_overview',
        promptIndex,
        analysis,
        observation,
      });
    await observed(0, {});
    await observed(1, { outcome: 'no_ai_overview', aioPresent: false });
    await observed(2, { outcome: 'execution_failure', aioPresent: null }, null);

    const { status, body } = await rates(tenant, { audit_id: auditId });

    expect(status).toBe(200);
    expect(body).toMatchObject({ successful: 2, with_overview: 1, excluded: 1 });
    expect(body.trigger_rate).toEqual({
      numerator: 1,
      denominator: 2,
      denominator_kind: 'successful_observations',
      value: 0.5,
    });
  });

  it('reports an empty denominator as unavailable, never zero', async () => {
    const other = await fixtures.tenant();
    const auditId = await fixtures.audit(other, { configuration: CONFIGURATION });
    await fixtures.execution(other, {
      auditId,
      engine: 'google_ai_overview',
      observation: { outcome: 'no_ai_overview', aioPresent: false },
    });

    const { body } = await rates(other);

    expect(body.trigger_rate).toEqual({
      numerator: 0,
      denominator: 1,
      denominator_kind: 'successful_observations',
      value: 0,
    });
    expect(body.brand_mention_rate_when_present).toEqual({
      numerator: 0,
      denominator: 0,
      denominator_kind: 'observations_with_ai_overview',
      value: null,
    });
  });

  it('divides competitor rates by the overviews shown', async () => {
    const other = await fixtures.tenant();
    const auditId = await fixtures.audit(other, { configuration: CONFIGURATION });
    const observed = (
      promptIndex: number,
      observation: object,
      competitorMentions: string[] = [],
    ) =>
      fixtures.execution(other, {
        auditId,
        engine: 'google_ai_overview',
        promptIndex,
        analysis: { competitorMentions },
        observation,
      });
    await observed(0, {}, ['Globex', 'Globex']);
    await observed(1, {});
    await observed(2, { outcome: 'no_ai_overview', aioPresent: false }, ['Globex']);

    const { body } = await rates(other);

    expect(body.competitor_mention_rates).toEqual([
      {
        name: 'Globex',
        rate: {
          numerator: 1,
          denominator: 2,
          denominator_kind: 'observations_with_ai_overview',
          value: 0.5,
        },
      },
    ]);
  });

  it('keeps a failure in the excluded count when the cohort filter applies', async () => {
    const other = await fixtures.tenant();
    const auditId = await fixtures.audit(other, { configuration: CONFIGURATION });
    await fixtures.execution(other, {
      auditId,
      engine: 'google_ai_overview',
      analysis: null,
      observation: { outcome: 'execution_failure', aioPresent: null },
    });
    await fixtures.execution(other, {
      auditId,
      engine: 'google_ai_overview',
      promptIndex: 1,
      cohort: 'comparison',
      observation: {},
    });

    const { body } = await rates(other);

    expect(body).toMatchObject({ excluded: 1, successful: 0 });
  });

  it('gives an answer engine no rates, and rejects a name that is no engine', async () => {
    const llm = await rates(tenant, { engine: 'chatgpt' });
    expect(llm.status).toBe(200);
    expect(llm.body).toMatchObject({ logical_engine: 'chatgpt', successful: 0 });
    expect(llm.body.trigger_rate).toEqual({
      numerator: 0,
      denominator: 0,
      denominator_kind: '',
      value: null,
    });

    const typo = await rates(tenant, { engine: 'gooogle_ai_overview' });
    expect(typo.status).toBe(422);
    expect(typo.body.error).toMatchObject({ code: 'validation_error', retryable: false });
  });

  it('is not found for an unknown run, a foreign workspace or a foreign project', async () => {
    expect((await rates(tenant, { audit_id: randomUUID() })).status).toBe(404);
    expect((await rates(tenant, {}, randomUUID())).status).toBe(404);
    const outsider = await fixtures.tenant();
    const foreignProject = await get(
      outsider,
      `/api/v1/projects/${tenant.projectId}/visibility/surface-rates`,
      { query: { engine: 'google_ai_overview' } },
    );
    expect(foreignProject.status).toBe(404);
    expect(record(foreignProject.body.error).message).toBe('Project not found');
  });
});

describe('GET /projects/{project_id}/visibility/sources/*', () => {
  let tenant: Tenant;
  let selected: string;
  let unselected: string;
  const url = 'https://example.com/selected';

  beforeAll(async () => {
    tenant = await fixtures.tenant();
    await fixtures.brand(tenant.projectId, 'Acme Corp', true);
    await fixtures.competitor(tenant.projectId, {
      name: 'Wise',
      aliases: ['TransferWise'],
      domains: ['wise.example'],
    });
    selected = await fixtures.audit(tenant, { completedAt: new Date('2026-02-01T08:00:00Z') });
    unselected = await fixtures.audit(tenant, { completedAt: new Date('2026-03-01T08:00:00Z') });
    await fixtures.execution(tenant, {
      auditId: selected,
      promptText: 'best payroll tools',
      theme: 'Payroll',
      analysis: {
        citations: [
          { url, domain: 'example.com', title: 'Selected page' },
          { url, domain: 'example.com' },
        ],
        brandMentions: ['Acme Corp'],
        competitorMentions: ['TransferWise'],
      },
    });
    await fixtures.execution(tenant, {
      auditId: selected,
      engine: 'gemini',
      promptIndex: 1,
      analysis: { citations: [{ url: 'https://other.example/x', domain: 'other.example' }] },
    });
    // A task that did not succeed is not evidence, even with an analysis.
    await fixtures.execution(tenant, {
      auditId: selected,
      promptIndex: 2,
      taskStatus: 'failed',
      analysis: { citations: [{ url, domain: 'example.com' }] },
    });
    await fixtures.execution(tenant, {
      auditId: unselected,
      analysis: {
        citations: [{ url: 'https://unselected.example/', domain: 'unselected.example' }],
      },
    });
  });

  it('draws one dense line per leading source over the selected runs', async () => {
    const { status, body } = await get(
      tenant,
      `/api/v1/projects/${tenant.projectId}/visibility/sources/series`,
      { query: { audit_ids: selected } },
    );

    expect(status).toBe(200);
    expect(body).toEqual({
      dimension: 'domain',
      granularity: 'day',
      buckets: ['2026-02-01T00:00:00Z'],
      series: [
        {
          key: 'example.com',
          citations: 2,
          points: [{ at: '2026-02-01T00:00:00Z', responses: 1, share: 0.5 }],
        },
        {
          key: 'other.example',
          citations: 1,
          points: [{ at: '2026-02-01T00:00:00Z', responses: 1, share: 0.5 }],
        },
      ],
    });
  });

  it('keeps a bucket with no citation of a source as a real zero', async () => {
    const { body } = await get(
      tenant,
      `/api/v1/projects/${tenant.projectId}/visibility/sources/series`,
      { query: { granularity: 'month', limit: '1' } },
    );
    expect(body.buckets).toEqual(['2026-02-01T00:00:00Z', '2026-03-01T00:00:00Z']);
    expect(body.series).toEqual([
      {
        key: 'example.com',
        citations: 2,
        points: [
          { at: '2026-02-01T00:00:00Z', responses: 1, share: 0.5 },
          { at: '2026-03-01T00:00:00Z', responses: 0, share: 0 },
        ],
      },
    ]);
  });

  it('details one URL within the selection, with co-named brands and their marks', async () => {
    const { status, body } = await get(
      tenant,
      `/api/v1/projects/${tenant.projectId}/visibility/sources/url`,
      { query: { url, audit_id: selected } },
    );

    expect(status).toBe(200);
    expect(body).toMatchObject({
      url,
      title: 'Selected page',
      retrievals: 1,
      citations: 2,
      responses: 2,
      citation_rate: 2,
      prompts: 1,
      first_seen: '2026-02-01T08:00:00Z',
      last_seen: '2026-02-01T08:00:00Z',
      engines: [{ logical_engine: 'chatgpt', transport_model: 'test-model', retrievals: 1 }],
      prompt_rows: [
        {
          prompt_text: 'best payroll tools',
          topic: 'Payroll',
          responses: 1,
          last_seen: '2026-02-01T08:00:00Z',
          engines: ['chatgpt'],
        },
      ],
    });
    expect(body.brands).toEqual([
      {
        kind: 'brand',
        name: 'Acme Corp',
        responses: 1,
        logo_url: `/api/v1/projects/${tenant.projectId}/logo`,
        website: 'https://acme.example',
      },
      // Resolved through the competitor's alias, not only its name.
      {
        kind: 'competitor',
        name: 'TransferWise',
        responses: 1,
        logo_url: null,
        website: 'wise.example',
      },
    ]);
  });

  it('shows what the last successful reading found on the page and the Action to get listed', async () => {
    const hash = `hash-${randomUUID()}`;
    const scope = { workspace_id: tenant.workspaceId, project_id: tenant.projectId };
    await db
      .updateTable('citations')
      .set({ url_hash: hash })
      .where('workspace_id', '=', tenant.workspaceId)
      .where('url', '=', url)
      .execute();
    const pageId = randomUUID();
    await db
      .insertInto('source_pages')
      .values({
        ...scope,
        id: pageId,
        url_hash: hash,
        canonical_url: url,
        registrable_domain: 'example.com',
        source_class: 'editorial_third_party',
        inspection_state: 'failed',
        inspection_reason: 'transport_error',
        page_format: 'listicle',
        page_format_method: 'heading_evidence',
        recurrence_count: 3,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .execute();
    const reading = (outcome: string, at: string) => ({
      ...scope,
      id: randomUUID(),
      source_page_id: pageId,
      requested_url: url,
      final_url: url,
      body_bytes: 0,
      outcome,
      extracted_chars: outcome === 'inspected' ? 4200 : 0,
      evidence_passages: JSON.stringify([{ text: 'Globex leads the list.' }]),
      fetched_at: new Date(at),
      created_at: new Date(at),
    });
    const read = reading('inspected', '2026-02-02T00:00:00Z');
    // A later attempt that failed must not erase what the earlier one learned.
    await db
      .insertInto('source_page_snapshots')
      .values([read, reading('failed', '2026-02-03T00:00:00Z')])
      .execute();
    const presence = (kind: string, name: string, state: string, refs: number[]) => ({
      ...scope,
      id: randomUUID(),
      source_page_id: pageId,
      snapshot_id: read.id,
      entity_kind: kind,
      entity_name: name,
      presence: state,
      match_method: state === 'present' ? 'exact_alias' : 'none',
      match_count: refs.length,
      passage_refs: JSON.stringify(refs),
      roster_version: 'roster',
      detector_version: 'test',
      created_at: new Date(),
    });
    await db
      .insertInto('source_page_entity_presences')
      .values([
        presence('brand', 'Acme Corp', 'not_detected', []),
        presence('competitor', 'Globex', 'present', [0]),
      ])
      .execute();
    const opportunity = opportunityRow(scope, {
      rule_id: 'earned_page_acquire_listing',
      opportunity_type: 'visibility',
      severity: 'high',
      target_key: `earned-page:${hash}`,
    });
    await db.insertInto('opportunities').values(opportunity).execute();
    const action = actionRow(scope, {
      group_key: `earned:${hash}`,
      target_kind: 'earned_page',
      target_label: url,
      member_opportunity_ids: JSON.stringify([opportunity.id]),
    });
    await db.insertInto('actions').values(action).execute();

    const { body } = await get(
      tenant,
      `/api/v1/projects/${tenant.projectId}/visibility/sources/url`,
      { query: { url, audit_id: selected } },
    );

    expect(body.page).toEqual({
      state: 'failed',
      reason: 'transport_error',
      read_at: '2026-02-02T00:00:00Z',
      extracted_chars: 4200,
      page_format: 'listicle',
      page_format_method: 'heading_evidence',
      source_class: 'editorial_third_party',
      entities: [
        {
          entity_kind: 'brand',
          entity_name: 'Acme Corp',
          presence: 'not_detected',
          match_method: 'none',
          match_count: 0,
          passages: [],
        },
        {
          entity_kind: 'competitor',
          entity_name: 'Globex',
          presence: 'present',
          match_method: 'exact_alias',
          match_count: 1,
          passages: ['Globex leads the list.'],
        },
      ],
      standing: 'gap',
      action_id: action.id,
    });

    // The URL table carries the same standing and Action, and its gap filter
    // keeps exactly the pages that show that standing.
    const urlRows = async (query: Record<string, string>) => {
      const { body: page } = await get(
        tenant,
        `/api/v1/projects/${tenant.projectId}/visibility/sources`,
        { query: { audit_id: selected, dimension: 'url', ...query } },
      );
      return (page.items as Record<string, unknown>[]).map((row) => [
        row.key,
        row.standing,
        row.action_id,
      ]);
    };
    expect(await urlRows({})).toEqual([
      [url, 'gap', action.id],
      ['https://other.example/x', null, null],
    ]);
    expect(await urlRows({ standing: 'gap' })).toEqual([[url, 'gap', action.id]]);
    // Publisher rows have no standing, so the filter is refused there.
    const domains = await get(tenant, `/api/v1/projects/${tenant.projectId}/visibility/sources`, {
      query: { audit_id: selected, standing: 'gap' },
    });
    expect(domains.status).toBe(422);
  });

  it("draws one page's own line for its detail view", async () => {
    const { body } = await get(
      tenant,
      `/api/v1/projects/${tenant.projectId}/visibility/sources/series`,
      { query: { audit_ids: selected, dimension: 'url', url } },
    );
    expect(body.series).toEqual([
      {
        key: url,
        citations: 2,
        points: [{ at: '2026-02-01T00:00:00Z', responses: 1, share: 0.5 }],
      },
    ]);
  });

  it('refuses a run from another project as not found, singly or in a set', async () => {
    const other = await fixtures.tenant();
    const foreign = await fixtures.audit(other);
    const selections: Record<string, string | string[]>[] = [
      { audit_id: foreign },
      { audit_ids: [selected, foreign] },
    ];
    for (const query of selections) {
      const series = await get(
        tenant,
        `/api/v1/projects/${tenant.projectId}/visibility/sources/series`,
        { query },
      );
      expect(series.status).toBe(404);
      expect(record(series.body.error).message).toBe('Audit not found');
      const detail = await get(
        tenant,
        `/api/v1/projects/${tenant.projectId}/visibility/sources/url`,
        { query: { ...query, url } },
      );
      expect(detail.status).toBe(404);
    }
  });

  it('answers a naive or reversed window 422 with the reader message', async () => {
    const path = `/api/v1/projects/${tenant.projectId}/visibility/sources/series`;
    const naive = await get(tenant, path, { query: { from: '2026-02-01T00:00:00' } });
    expect(naive.status).toBe(422);
    expect(record(naive.body.error).message).toBe("'from' must be a timezone-aware timestamp");
    const reversed = await get(tenant, path, {
      query: { from: '2026-03-01T00:00:00Z', to: '2026-02-01T00:00:00+05:30' },
    });
    expect(record(reversed.body.error).message).toBe("'from' must not be after 'to'");
    // A numeric timestamp beyond the years a datetime holds is malformed input.
    const outOfRange = await get(tenant, path, { query: { from: '99999999999999999' } });
    expect(outOfRange.status).toBe(422);
    expect(outOfRange.body.error).toMatchObject({ code: 'validation_error' });
  });

  it('reads nothing across workspaces', async () => {
    const outsider = await fixtures.tenant();
    const own = await get(
      outsider,
      `/api/v1/projects/${outsider.projectId}/visibility/sources/series`,
    );
    expect(own.body).toEqual({ dimension: 'domain', granularity: 'day', buckets: [], series: [] });
    const foreign = await get(
      outsider,
      `/api/v1/projects/${tenant.projectId}/visibility/sources/url`,
      { query: { url } },
    );
    expect(foreign.status).toBe(404);
  });
});

describe('the active workspace', () => {
  it('defaults to the earliest tenant membership and rejects a malformed selection', async () => {
    const tenant = await fixtures.tenant();
    const path = `/api/v1/projects/${tenant.projectId}/visibility/surface-rates`;
    const query = { engine: 'chatgpt' };
    expect((await get(tenant, path, { query })).status).toBe(200);
    expect((await get(tenant, path, { query, workspace: tenant.workspaceId })).status).toBe(200);
    const malformed = await get(tenant, path, { query, workspace: 'not-a-workspace' });
    expect(malformed.status).toBe(400);
    expect(record(malformed.body.error).message).toBe('Invalid X-Workspace-Id');
  });
});
