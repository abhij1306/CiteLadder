import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { readChat } from '../src/agent/reads.ts';
import type { TurnState } from '../src/agent/turn-budget.ts';
import { showView } from '../src/agent/views.ts';
import { AgentFixtures, scripted, text, toolUse } from './agent-support.ts';
import { topic } from './prompt-fixtures.ts';
import { SiteFixtures } from './site-health-fixtures.ts';
import { testDatabase } from './support.ts';

describe('show_view on PostgreSQL', () => {
  const db = testDatabase();
  const fixtures = new AgentFixtures(db);
  const sites = new SiteFixtures(db);
  afterAll(async () => {
    await fixtures.cleanup();
    await sites.cleanup();
    await db.destroy();
  });
  async function crawledScope() {
    const seed = await sites.crawl();
    const scope = { userId: seed.userId, workspaceId: seed.workspaceId, projectId: seed.projectId };
    fixtures.scopes.push(scope);
    return { scope, crawlId: seed.crawlId };
  }

  it('commits a placed view with the reply, once, and never on the request', async () => {
    const { scope, crawlId } = await crawledScope();
    const { run, lease } = await fixtures.claimed(scope, { message: 'Show me the site scores.' });
    const view = { kind: 'site_health_summary', crawl_id: crawlId };
    await fixtures
      .runtime(
        scope,
        scripted([
          [toolUse('show_view', view, 'call_a'), toolUse('show_view', view, 'call_b')],
          [text('Your scores are below.')],
        ]),
      )
      .execute(lease);
    const chat = await readChat(db, scope, run.chat_id);
    expect(chat.messages.map((message) => message.views)).toEqual([[], [view]]);
  });

  it('refuses another project’s record and reports an empty read as unavailable', async () => {
    const own = await crawledScope();
    const stranger = await crawledScope();
    const fresh = await fixtures.scope();
    const state: Pick<TurnState, 'views'> = { views: [] };
    expect(
      await showView(db, own.scope, state, {
        kind: 'site_health_summary',
        crawl_id: stranger.crawlId,
      }),
    ).toEqual({
      ok: false,
      text: 'crawl_id is not a crawl of this project. Omit it for the latest crawl.',
    });
    expect(
      await showView(db, fresh, state, {
        kind: 'keyword_research_rows',
        dataset_id: stranger.crawlId,
      }),
    ).toMatchObject({ ok: false, text: expect.stringMatching(/^dataset_id is not a published/u) });
    const unavailable = (reason: string) => ({
      ok: true,
      text: `unavailable: ${reason}. Nothing was placed; say the data is not available yet, never that it is zero or empty.`,
    });
    expect(await showView(db, fresh, state, { kind: 'site_health_summary' })).toEqual(
      unavailable('no_site_crawl'),
    );
    expect(await showView(db, fresh, state, { kind: 'visibility_trend', range: '30d' })).toEqual(
      unavailable('no_measured_runs'),
    );
    expect(await showView(db, fresh, state, { kind: 'ai_traffic_overview' })).toEqual(
      unavailable('no_ai_traffic'),
    );
    expect(state.views).toEqual([]);
    expect(await showView(db, own.scope, state, { kind: 'site_health_summary' })).toMatchObject({
      ok: true,
      text: expect.stringMatching(/^Placed/u),
    });
    expect(state.views).toEqual([{ kind: 'site_health_summary', crawl_id: null }]);
  });

  it('accepts only a market and topic of the chat’s own project', async () => {
    const own = await fixtures.scope();
    const stranger = await fixtures.scope();
    const market = async (scope: typeof own) => {
      const id = randomUUID();
      await db
        .insertInto('project_markets')
        .values({
          id,
          workspace_id: scope.workspaceId,
          project_id: scope.projectId,
          label: 'United Kingdom',
          country_code: 'GB',
          language_code: 'en',
          created_at: new Date(),
        })
        .execute();
      return id;
    };
    const [ownMarket, strangerMarket, ownTopic, strangerTopic] = await Promise.all([
      market(own),
      market(stranger),
      topic(db, own.projectId, 'Pricing'),
      topic(db, stranger.projectId, 'Pricing'),
    ]);
    const state: Pick<TurnState, 'views'> = { views: [] };
    const show = (market_id: string, topic_id: string) =>
      showView(db, own, state, { kind: 'visibility_ranking', market_id, topic_id });
    expect(
      [
        await show(strangerMarket, ownTopic),
        await show(ownMarket, strangerTopic),
        await show(ownMarket, ownTopic),
      ].map((outcome) => outcome.text),
    ).toEqual([
      'market_id is not a market of this project. Omit it for the project’s default market.',
      'topic_id is not a topic of this project. Omit it for every topic.',
      'unavailable: not_measured. Nothing was placed; say the data is not available yet, never that it is zero or empty.',
    ]);
  });

  it('corrects a selection the kind cannot take', async () => {
    const scope = await fixtures.scope();
    const state: Pick<TurnState, 'views'> = { views: [] };
    expect(
      (await showView(db, scope, state, { kind: 'ai_traffic_overview', range: 'all' })).text,
    ).toMatch(/^Invalid arguments: range: /u);
    expect((await showView(db, scope, state, { kind: 'keyword_research_rows' })).text).toMatch(
      /^Invalid arguments: dataset_id: /u,
    );
  });
});
