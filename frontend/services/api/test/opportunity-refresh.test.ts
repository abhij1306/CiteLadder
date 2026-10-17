/**
 * Opportunity refresh and routes against real PostgreSQL. Native fixtures seed
 * evidence and the native enqueue owner admits execution.
 *
 * Covers detection and supersession, the queue, the project lock and the
 * Action handoffs.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.ts';
import { updateActionStatus, attachOrCreateAction } from '../src/opportunities/actions.ts';
import { loadWorkerSettings, policy } from '../src/config.ts';
import { record } from '../src/db/json.ts';
import { recomputeOpportunities, refreshOpportunities } from '../src/opportunities/refresh.ts';
import { enqueueOpportunityRefresh } from '../src/opportunities/enqueue.ts';
import { drainWorkspace } from './analytics-drain.ts';
import { seedOpportunityScenario, type OpportunitySeed } from './opportunity-fixtures.ts';
import { sourcePage } from './action-support.ts';
import { TEST_SESSION_COOKIE, sessionToken, testConfig, testDatabase } from './support.ts';

const config = testConfig();
const db = testDatabase(config);
const app = createApp(config, db);
const o = policy.opportunity.opportunities;
const URL_B = 'https://acme.test/b';

type Seed = OpportunitySeed;
const seeds: Seed[] = [];

async function seed(): Promise<Seed> {
  const created = await seedOpportunityScenario(db);
  await db.transaction().execute(async (trx) => {
    for (let replay = 0; replay < 2; replay++)
      await enqueueOpportunityRefresh(trx, {
        workspaceId: created.workspace_id,
        projectId: created.project_id,
        triggerKind: 'audit',
        triggerId: created.audit_id,
        maxAttempts: loadWorkerSettings({}).taskMaxAttempts,
      });
  });
  seeds.push(created);
  return created;
}

const scope = (s: Seed) => ({ workspaceId: s.workspace_id, projectId: s.project_id });

function live(s: Seed) {
  return db
    .selectFrom('opportunities')
    .selectAll()
    .where('workspace_id', '=', s.workspace_id)
    .where('superseded_at', 'is', null)
    .orderBy('priority_score', 'desc')
    .execute();
}

function byRule<T extends { rule_id: string }>(rows: T[], rule: string): T {
  const matches = rows.filter((row) => row.rule_id === rule);
  expect(matches).toHaveLength(1);
  return matches[0]!;
}

async function snapshotCount(s: Seed) {
  const { count } = await db
    .selectFrom('opportunity_snapshots')
    .select((eb) => eb.fn.countAll<string>().as('count'))
    .where('workspace_id', '=', s.workspace_id)
    .executeTakeFirstOrThrow();
  return Number(count);
}

async function request(
  s: Seed,
  path: string,
  options: { method?: string; body?: unknown; as?: Seed } = {},
) {
  const actor = options.as ?? s;
  const headers: Record<string, string> = {
    cookie: `${TEST_SESSION_COOKIE}=${await sessionToken({ sub: actor.user_id, ver: 0 })}`,
    'x-workspace-id': actor.workspace_id,
  };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  const response = await app.request(path, {
    method: options.method ?? 'GET',
    headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  return { status: response.status, response };
}

const drain = (s: Seed) => drainWorkspace(db, s.workspace_id, { owner: `pr7-${randomUUID()}` });

let own: Seed;
let foreign: Seed;

beforeAll(async () => {
  own = await seed();
  foreign = await seed();
  await drain(own);
  await drain(foreign);
});

afterAll(async () => {
  for (const s of seeds) {
    await db.deleteFrom('workspaces').where('id', '=', s.workspace_id).execute();
    await db.deleteFrom('users').where('id', '=', s.user_id).execute();
  }
  await db.destroy();
});

describe('opportunity_refresh', () => {
  it('preserves a frozen historical format identifier in the read response', async () => {
    const s = await seed();
    await drain(s);
    const row = (await live(s))[0]!;
    await db
      .updateTable('opportunities')
      .set({
        evidence: {
          ...record(row.evidence),
          content_handoff: { suggested_skill_id: 'retired_format' },
        },
      })
      .where('id', '=', row.id)
      .execute();
    const result = await request(s, `/api/v1/opportunities/${row.id}`);
    expect(result.status).toBe(200);
    expect(record(record(await result.response.json()).content_handoff).suggested_skill_id).toBe(
      'retired_format',
    );
  });
  it('claims the one native-enqueued task and persists exact provenance', async () => {
    const tasks = await db
      .selectFrom('analytics_tasks')
      .select(['status', 'attempt_count', 'error_code'])
      .where('workspace_id', '=', own.workspace_id)
      .where('task_kind', '=', 'opportunity_refresh')
      .execute();
    expect(tasks).toEqual([{ status: 'succeeded', attempt_count: 1, error_code: '' }]);

    const snapshot = await db
      .selectFrom('opportunity_snapshots')
      .selectAll()
      .where('workspace_id', '=', own.workspace_id)
      .executeTakeFirstOrThrow();
    expect(snapshot).toMatchObject({
      audit_id: own.audit_id,
      site_crawl_id: own.crawl_id,
      total_count: 4,
      source_analysis_ids: [own.analysis0_id],
      source_issue_ids: [own.issue_structured_id, own.issue_content_id].sort(),
      analyzer_version: o.ANALYZER_VERSION,
      formula_version: o.FORMULA_VERSION,
    });

    const rows = await live(own);
    expect(rows.map((row) => [row.rule_id, Number(row.priority_score)])).toEqual([
      ['brand_absent_high_value_prompt', 120],
      ['owned_page_not_cited', 80],
      ['missing_structured_data', 20],
      ['content_structure_incomplete', 10],
    ]);
    const absent = byRule(rows, 'brand_absent_high_value_prompt');
    expect(absent).toMatchObject({
      target_key: `prompt:${own.prompt0_id}`,
      target_prompt_id: own.prompt0_id,
      source_analysis_ids: [own.analysis0_id],
      source_metric_ids: [own.metric_snapshot_id],
      source_issue_ids: [],
      source_traffic_ids: null,
    });
    expect(byRule(rows, 'content_structure_incomplete')).toMatchObject({
      target_url: URL_B,
      source_issue_ids: [own.issue_content_id],
    });
    expect(rows.every((row) => row.action_id !== null)).toBe(true);
  });

  it('replays a claimed refresh as a no-op when the snapshot is current', async () => {
    const before = await live(own);
    const snapshots = await snapshotCount(own);
    const template = await db
      .selectFrom('analytics_tasks')
      .selectAll()
      .where('workspace_id', '=', own.workspace_id)
      .executeTakeFirstOrThrow();

    await refreshOpportunities(template, { db, checkCancelled: async () => {}, maxAttempts: 3 });

    expect(await snapshotCount(own)).toBe(snapshots);
    expect((await live(own)).map((row) => row.id)).toEqual(before.map((row) => row.id));
  });

  it('refreshes once a source page is read, although audit, crawl and demand are unchanged', async () => {
    const s = await seed();
    await recomputeOpportunities(db, scope(s), { skipIfCurrent: true });
    const before = await snapshotCount(s);
    await recomputeOpportunities(db, scope(s), { skipIfCurrent: true });
    expect(await snapshotCount(s)).toBe(before);
    const page = await sourcePage(
      db,
      { workspace_id: s.workspace_id, project_id: s.project_id },
      'https://publisher.test/list',
      true,
    );
    await db
      .insertInto('source_page_snapshots')
      .values({
        workspace_id: s.workspace_id,
        project_id: s.project_id,
        id: randomUUID(),
        source_page_id: page.id,
        requested_url: 'https://publisher.test/list',
        final_url: 'https://publisher.test/list',
        outcome: 'inspected',
        body_bytes: 0,
        extracted_chars: 5000,
        fetched_at: new Date(),
        created_at: new Date(),
      })
      .execute();
    await recomputeOpportunities(db, scope(s), { skipIfCurrent: true });
    expect(await snapshotCount(s)).toBe(before + 1);
  });

  it('lets exactly one of two concurrent workers claim a queued refresh', async () => {
    const snapshots = await snapshotCount(own);
    const template = await db
      .selectFrom('analytics_tasks')
      .selectAll()
      .where('workspace_id', '=', own.workspace_id)
      .executeTakeFirstOrThrow();
    const { id } = await db
      .insertInto('analytics_tasks')
      .values({
        ...template,
        id: randomUUID(),
        idempotency_key: `opportunity:manual:${randomUUID()}`,
        status: 'queued',
        attempt_count: 0,
        lease_owner: null,
        lease_expires_at: null,
        heartbeat_at: null,
        completed_at: null,
        error_code: '',
        error_detail: '',
        payload: JSON.stringify(template.payload),
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    await Promise.all([drain(own), drain(own)]);

    const task = await db
      .selectFrom('analytics_tasks')
      .select(['status', 'attempt_count'])
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(task).toEqual({ status: 'succeeded', attempt_count: 1 });
    // Already current: the second trigger claims, finds nothing new, writes nothing.
    expect(await snapshotCount(own)).toBe(snapshots);
  });

  it('serializes concurrent recomputes under the project lock without duplicating live rows', async () => {
    const before = await live(own);
    const snapshots = await snapshotCount(own);

    await Promise.all([
      recomputeOpportunities(db, scope(own)),
      recomputeOpportunities(db, scope(own)),
    ]);

    const after = await live(own);
    expect(await snapshotCount(own)).toBe(snapshots + 2);
    expect(after.map((row) => row.rule_id)).toEqual(before.map((row) => row.rule_id));
    expect(after.map((row) => row.action_id)).toEqual(before.map((row) => row.action_id));
    const superseded = await db
      .selectFrom('opportunities')
      .select(['id', 'superseded_by_id'])
      .where(
        'id',
        'in',
        before.map((row) => row.id),
      )
      .execute();
    expect(superseded.every((row) => row.superseded_by_id !== null)).toBe(true);
  });

  it('supersedes without mutating, keeps Action identity and closes vanished rows', async () => {
    const s = await seed();
    await recomputeOpportunities(db, scope(s));
    const first = await live(s);
    const analysis = await db
      .selectFrom('response_analyses')
      .selectAll()
      .where('workspace_id', '=', s.workspace_id)
      .where('id', '=', s.analysis0_id)
      .executeTakeFirstOrThrow();
    await db
      .insertInto('citations')
      .values({
        id: randomUUID(),
        workspace_id: s.workspace_id,
        audit_id: analysis.audit_id,
        analysis_id: analysis.id,
        artifact_id: analysis.artifact_id,
        analyzer_version: 'b6-analysis-1',
        ordinal: 2,
        url: 'https://acme.com/crm',
        title: 'Acme CRM',
        domain: 'acme.com',
        classification: 'owned',
        is_owned: true,
        is_unintended: false,
        created_at: new Date(),
      })
      .execute();

    const snapshot = await recomputeOpportunities(db, scope(s));

    expect(snapshot.total_count).toBe(2);
    const second = await live(s);
    expect(second.map((row) => row.rule_id).sort()).toEqual([
      'content_structure_incomplete',
      'missing_structured_data',
    ]);
    const closed = new Map(
      (
        await db
          .selectFrom('opportunities')
          .select(['id', 'superseded_by_id', 'superseded_at'])
          .where(
            'id',
            'in',
            first.map((row) => row.id),
          )
          .execute()
      ).map((row) => [row.id, row]),
    );
    const firstContent = byRule(first, 'content_structure_incomplete');
    const secondContent = byRule(second, 'content_structure_incomplete');
    expect(secondContent.id).not.toBe(firstContent.id);
    expect(secondContent.action_id).toBe(firstContent.action_id);
    expect(byRule(second, 'missing_structured_data').evidence).toEqual(
      byRule(first, 'missing_structured_data').evidence,
    );
    expect(closed.get(firstContent.id)?.superseded_by_id).toBe(secondContent.id);
    const absent = closed.get(byRule(first, 'brand_absent_high_value_prompt').id);
    expect(absent?.superseded_at).not.toBeNull();
    expect(absent?.superseded_by_id).toBeNull();
    // Its prompt Action keeps its row with the evidence cleared.
    const cleared = await db
      .selectFrom('actions')
      .select(['member_opportunity_ids', 'priority_score', 'evidence_cleared_at'])
      .where('id', '=', byRule(first, 'brand_absent_high_value_prompt').action_id!)
      .executeTakeFirstOrThrow();
    expect(cleared.member_opportunity_ids).toEqual([]);
    expect(cleared.priority_score).toBeNull();
    expect(cleared.evidence_cleared_at).not.toBeNull();
  });

  it('keeps a dismissed status across a refresh', async () => {
    const s = await seed();
    await recomputeOpportunities(db, scope(s));
    const thin = byRule(await live(s), 'content_structure_incomplete');
    await updateActionStatus(db, s.workspace_id, thin.action_id!, 'dismissed', s.user_id);

    await recomputeOpportunities(db, scope(s));

    const action = await db
      .selectFrom('actions')
      .select(['status', 'member_opportunity_ids'])
      .where('id', '=', thin.action_id!)
      .executeTakeFirstOrThrow();
    expect(action.status).toBe('dismissed');
    expect(action.member_opportunity_ids).toEqual([
      byRule(await live(s), 'content_structure_incomplete').id,
    ]);
  });

  it('adopts an Agent-created page Action instead of opening a second one', async () => {
    const s = await seed();
    const agent = await db
      .transaction()
      .execute((trx) =>
        attachOrCreateAction(trx, scope(s), 'page', 'https://ACME.test/b', s.user_id),
      );

    await recomputeOpportunities(db, scope(s));

    const thin = byRule(await live(s), 'content_structure_incomplete');
    expect(thin.action_id).toBe(agent.id);
    const action = await db
      .selectFrom('actions')
      .select(['origin', 'target_url'])
      .where('id', '=', agent.id)
      .executeTakeFirstOrThrow();
    expect(action).toEqual({ origin: 'agent', target_url: URL_B });
  });
});

describe('Opportunity routes', () => {
  const base = (s: Seed) => `/api/v1/projects/${s.project_id}/opportunities`;

  it('lists and orders the persisted rows with a version', async () => {
    const rows = await live(own);
    const listed = await request(own, base(own));
    expect(listed.status).toBe(200);
    const page = (await listed.response.json()) as {
      items: { id: string; order_source: string }[];
    };
    expect(page.items.map((item) => item.id)).toEqual(rows.map((row) => row.id));

    const reversed = rows.map((row) => row.id).reverse();
    const body = { ordered_opportunity_ids: reversed, expected_version: 0 };
    const ordered = await request(own, `${base(own)}/order`, { method: 'PUT', body });
    expect(ordered.status).toBe(200);
    const relisted = (await (await request(own, base(own))).response.json()) as typeof page;
    expect(relisted.items.map((item) => [item.id, item.order_source])).toEqual(
      reversed.map((id) => [id, 'manual']),
    );
    const stale = await request(own, `${base(own)}/order`, { method: 'PUT', body });
    expect(stale.status).toBe(409);
    expect(((await stale.response.json()) as { error: { code: string } }).error.code).toBe(
      'opportunity_order_conflict',
    );
  });

  it('pages by keyset, filters, and rejects a foreign cursor or unknown token', async () => {
    const s = await seed();
    await recomputeOpportunities(db, scope(s));
    type Page = { items: { rule_id: string }[]; next_cursor: string | null };
    const read = async (query: string) => {
      const { status, response } = await request(s, `${base(s)}?${query}`);
      return { status, body: (await response.json()) as Page & { error: { code: string } } };
    };

    const first = await read('limit=3');
    const rest = await read(`limit=3&cursor=${first.body.next_cursor}`);
    expect([...first.body.items, ...rest.body.items].map((item) => item.rule_id)).toEqual([
      'brand_absent_high_value_prompt',
      'owned_page_not_cited',
      'missing_structured_data',
      'content_structure_incomplete',
    ]);
    expect(rest.body.next_cursor).toBeNull();
    expect(
      (await read('rule_id=content_structure_incomplete')).body.items.map((item) => item.rule_id),
    ).toEqual(['content_structure_incomplete']);
    expect((await read('min_priority=80')).body.items).toHaveLength(2);

    const replayed = await read(
      `limit=3&rule_id=content_structure_incomplete&cursor=${first.body.next_cursor}`,
    );
    expect([replayed.status, replayed.body.error.code]).toEqual([400, 'invalid_cursor']);
    const malformed = await read('cursor=not*a*cursor');
    expect([malformed.status, malformed.body.error.code]).toEqual([400, 'invalid_cursor']);
    for (const query of ['type=bogus', 'severity=bogus', 'status=bogus', 'min_priority=0x10'])
      expect([query, (await read(query)).status]).toEqual([query, 422]);

    const thin = byRule(await live(s), 'content_structure_incomplete');
    await updateActionStatus(db, s.workspace_id, thin.action_id!, 'dismissed', s.user_id);
    expect((await read('status=dismissed')).body.items.map((item) => item.rule_id)).toEqual([
      'content_structure_incomplete',
    ]);
  });

  it('serves an Opportunity detail with its exact source issues to the owner', async () => {
    const s = await seed();
    await recomputeOpportunities(db, scope(s));
    const row = byRule(await live(s), 'content_structure_incomplete');
    const { status, response } = await request(s, `/api/v1/opportunities/${row.id}`);
    expect(status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: row.id,
      source_issue_ids: [s.issue_content_id],
    });
  });

  it('is not found to a non-member', async () => {
    const response = await app.request(base(own));
    expect(response.status).toBe(404);
  });

  it('hides every route from a non-member', async () => {
    const [row] = await live(own);
    const paths: [string, string, unknown?][] = [
      ['GET', base(own)],
      ['GET', `/api/v1/opportunities/${row!.id}`],
      ['PUT', `${base(own)}/order`, { ordered_opportunity_ids: [], expected_version: 0 }],
    ];
    const snapshots = await snapshotCount(own);
    for (const [method, path, body] of paths) {
      const response = await request(own, path, { method, body, as: foreign });
      expect([method, path, response.status]).toEqual([method, path, 404]);
    }
    expect(await snapshotCount(own)).toBe(snapshots);
  });
});
