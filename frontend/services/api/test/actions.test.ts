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
import { actionFixture, type ActionSeed } from './action-support.ts';
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

  it('accepts only a shippable revision of this Action and derives in-progress from its output', async () => {
    const s = await seed();
    const outline = await actionFixture<string>(
      'revision',
      s.workspace_id,
      s.project_id,
      actionId(s),
      'outline',
    );
    expect((await detailBody(await request(s, actionPath(s)))).status).toBe('in_progress');
    expect((await declare(s, 'outline', pageRule, { output_revision_id: outline })).status).toBe(
      409,
    );
    const draft = await actionFixture<string>(
      'revision',
      s.workspace_id,
      s.project_id,
      actionId(s),
      'draft',
    );
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
