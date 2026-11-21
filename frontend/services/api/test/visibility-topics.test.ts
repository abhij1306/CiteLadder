import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { persistTopicMetrics } from '../src/analysis/run-metrics.ts';
import { scoringConfig } from '../src/analysis/scoring.ts';
import { createApp } from '../src/app.ts';
import { strings } from '../src/db/json.ts';
import { loadComparisonCells } from '../src/visibility/comparison.ts';
import { runSetComparisonStatus } from '../src/visibility/run-sets.ts';
import { finalizedRuns } from './finalized-runs.ts';
import { prompt, topic } from './prompt-fixtures.ts';
import { TEST_SESSION_COOKIE, sessionToken, testConfig, testDatabase } from './support.ts';
import { VisibilityFixtures, type Tenant } from './visibility-fixtures.ts';

const config = testConfig(),
  db = testDatabase(config),
  app = createApp(config, db),
  fixtures = new VisibilityFixtures(db),
  { tenant, finalizedRun, cleanup } = finalizedRuns(db, fixtures);
afterEach(cleanup);
afterAll(async () => {
  await db.destroy();
});

async function read(t: Tenant, projectId: string, path: string) {
  return get(t, `/api/v1/projects/${projectId}/visibility${path}`);
}

async function get(t: Tenant, url: string) {
  const response = await app.request(url, {
    headers: {
      cookie: `${TEST_SESSION_COOKIE}=${await sessionToken({ sub: t.userId, ver: 0 })}`,
    },
  });
  const json = (await response.json()) as Record<string, unknown> & {
    error?: { code?: string };
  };
  return { status: response.status, json };
}

async function refiledHistory() {
  const t = await tenant();
  const pricing = await topic(db, t.projectId, 'Pricing');
  const security = await topic(db, t.projectId, 'Security');
  const onboarding = await topic(db, t.projectId, 'Onboarding');
  await db.updateTable('prompts').set({ topic_id: pricing }).where('id', '=', t.promptId).execute();
  const trail = await prompt(db, t.setId, 'Which trail shoes grip mud?', { topicId: security });
  const first = await finalizedRun(t, ['https://review.example/a']);
  await db
    .updateTable('topics')
    .set({ name: 'Pricing & plans' })
    .where('id', '=', pricing)
    .execute();
  await db.updateTable('prompts').set({ topic_id: pricing }).where('id', '=', trail).execute();
  const second = await finalizedRun(t, ['https://review.example/a']);
  return { t, pricing, security, onboarding, first, second };
}

const measured = {
  visibility_rate: 1,
  share_of_voice: 1,
  rank: 1,
  ranked_brands: 1,
  win_count: 9,
  win_answers: 9,
  win_rate: 1,
};

