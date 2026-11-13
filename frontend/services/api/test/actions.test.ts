/** Action cutover: real routes, authorization, concurrency and frozen evidence. */
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import {
  actionDetailSchema,
  actionsPageSchema,
  actionDeclarationSchema,
} from '@citeladder/contracts/actions';
import { searchConsoleState } from '../src/opportunities/measurement-legs.ts';
import { refreshActionStatus } from '../src/opportunities/action-status.ts';
import { syncActions } from '../src/opportunities/action-sync.ts';
import { policy } from '../src/config.ts';
import { declarationChecks } from '../src/opportunities/declaration-checks.ts';
import { CHECKS, memberMeasurementLeg } from '../src/opportunities/checks/registry.ts';
import type { OpportunityRow } from '../src/opportunities/projection.ts';
import { actionFixture, type ActionSeed } from './action-support.ts';
import { actionRow, opportunityRow, snapshotRow } from './opportunity-fixtures.ts';
import { TEST_SESSION_COOKIE, sessionToken, testConfig, testDatabase } from './support.ts';

const config = testConfig();
const db = testDatabase(config);
const app = createApp(config, db);
const seeds: ActionSeed[] = [];
// Inside the declaration window, which is relative to now.
const day = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
const nextDay = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
const boundary = `${day}T15:00:00.123456Z`;
const pageRule = 'missing_structured_data';
const otherRule = 'content_structure_incomplete';
const promptRule = 'brand_absent_high_value_prompt';
async function seed() {
  const s = await actionFixture<ActionSeed>('seed');
  seeds.push(s);
  return s;
}
const pageBody = async (response: Response) => actionsPageSchema.parse(await response.json());
const detailBody = async (response: Response) => actionDetailSchema.parse(await response.json());
const declarationBody = async (response: Response) =>
  actionDeclarationSchema.parse(await response.json());
const actionId = (s: ActionSeed, rule = pageRule) => s.actions[rule]!;
const actionPath = (s: ActionSeed, rule = pageRule) => `/api/v1/actions/${actionId(s, rule)}`;
async function request(s: ActionSeed, path: string, method = 'GET', body?: unknown, key?: string) {
  const headers: Record<string, string> = {
    cookie: `${TEST_SESSION_COOKIE}=${await sessionToken({ sub: s.user_id, ver: 0 })}`,
    'x-workspace-id': s.workspace_id,
    'content-type': 'application/json',
  };
  if (key !== undefined) headers['Idempotency-Key'] = key;
  return app.request(path, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const declare = (s: ActionSeed, key: string, rule = pageRule, extra = {}) =>
  request(
    s,
    `${actionPath(s, rule)}/declaration`,
    'POST',
    { declared_implemented_at: boundary, ...extra },
    key,
  );
async function eventCount(s: ActionSeed) {
  const row = await db
    .selectFrom('action_status_events')
    .select(sql<number>`count(*)::int`.as('n'))
    .where('workspace_id', '=', s.workspace_id)
    .executeTakeFirstOrThrow();
  return row.n;
}
afterAll(async () => {
  for (const s of seeds) {
    await db.deleteFrom('workspaces').where('id', '=', s.workspace_id).execute();
    await db.deleteFrom('users').where('id', '=', s.user_id).execute();
  }
  await db.destroy();
});

describe('Action routes', () => {
  it('pages a priority queue, scopes cursors and counts, and records each status transition once', async () => {
    const s = await seed();
    const list = `/api/v1/projects/${s.project_id}/actions`;
    const first = await pageBody(await request(s, `${list}?limit=1`));
    const second = await pageBody(await request(s, `${list}?limit=1&cursor=${first.next_cursor}`));
    expect(first.items[0]!.id).not.toBe(second.items[0]!.id);
    expect(first.status_counts.open).toBe(3);
    expect((await request(s, `${list}?status=dismissed&cursor=${first.next_cursor}`)).status).toBe(
      400,
    );
    expect((await request(s, `${list}?target_kind=wrong`)).status).toBe(422);
    for (let n = 0; n < 2; n++)
      expect((await request(s, actionPath(s), 'PATCH', { status: 'dismissed' })).status).toBe(200);
    expect(await eventCount(s)).toBe(1);
    const queue = await pageBody(await request(s, list));
    expect(queue.items.map((row: { id: string }) => row.id)).not.toContain(actionId(s));
    expect(queue.status_counts.dismissed).toBe(1);
    const dismissed = await pageBody(await request(s, `${list}?status=dismissed&target_kind=page`));
    expect(dismissed.items.map((row: { id: string }) => row.id)).toEqual([actionId(s)]);
    expect((await declare(s, 'dismissed')).status).toBe(409);
    await request(s, actionPath(s), 'PATCH', { status: 'open' });
    const detail = await detailBody(await request(s, actionPath(s)));
    expect(detail.members.map((member) => member.id)).toEqual([s.members[pageRule]]);
  });

  it('returns the persisted handoff message on the list and the detail, or one about the label', async () => {
    const s = await seed();
    const list = `/api/v1/projects/${s.project_id}/actions`;
    // Action sync persists the handoff in the diagnosis; the routes only read it.
    await db
      .updateTable('actions')
      .set({
        diagnosis: JSON.stringify({
          handoff: { context: 'page_url', workflow_id: 'refresh_page', message: 'Fix page a.' },
        }),
      })
      .where('id', '=', actionId(s))
      .execute();
    const items = (await pageBody(await request(s, list))).items;
    expect(
      Object.fromEntries(items.map((item) => [item.target_label, item.handoff.message])),
    ).toEqual({
      'https://acme.test/a': 'Fix page a.',
      // No persisted diagnosis: the chat opens about the Action's label.
      'https://acme.test/b': 'Work on https://acme.test/b.',
      'best crm for small teams': 'Work on best crm for small teams.',
    });
    expect((await detailBody(await request(s, actionPath(s)))).handoff).toEqual({
      context: 'page_url',
      workflow_id: 'refresh_page',
      message: 'Fix page a.',
    });
  });

  it('groups Actions by target and approach, filters by group, priority, approach and source, and counts groups per workspace', async () => {
    const s = await seed();
    const foreign = await seed();
    const approach = async (id: string, value: string) =>
      db.updateTable('actions').set({ approach: value }).where('id', '=', id).execute();
    await approach(actionId(s, pageRule), 'fix_technical');
    await approach(actionId(s, otherRule), 'improve_existing');
    await approach(actionId(s, promptRule), 'create_new');
    const product = actionRow(
      { workspace_id: s.workspace_id, project_id: s.project_id },
      {
        group_key: 'product:widget',
        target_kind: 'product',
        target_label: 'Widget',
        approach: 'improve_existing',
        priority_score: 25,
        families: JSON.stringify(['commerce']),
      },
    );
    await db.insertInto('actions').values(product).execute();
    const list = `/api/v1/projects/${s.project_id}/actions`;
    const read = async (query: string) => pageBody(await request(s, `${list}${query}`));
    const rows = (page: { items: { id: string; group: string; priority_band: string | null }[] }) =>
      page.items.map((item) => [item.id, item.group, item.priority_band]);

    const all = await read('');
    expect(rows(all)).toEqual([
      [actionId(s, promptRule), 'own_pages', 'high'],
      [product.id, 'products', 'medium'],
      [actionId(s, pageRule), 'fix_site', 'medium'],
      [actionId(s, otherRule), 'own_pages', 'low'],
    ]);
    expect(all.group_counts).toEqual({ fix_site: 1, own_pages: 2, earned: 0, products: 1 });

    // A group narrows the rows, not the group counts beside them.
    const own = await read('?group=own_pages&limit=1');
    expect(rows(own)).toEqual([[actionId(s, promptRule), 'own_pages', 'high']]);
    expect(own.group_counts).toEqual(all.group_counts);
    const next = await read(`?group=own_pages&limit=1&cursor=${own.next_cursor}`);
    expect(rows(next)).toEqual([[actionId(s, otherRule), 'own_pages', 'low']]);
    expect(next.next_cursor).toBeNull();
    expect((await request(s, `${list}?group=fix_site&cursor=${own.next_cursor}`)).status).toBe(400);

    // Every other filter narrows the group counts too.
    const medium = await read('?priority=medium');
    expect(rows(medium).map(([id]) => id)).toEqual([product.id, actionId(s, pageRule)]);
    expect(medium.group_counts).toEqual({ fix_site: 1, own_pages: 0, earned: 0, products: 1 });
    expect(rows(await read('?approach=fix_technical')).map(([id]) => id)).toEqual([
      actionId(s, pageRule),
    ]);
    expect(rows(await read('?family=commerce')).map(([id]) => id)).toEqual([product.id]);
    for (const query of ['group=mine', 'priority=urgent', 'approach=rewrite', 'family=email'])
      expect((await request(s, `${list}?${query}`)).status).toBe(422);

    // Another workspace neither reads these rows nor counts them.
    expect((await request(foreign, `${list}?group=products`)).status).toBe(404);
    const theirs = await pageBody(
      await request(foreign, `/api/v1/projects/${foreign.project_id}/actions?group=products`),
    );
    expect([theirs.items, theirs.group_counts]).toEqual([
      [],
      { fix_site: 0, own_pages: 3, earned: 0, products: 0 },
    ]);
  });

  it('reads the status its writers persisted, not one re-derived from raw input rows', async () => {
    const s = await seed();
    const list = `/api/v1/projects/${s.project_id}/actions`;
    const stored = async () =>
      (
        await db
          .selectFrom('actions')
          .select('effective_status')
          .where('id', '=', actionId(s))
          .executeTakeFirstOrThrow()
      ).effective_status;
    // The output writer's transaction persists in-progress.
    await actionFixture<string>('revision', s.workspace_id, s.project_id, actionId(s));
    expect(await stored()).toBe('in_progress');
    // A declaration persists implemented in its own transaction.
    const declared = await declarationBody(await declare(s, 'persisted'));
    expect(await stored()).toBe('implemented');
    // A verification row no writer recorded leaves every read as persisted.
    await db
      .insertInto('opportunity_verification_events')
      .values({
        id: randomUUID(),
        workspace_id: s.workspace_id,
        project_id: s.project_id,
        implementation_event_id: declared.id,
        observation_kind: 'verified',
        observed_at: new Date(),
        created_at: new Date(),
        crawl_id: s.crawl_id,
        audit_id: null,
        source_analysis_ids: '[]',
        source_rule_evaluation_ids: '[]',
        source_metric_ids: '[]',
        result: '{}',
        verifier_version: 'implementation-verifier-1',
        limitations: '[]',
        idempotency_key: randomUUID(),
      })
      .execute();
    const page = await pageBody(await request(s, `${list}?status=implemented`));
    expect(page.items.map((row) => [row.id, row.status])).toEqual([[actionId(s), 'implemented']]);
    expect(page.status_counts).toMatchObject({ open: 2, implemented: 1, done: 0 });
    expect((await detailBody(await request(s, actionPath(s)))).status).toBe('implemented');
  });

  it('rejects outsider, foreign and viewer writes without disclosing or mutating rows', async () => {
    const s = await seed();
    const foreign = await seed();
    const missing = await request(s, `/api/v1/actions/${randomUUID()}`);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: { code: 'not_found', retryable: false } });
    const paths = [
      [`/api/v1/projects/${s.project_id}/actions`, 'GET'],
      [actionPath(s), 'GET'],
      [actionPath(s), 'PATCH'],
      [`${actionPath(s)}/declaration`, 'POST'],
    ];
    for (const [path, method] of paths) {
      const body =
        method === 'PATCH'
          ? { status: 'dismissed' }
          : method === 'POST'
            ? { declared_implemented_at: boundary }
            : undefined;
      // Without a test cookie the request acts as the local user, an outsider here.
      const outsider = await app.request(path!, {
        method,
        headers: { 'content-type': 'application/json', 'Idempotency-Key': 'outsider' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      expect(outsider.status).toBe(404);
      expect((await request(foreign, path!, method, body, 'foreign')).status).toBe(404);
    }
    await db
      .updateTable('workspace_members')
      .set({ role: 'viewer' })
      .where('workspace_id', '=', s.workspace_id)
      .execute();
    expect((await request(s, actionPath(s))).status).toBe(200);
    expect((await request(s, actionPath(s), 'PATCH', { status: 'dismissed' })).status).toBe(403);
    expect((await declare(s, 'viewer')).status).toBe(403);
    expect(await eventCount(s)).toBe(0);
  });

  it('freezes targets and checks, preserves microseconds, and replays before resolving changed evidence', async () => {
    const s = await seed();
    for (const status of ['implemented', 'in_progress', 'done'])
      expect((await request(s, actionPath(s), 'PATCH', { status })).status).toBe(422);
    expect((await declare(s, 'injected', pageRule, { expected_checks: [] })).status).toBe(422);
    expect((await declare(s, 'injected', pageRule, { target_site_url_ids: [] })).status).toBe(422);
    expect((await declare(s, '')).status).toBe(422);
    expect(
      (await declare(s, 'naive', pageRule, { declared_implemented_at: `${day}T15:00:00` })).status,
    ).toBe(422);
    const created = await declare(s, 'once');
    expect(created.status).toBe(201);
    const body = await declarationBody(created);
    expect(body.declared_implemented_at).toBe(boundary);
    expect(body.member_opportunity_ids).toEqual([s.members[pageRule]]);
    expect(body.expected_checks).toEqual([
      { kind: 'site_rule', rule_id: 'aeo.structured_data_present', expected_outcome: 'pass' },
    ]);
    const page = await db
      .selectFrom('site_urls')
      .select('id')
      .where('project_id', '=', s.project_id)
      .where('normalized_url', '=', 'https://acme.test/a')
      .executeTakeFirstOrThrow();
    expect(body.target_site_url_ids).toEqual([page.id]);
    expect(body.legs[0]!.state).toBe('not_scheduled');
    // A stored serialization hash is not the request's meaning.
    await db
      .updateTable('opportunity_implementation_events')
      .set({ request_fingerprint: 'a'.repeat(64) })
      .where('id', '=', body.id)
      .execute();
    await db
      .updateTable('actions')
      .set({ member_opportunity_ids: '[]', target_url: 'https://unresolved.test/' })
      .where('id', '=', actionId(s))
      .execute();
    const replay = await declare(s, 'once');
    expect(replay.status).toBe(200);
    expect((await declarationBody(replay)).id).toBe(body.id);
    expect(
      (
        await declare(s, 'once', pageRule, {
          declared_implemented_at: `${day}T20:30:00.123456+05:30`,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await declare(s, 'once', pageRule, {
          declared_implemented_at: `${day}T15:00:00.123457Z`,
        })
      ).status,
    ).toBe(409);
    expect(
      (await declare(s, 'once', pageRule, { declared_implemented_at: `${nextDay}T00:00:00Z` }))
        .status,
    ).toBe(409);
    expect((await declare(s, 'once', otherRule)).status).toBe(409);
    expect((await declare(s, 'different')).status).toBe(409);
    expect((await request(s, actionPath(s), 'PATCH', { status: 'open' })).status).toBe(422);
    expect(await eventCount(s)).toBe(1);
  });

  it('serializes identical requests and leaves a losing declaration without side effects', async () => {
    const s = await seed();
    const results = await Promise.all([declare(s, 'race'), declare(s, 'race')]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(await eventCount(s)).toBe(1);
    const t = await seed();
    const different = await Promise.all([declare(t, 'shared'), declare(t, 'shared', otherRule)]);
    expect(different.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await eventCount(t)).toBe(1);
    const rows = await db
      .selectFrom('actions')
      .select('status')
      .where('workspace_id', '=', t.workspace_id)
      .execute();
    expect(rows.filter((row) => row.status === 'implemented')).toHaveLength(1);
  });

  it('requires live findings and a resolved owned page', async () => {
    const s = await seed();
    await db
      .updateTable('actions')
      .set({ target_url: 'https://acme.test/unknown' })
      .where('id', '=', actionId(s))
      .execute();
    expect((await declare(s, 'unresolved')).status).toBe(409);
    await db
      .updateTable('opportunities')
      .set({ superseded_at: new Date() })
      .where('id', '=', s.members[otherRule]!)
      .execute();
    expect((await declare(s, 'cleared', otherRule)).status).toBe(409);
    expect(await eventCount(s)).toBe(0);
  });

  it('recovers a workspace-wide key collision across projects without persisting losing effects', async () => {
    const s = await seed();
    const sibling = await actionFixture<{ project_id: string; action_id: string }>(
      'sibling',
      s.workspace_id,
    );
    const other = {
      ...s,
      project_id: sibling.project_id,
      actions: { ...s.actions, [pageRule]: sibling.action_id },
    };
    const responses = await Promise.all([
      declare(s, 'cross-project'),
      declare(other, 'cross-project'),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(await eventCount(s)).toBe(1);
    const loser = responses[0]!.status === 409 ? s : other;
    const stored = await db
      .selectFrom('actions')
      .select('status')
      .where('id', '=', actionId(loser))
      .executeTakeFirstOrThrow();
    expect(stored.status).toBe('open');
    expect((await declare(loser, 'own-key')).status).toBe(201);
  });

  it('keeps a foreign visibility baseline unavailable and ignores foreign member rows', async () => {
    const s = await seed();
    const foreign = await seed();
    await db
      .updateTable('opportunity_snapshots')
      .set({ audit_id: foreign.audit_id })
      .where('project_id', '=', s.project_id)
      .execute();
    const result = await declarationBody(await declare(s, 'foreign-baseline', promptRule));
    expect(result.expected_checks[0]).not.toHaveProperty('baseline_metric_snapshot_id');
    await db
      .updateTable('actions')
      .set({ member_opportunity_ids: JSON.stringify([foreign.members[pageRule]]) })
      .where('id', '=', actionId(s))
      .execute();
    expect((await detailBody(await request(s, actionPath(s)))).members).toEqual([]);
    expect((await declare(s, 'foreign-members')).status).toBe(409);
  });

  it('accepts only a revision of this Action and derives in-progress from its output', async () => {
    const s = await seed();
    const draft = await actionFixture<string>(
      'revision',
      s.workspace_id,
      s.project_id,
      actionId(s),
    );
    expect((await detailBody(await request(s, actionPath(s)))).status).toBe('in_progress');
    expect(
      (await declare(s, 'foreign-output', otherRule, { output_revision_id: draft })).status,
    ).toBe(409);
    const result = await declare(s, 'draft', pageRule, { output_revision_id: draft });
    expect(result.status).toBe(201);
    expect((await declarationBody(result)).output_revision_id).toBe(draft);
  });

  it('freezes a prompt composite baseline and abstains when the prompt is not in its audit', async () => {
    const s = await seed();
    await db
      .updateTable('metric_snapshots')
      .set({
        visibility_score: 77,
        metrics: JSON.stringify({
          per_prompt: [{ prompt_index: 0, composite_score: 12, mention_stability: 1 }],
        }),
      })
      .where('id', '=', s.metric_snapshot_id)
      .execute();
    const result = await declarationBody(await declare(s, 'baseline', promptRule));
    expect(result.expected_checks).toHaveLength(1);
    expect(result.expected_checks[0]).toMatchObject({
      baseline_value: 12,
      baseline_metric_snapshot_id: s.metric_snapshot_id,
      target_prompt_id: s.prompt0_id,
    });
    // The check reads as the prompt's text and links to its history by id.
    expect(result.checks).toMatchObject([
      { kind: 'visibility_metric', subject: 'best crm for small teams', prompt_id: s.prompt0_id },
    ]);
    const missing = await seed();
    await db
      .deleteFrom('audit_prompt_snapshots')
      .where('audit_id', '=', missing.audit_id)
      .where('prompt_id', '=', missing.prompt0_id)
      .execute();
    const unobservable = await declarationBody(await declare(missing, 'missing', promptRule));
    expect(unobservable.expected_checks[0]).not.toHaveProperty('baseline_value');
  });

  it('bounds the go-live time to the present and the verification window', async () => {
    const s = await seed();
    const at = (offset: number) => new Date(Date.now() + offset).toISOString();
    const future = await declare(s, 'future', pageRule, { declared_implemented_at: at(3_600_000) });
    expect(future.status).toBe(422);
    const stale = await declare(s, 'stale', pageRule, {
      declared_implemented_at: at(-40 * 86_400_000),
    });
    expect(stale.status).toBe(422);
    expect((await detailBody(await request(s, actionPath(s)))).declaration).toBeNull();
  });

  it('promises before declaration the reading each enabled rule freezes', async () => {
    const s = await seed();
    const other = await seed();
    const evidence = {
      site_url_id: randomUUID(),
      issues: [
        {
          issue_id: randomUUID(),
          rule_id: 'aeo.answer_first',
          severity: 'low',
          category: 'content',
          evidence: {},
        },
      ],
      content_handoff: { affected_prompts: [{ prompt_id: s.prompt0_id }] },
      keyword: 'crm for startups',
      normalized_keyword: 'crm for startups',
      query_key: 'crm for startups',
      search_volume: null,
      intent: null,
      market: { location_code: 2840, language_code: 'en' },
      owned_origin: 'https://acme.test',
      competitors: [],
      competitor_names: [],
      target_resolution: { state: 'no_covering_page', candidates: [] },
      provider: 'dataforseo',
      statement: 'Competitors rank for crm for startups.',
      // Content gaps: one angle of a content-angle run.
      run_id: randomUUID(),
      lineage_id: randomUUID(),
      angle_label: 'CRM pricing',
      topic_id: null,
      prompts: [{ id: s.prompt0_id, text: 'best crm for small teams' }],
      engines: ['chatgpt'],
      citation_count: 4,
      domain_count: 2,
      competitor_count: 1,
      member_count: 0,
      members: [],
      window: { start: new Date(Date.now() - 30 * 86_400_000).toISOString(), end: boundary },
      methodology_version: '1',
      formula_version: '1',
      limitations: [],
      url: 'https://acme.test/a',
      match_method: 'model_pick',
      planned_page_key: 'planned:crm-pricing',
    };
    const member = (rule_id: string, values: Partial<OpportunityRow> = {}): OpportunityRow => ({
      id: randomUUID(),
      project_id: s.project_id,
      rule_id,
      opportunity_type: 'site',
      severity: 'medium',
      priority_score: 1,
      title: rule_id,
      remediation: '',
      target_key: `fixture:${rule_id}`,
      target_prompt_id: s.prompt0_id,
      target_url: 'https://acme.test/a',
      target_theme: 'crm for startups',
      evidence,
      source_analysis_ids: [],
      source_issue_ids: [],
      source_metric_ids: [],
      source_traffic_ids: [],
      analyzer_version: '',
      rule_version: '',
      formula_version: '',
      action_id: null,
      superseded_by_id: null,
      created_text: '',
      updated_text: '',
      superseded_text: null,
      ...values,
    });
    const freeze = async (row: OpportunityRow, scope = s) =>
      declarationChecks(
        db,
        { workspaceId: scope.workspace_id, projectId: scope.project_id },
        [row],
        { auditId: s.audit_id, declaredAt: boundary, outputRevisionId: null },
      );
    // Contextual links freeze only selected suggestions; internal-links-routes declares one.
    const enabled = Object.values(policy.opportunity.opportunities.OPPORTUNITY_RULES_BY_ID).filter(
      (rule) => rule.enabled && rule.check_kind !== 'contextual_link',
    );
    const shown: Record<string, string | null> = {};
    const frozen: Record<string, string[]> = {};
    for (const rule of enabled) {
      const row = member(rule.rule_id);
      shown[rule.rule_id] = memberMeasurementLeg(row);
      frozen[rule.rule_id] = (await freeze(row)).map(({ check }) => CHECKS[check.kind].leg);
    }
    expect(Object.keys(shown).length).toBeGreaterThan(20);
    for (const rule of enabled)
      expect([rule.rule_id, frozen[rule.rule_id]]).toEqual([
        rule.rule_id,
        shown[rule.rule_id] === null ? [] : [shown[rule.rule_id]],
      ]);
    expect([shown.search_keyword_gap, shown.brand_absent_high_value_prompt]).toEqual([
      'next_search_console_window',
      'next_visibility_run',
    ]);
    // A member nothing can isolate promises no reading and freezes none.
    const unscoped = member('brand_absent_high_value_prompt', {
      target_prompt_id: null,
      evidence: {},
    });
    expect([memberMeasurementLeg(unscoped), await freeze(unscoped)]).toEqual([null, []]);
    // A site change is no rule a crawl evaluates, so nothing can verify it (BE-801).
    const change = member('site_change_critical_regression');
    expect([memberMeasurementLeg(change), await freeze(change)]).toEqual([null, []]);
    // A page finding naming no Site Health rule freezes no check.
    const ruleless = member('missing_structured_data', {
      evidence: { site_url_id: evidence.site_url_id },
    });
    expect([memberMeasurementLeg(ruleless), await freeze(ruleless)]).toEqual([null, []]);
    // A page finding folding two rules verifies each of them (BE-802, SH-B2).
    const folded = member('content_structure_incomplete', {
      evidence: {
        ...evidence,
        issues: ['aeo.question_headings', 'aeo.answer_first'].map((rule_id) => ({
          issue_id: randomUUID(),
          rule_id,
          severity: 'low',
          category: 'content',
          evidence: {},
        })),
      },
    });
    expect((await freeze(folded)).map(({ check }) => check)).toEqual([
      {
        kind: 'site_rule',
        rule_id: 'aeo.answer_first',
        expected_outcome: 'pass',
        target_site_url_id: evidence.site_url_id,
      },
      {
        kind: 'site_rule',
        rule_id: 'aeo.question_headings',
        expected_outcome: 'pass',
        target_site_url_id: evidence.site_url_id,
      },
    ]);
    // The baseline comes from this project's audit, never another workspace's.
    await db
      .updateTable('metric_snapshots')
      .set({ metrics: JSON.stringify({ per_prompt: [{ prompt_index: 0, composite_score: 12 }] }) })
      .where('id', '=', s.metric_snapshot_id)
      .execute();
    const [own] = await freeze(member('brand_absent_high_value_prompt'));
    expect(own?.check).toMatchObject({
      baseline_metric_snapshot_id: s.metric_snapshot_id,
      baseline_value: 12,
    });
    const [foreign] = await freeze(member('brand_absent_high_value_prompt'), other);
    expect(foreign?.check).not.toHaveProperty('baseline_metric_snapshot_id');
  });

  it('records work no reading can isolate without inventing a check', async () => {
    const s = await seed();
    await db
      .updateTable('opportunities')
      .set({ opportunity_type: 'commerce', rule_id: 'catalog_fields_missing' })
      .where('id', '=', s.members[pageRule]!)
      .execute();
    const before = await detailBody(await request(s, actionPath(s)));
    expect(before.member_measurement[s.members[pageRule]!]).toBeNull();
    const body = await declarationBody(await declare(s, 'unmeasured'));
    expect(body.expected_checks).toEqual([]);
    expect(body.checks).toEqual([]);
    expect(body.member_opportunity_ids).toEqual([s.members[pageRule]]);
    expect((await detailBody(await request(s, actionPath(s)))).status).toBe('implemented');
  });

  it('declares an earned listing on the publisher page and measures the prompts that cited it', async () => {
    const s = await seed();
    const earned = await actionFixture<{ action_id: string; prompt_id: string }>(
      'earned',
      s.workspace_id,
      s.project_id,
    );
    s.actions.earned = earned.action_id;
    const result = await declare(s, 'earned', 'earned');
    expect(result.status).toBe(201);
    const body = await declarationBody(result);
    expect(body.target_site_url_ids).toEqual([]);
    expect(body.target_external_url).toBe('https://review.example/best-tools');
    expect(body.expected_checks).toEqual([
      {
        kind: 'visibility_metric',
        metric: 'prompt_score',
        direction: 'increase',
        min_delta: 1,
        tolerance: 0,
        target_prompt_id: earned.prompt_id,
      },
    ]);
    expect(body.legs).toMatchObject([{ leg: 'next_visibility_run' }]);
    // A prompt this project no longer tracks names nothing, never a bare id.
    expect(body.checks).toMatchObject([{ subject: null, prompt_id: null }]);
    expect((await declare(s, 'earned', 'earned')).status).toBe(200);
    // The existing schema prevents a declaration claiming both target kinds.
    await expect(
      db
        .updateTable('opportunity_implementation_events')
        .set({ target_site_url_ids: JSON.stringify([randomUUID()]) })
        .where('id', '=', body.id)
        .execute(),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('uses the latest observation for status, retains history and projects observed legs without work', async () => {
    const s = await seed();
    const declaration = await declarationBody(await declare(s, 'observe'));
    for (const [index, kind] of ['verified', 'contradicted'].entries()) {
      const at = new Date(Date.UTC(2026, 8, 3 + index));
      await db
        .insertInto('opportunity_verification_events')
        .values({
          id: randomUUID(),
          workspace_id: s.workspace_id,
          project_id: s.project_id,
          implementation_event_id: declaration.id,
          observation_kind: kind,
          observed_at: at,
          created_at: at,
          crawl_id: s.crawl_id,
          audit_id: null,
          source_analysis_ids: '[]',
          source_rule_evaluation_ids: '[]',
          source_metric_ids: '[]',
          result: JSON.stringify({ causality_notice: 'Observation is not causation.' }),
          verifier_version: 'implementation-verifier-1',
          limitations: '[]',
          idempotency_key: randomUUID(),
        })
        .execute();
      // The verifier refreshes the Action in the transaction that appends its observation.
      await refreshActionStatus(db, s.workspace_id, actionId(s));
      const detail = await detailBody(await request(s, actionPath(s)));
      expect(detail.status).toBe(index === 0 ? 'done' : 'measuring');
      expect(detail.declaration!.state).toBe(kind);
      expect(detail.declaration!.verification_events).toHaveLength(index + 1);
      expect(detail.declaration!.legs[0]).toMatchObject({
        state: 'observed',
        source_id: s.crawl_id,
      });
    }
    expect(await eventCount(s)).toBe(1);
  });
});

describe('Declaration ordering', () => {
  /** An Opportunity snapshot of the seed's project committed at `at`. */
  async function snapshotAt(s: ActionSeed, at: Date, values = {}) {
    const row = snapshotRow(
      { workspace_id: s.workspace_id, project_id: s.project_id },
      { created_at: at, ...values },
    );
    await db.insertInto('opportunity_snapshots').values(row).execute();
    return row.id;
  }
  /** A refresh that found none of the project's findings: Action sync clears every Action. */
  async function resolveAll(s: ActionSeed, at: Date) {
    const snapshot = await snapshotAt(s, at);
    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('opportunities')
        .set({ superseded_at: at })
        .where('workspace_id', '=', s.workspace_id)
        .where('project_id', '=', s.project_id)
        .execute();
      await syncActions(
        trx,
        { workspaceId: s.workspace_id, projectId: s.project_id },
        [],
        snapshot,
      );
    });
    return snapshot;
  }
  const verifications = async (s: ActionSeed) =>
    (
      await db
        .selectFrom('analytics_tasks')
        .select(sql<number>`count(*)::int`.as('n'))
        .where('workspace_id', '=', s.workspace_id)
        .where('task_kind', '=', 'opportunity_verification')
        .executeTakeFirstOrThrow()
    ).n;
  const seedSnapshot = async (s: ActionSeed) =>
    (
      await db
        .selectFrom('opportunity_snapshots')
        .select('id')
        .where('workspace_id', '=', s.workspace_id)
        .where('project_id', '=', s.project_id)
        .orderBy('created_at')
        .limit(1)
        .executeTakeFirstOrThrow()
    ).id;

  it('baselines on the newest snapshot at or before go-live, and on none when none existed', async () => {
    const s = await seed();
    const before = await snapshotAt(s, new Date(Date.parse(boundary) - 3_600_000));
    // A refresh after go-live is not what the change was declared against.
    await snapshotAt(s, new Date());
    const body = await declarationBody(await declare(s, 'ordered'));
    expect(body.opportunity_snapshot_id).toBe(before);
    expect(body.resolved_before_snapshot_id).toBeNull();

    const late = await seed();
    await db
      .updateTable('opportunity_snapshots')
      .set({ created_at: new Date() })
      .where('workspace_id', '=', late.workspace_id)
      .execute();
    const created = await declare(late, 'no-baseline', promptRule);
    expect(created.status).toBe(201);
    const unavailable = await declarationBody(created);
    expect(unavailable.opportunity_snapshot_id).toBeNull();
    // With no baseline audit the prompt check keeps no baseline reading.
    expect(unavailable.expected_checks[0]).toMatchObject({ kind: 'visibility_metric' });
    expect(unavailable.expected_checks[0]).not.toHaveProperty('baseline_metric_snapshot_id');
    expect((await detailBody(await request(late, actionPath(late, promptRule)))).status).toBe(
      'implemented',
    );
  });

  it('declares the findings a recrawl after go-live resolved, measured by later readings', async () => {
    const s = await seed();
    await resolveAll(s, new Date());
    const cleared = await detailBody(await request(s, actionPath(s)));
    expect([cleared.member_count, cleared.declarable_member_count]).toEqual([0, 1]);
    const created = await declare(s, 'resolved-after');
    expect(created.status).toBe(201);
    const body = await declarationBody(created);
    expect(body.member_opportunity_ids).toEqual([s.members[pageRule]]);
    expect(body.opportunity_snapshot_id).toBe(await seedSnapshot(s));
    expect(body.resolved_before_snapshot_id).toBeNull();
    expect(body.expected_checks).toEqual([
      { kind: 'site_rule', rule_id: 'aeo.structured_data_present', expected_outcome: 'pass' },
    ]);
    // The crawl and audit after go-live are read for this declaration at once.
    expect(await verifications(s)).toBe(2);
  });

  it('declares a resolved link finding, whose suggestions left with it, without a link check', async () => {
    const s = await seed();
    await resolveAll(s, new Date());
    const page = await db
      .selectFrom('opportunities')
      .select(['opportunity_type', 'severity'])
      .where('workspace_id', '=', s.workspace_id)
      .where('id', '=', s.members[pageRule]!)
      .executeTakeFirstOrThrow();
    const row = opportunityRow(
      { workspace_id: s.workspace_id, project_id: s.project_id },
      {
        ...page,
        rule_id: 'site_contextual_links',
        target_key: 'fixture:resolved-link',
        superseded_at: new Date(),
      },
    );
    await db.insertInto('opportunities').values(row).execute();
    const link = row.id;
    await db
      .updateTable('actions')
      .set({ last_member_opportunity_ids: JSON.stringify([s.members[pageRule], link]) })
      .where('id', '=', actionId(s))
      .execute();
    const created = await declare(s, 'resolved-link');
    expect(created.status).toBe(201);
    const body = await declarationBody(created);
    expect(body.member_opportunity_ids).toEqual([s.members[pageRule], link]);
    expect(body.expected_checks).toEqual([
      { kind: 'site_rule', rule_id: 'aeo.structured_data_present', expected_outcome: 'pass' },
    ]);
  });

  it('records findings resolved before go-live without crediting the deployment', async () => {
    const s = await seed();
    const resolving = await resolveAll(s, new Date(Date.parse(boundary) - 3_600_000));
    const body = await declarationBody(await declare(s, 'resolved-before'));
    expect(body.member_opportunity_ids).toEqual([s.members[pageRule]]);
    expect(body.opportunity_snapshot_id).toBe(resolving);
    expect(body.resolved_before_snapshot_id).toBe(resolving);
    expect(body.expected_checks).toEqual([]);
    expect(await verifications(s)).toBe(0);
    expect((await detailBody(await request(s, actionPath(s)))).status).toBe('implemented');
  });

  it('never declares another workspace’s Action or its findings', async () => {
    const s = await seed();
    const foreign = await seed();
    await resolveAll(s, new Date());
    expect(
      (
        await request(
          foreign,
          `${actionPath(s)}/declaration`,
          'POST',
          {
            declared_implemented_at: boundary,
          },
          'foreign',
        )
      ).status,
    ).toBe(404);
    // A last member set naming another workspace's finding declares nothing.
    await db
      .updateTable('actions')
      .set({ last_member_opportunity_ids: JSON.stringify([foreign.members[pageRule]]) })
      .where('id', '=', actionId(s))
      .execute();
    expect((await detailBody(await request(s, actionPath(s)))).declarable_member_count).toBe(1);
    expect((await declare(s, 'foreign-last')).status).toBe(409);
    expect(await eventCount(s)).toBe(0);
    expect(await eventCount(foreign)).toBe(0);
  });
});

it('waits for a Search Console window that starts after the declaration day', () => {
  const at = new Date('2026-09-01T15:00:00.123456Z');
  const before = { start: '2026-08-29', end: '2026-09-01' };
  expect(searchConsoleState(at, before, at).state).toBe('waiting');
  const due = searchConsoleState(at, null, at).due_at;
  expect(searchConsoleState(at, before, due).state).toBe('sync_needed');
  // The go-live day itself is partly before the change.
  expect(searchConsoleState(at, { start: '2026-09-01', end: '2026-09-04' }, at).state).toBe(
    'waiting',
  );
  expect(searchConsoleState(at, { start: '2026-09-02', end: '2026-09-04' }, at).state).toBe(
    'observed',
  );
});