describe('topic dimension', () => {
  it('groups answers by the frozen topic, so refiling and renaming never move a run', async () => {
    const { t, pricing, security, onboarding, first } = await refiledHistory();
    const range = await read(t, t.projectId, '/topics?selection_mode=range');
    expect(range.status).toBe(200);
    expect(range.json.items).toMatchObject([
      { kind: 'not_run', topic_id: onboarding, name: 'Onboarding', renamed_from: [] },
      {
        kind: 'measured',
        topic_id: pricing,
        name: 'Pricing & plans',
        renamed_from: ['Pricing'],
        answers: 9,
        ...measured,
      },
      { kind: 'measured', topic_id: security, name: 'Security', renamed_from: [], answers: 3 },
    ]);
    const latest = await read(t, t.projectId, '/topics');
    expect(latest.json.items).toMatchObject([
      { kind: 'not_run', topic_id: onboarding },
      { kind: 'measured', topic_id: pricing, renamed_from: [], answers: 6 },
      { kind: 'not_run', topic_id: security, renamed_from: [] },
    ]);
    const matrix = await read(t, t.projectId, `/matrix?selection_mode=run&audit_id=${first}`);
    expect(matrix.json.axes).toMatchObject({
      topic: [
        { topic_id: pricing, name: 'Pricing & plans', renamed_from: 'Pricing', answers: 3 },
        { topic_id: security, name: 'Security', renamed_from: null, answers: 3 },
        { topic_id: onboarding, answers: 0 },
      ],
    });
  });

  it('filters the dashboard, trend and Sources reads by the frozen topic', async () => {
    const { t, pricing, security, first, second } = await refiledHistory();
    const dashboard = await read(t, t.projectId, `?topic=${pricing}`);
    expect([dashboard.status, dashboard.json.total_completed]).toEqual([200, 6]);
    const unasked = await read(t, t.projectId, `?topic=${security}`);
    expect([unasked.status, unasked.json.error?.code]).toEqual([404, 'visibility_not_measured']);

    const trend = await read(t, t.projectId, `/trends?granularity=run&topic=${security}`);
    expect((trend.json as unknown as { audit_id: string }[]).map((p) => p.audit_id)).toEqual([
      first,
    ]);

    const runs = `audit_ids=${first}&audit_ids=${second}`;
    const responses = async (filter: string) =>
      (await read(t, t.projectId, `/sources?${runs}${filter}`)).json.responses;
    expect([
      await responses(''),
      await responses(`&topic=${pricing}`),
      await responses(`&topic=${security}`),
    ]).toEqual([12, 9, 3]);
    const evidence = async (topicId: string) => {
      const { json } = await read(t, t.projectId, `/evidence?${runs}&topic=${topicId}`);
      const body = json as unknown as { items: unknown[]; prompt_options: unknown[] };
      return [body.items.length, body.prompt_options.length];
    };
    expect([await evidence(pricing), await evidence(security)]).toEqual([
      [9, 2],
      [3, 1],
    ]);

    const audits = await db
      .selectFrom('audits')
      .select(['id', 'configuration'])
      .where('id', 'in', [first, second])
      .execute();
    const run = (id: string) => ({
      auditId: id,
      workspaceId: t.workspaceId,
      configuration: audits.find((audit) => audit.id === id)?.configuration,
    });
    const cellCounts = async (topicId: string | null) => {
      const cells = await loadComparisonCells(
        db,
        { current: run(second), previous: run(first) },
        { cohort: 'core', engine: null, topicId },
      );
      return [cells.get(second)?.size, cells.get(first)?.size];
    };
    expect([await cellCounts(null), await cellCounts(security)]).toEqual([
      [6, 6],
      [0, 3],
    ]);

    await db
      .updateTable('metric_snapshots')
      .set({ metrics: sql`jsonb_set(metrics, '{coverage,requested}', '7')` })
      .where('audit_id', '=', second)
      .execute();
    const status = (topicId: string | null) =>
      runSetComparisonStatus(
        db,
        { workspaceId: t.workspaceId, projectId: t.projectId, topicId },
        { currentIds: [second], baselineIds: [first], responses: 1, engine: null, cohort: 'core' },
      );
    expect([await status(null), await status(pricing), await status(security)]).toEqual([
      'partial_coverage',
      'comparable',
      'comparable',
    ]);

    const marketStates = async (topicId: string) =>
      (
        (await read(t, t.projectId, `/markets?topic=${topicId}`)).json as unknown as {
          markets: { state: string }[];
        }
      ).markets.map((row) => row.state);
    expect([await marketStates(pricing), await marketStates(security)]).toEqual([
      ['measured'],
      ['no_run'],
    ]);
  });

  it('keeps Commerce topics out of brand reads and reads a topic no run asked as not run', async () => {
    const t = await tenant();
    const pricing = await topic(db, t.projectId, 'Pricing');
    const grinders = await topic(db, t.projectId, 'Grinders');
    const bound = await prompt(db, t.setId, 'Which grinder is quietest?', {
      topicId: grinders,
      status: 'archived',
    });
    await db
      .insertInto('commerce_prompt_targets')
      .values({
        id: randomUUID(),
        workspace_id: t.workspaceId,
        project_id: t.projectId,
        prompt_id: bound,
        target_kind: 'product',
        target_id: randomUUID(),
        template_version: 'test',
        approved_at: null,
        created_at: new Date(),
      })
      .execute();
    const unrecorded = await finalizedRun(t, ['https://review.example/a']);
    const rows = async (path: string) =>
      ((await read(t, t.projectId, path)).json.items as { name: string; kind: string }[]).map(
        (row) => [row.name, row.kind],
      );
    expect(await rows('/topics')).toEqual([['Pricing', 'not_run']]);
    const topicList = (await get(t, `/api/v1/projects/${t.projectId}/topics`)).json;
    expect((topicList as unknown as { name: string }[]).map((row) => row.name)).toEqual([
      'Pricing',
    ]);
    const matrix = (await read(t, t.projectId, '/matrix')).json as unknown as {
      axes: { topic: { name: string }[] };
      grids: { topic_market: unknown[][] };
      rankings: { topic: unknown[]; engine: { kind: string }[] };
    };
    expect(matrix.axes.topic.map((item) => item.name)).toEqual(['Pricing']);
    expect([matrix.grids.topic_market, matrix.rankings.topic]).toEqual([
      [[{ kind: 'not_run' }]],
      [{ kind: 'not_run' }],
    ]);
    expect(matrix.rankings.engine.map((row) => row.kind)).toEqual(['measured']);
    expect(await rows('/topics?engine=gemini')).toEqual([['Pricing', 'not_run']]);
    const gemini = (await read(t, t.projectId, '/matrix?engine=gemini')).json as unknown as {
      grids: { topic_market: unknown[][] };
    };
    expect(gemini.grids.topic_market).toEqual([[{ kind: 'not_run' }]]);

    await db
      .updateTable('prompts')
      .set({ topic_id: pricing })
      .where('id', '=', t.promptId)
      .execute();
    await topic(db, t.projectId, 'Onboarding');
    const recorded = await finalizedRun(t, ['https://review.example/a']);
    expect(await rows('/topics')).toEqual([
      ['Onboarding', 'not_run'],
      ['Pricing', 'measured'],
    ]);
    expect(await rows('/topics?selection_mode=range')).toEqual([
      ['Onboarding', 'not_run'],
      ['Pricing', 'measured'],
    ]);

    const analyses = await db
      .selectFrom('response_analyses')
      .select('id')
      .where('audit_id', '=', recorded)
      .execute();
    const blocks = () =>
      db
        .selectFrom('audit_topic_metrics')
        .select(['audit_id', 'topic_id', 'source_analysis_ids'])
        .where('audit_id', 'in', [unrecorded, recorded])
        .execute();
    const stored = await blocks();
    expect(stored.map((block) => [block.audit_id, block.topic_id])).toEqual([[recorded, pricing]]);
    expect(analyses).toHaveLength(3);
    expect(strings(stored[0]?.source_analysis_ids).toSorted()).toEqual(
      analyses.map((row) => row.id).toSorted(),
    );

    const audit = await db
      .selectFrom('audits')
      .selectAll()
      .where('id', '=', recorded)
      .executeTakeFirstOrThrow();
    const input = {
      rows: [],
      tasks: [],
      config: scoringConfig(audit.configuration),
      engines: [],
      snapshots: await db
        .selectFrom('audit_prompt_snapshots')
        .selectAll()
        .where('audit_id', '=', recorded)
        .execute(),
      analyses: [],
      at: new Date(),
    };
    await db.deleteFrom('audit_topic_metrics').where('audit_id', '=', recorded).execute();
    await persistTopicMetrics(db, { ...audit, audit_scope: 'commerce' }, input);
    const afterCommerce = (await blocks()).length;
    await persistTopicMetrics(db, audit, input);
    expect([afterCommerce, (await blocks()).length]).toEqual([0, 1]);
  });

  it("reads only the reader's workspace, whatever topic it names", async () => {
    const { t, pricing } = await refiledHistory();
    const other = await tenant();
    const foreignTopic = await topic(db, other.projectId, 'Pricing');
    expect((await read(other, t.projectId, '/topics')).status).toBe(404);
    expect((await read(other, t.projectId, `/trends?topic=${pricing}`)).status).toBe(404);
    const trend = await read(t, t.projectId, `/trends?topic=${foreignTopic}`);
    expect([trend.status, trend.json]).toEqual([200, []]);
    expect((await read(t, t.projectId, `/trends?topic=${pricing}`)).json).toHaveLength(2);
  });
});
