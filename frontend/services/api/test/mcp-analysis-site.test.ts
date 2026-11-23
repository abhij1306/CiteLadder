import { randomUUID } from 'node:crypto';
import { afterAll, expect, it } from 'vitest';
import { dispatchTool } from '../src/mcp/tools.ts';
import { attachOrCreateAction } from '../src/opportunities/actions.ts';
import { createTheme } from '../src/projects/themes.ts';
import { insertRobotsSnapshot } from '../src/site-health/robots-snapshots.ts';
import { SiteFixtures, type SiteSeed } from './site-health-fixtures.ts';
import { testDatabase } from './support.ts';

const db = testDatabase();
const fixtures = new SiteFixtures(db);
afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});

const origin = 'https://app.example.test';
const reader =
  (seed: SiteSeed) =>
  (name: string, args: Record<string, unknown> = {}) =>
    dispatchTool(
      db,
      {
        kind: 'member',
        userId: seed.userId,
        workspaceId: seed.workspaceId,
        projectId: seed.projectId,
      },
      name,
      { project_id: seed.projectId, ...args },
      origin,
    );

async function finalizedPage(seed: SiteSeed, path: string, current = true, siteUrlId?: string) {
  const page = await fixtures.page(seed, path, {}, { observed: true, current, siteUrlId });
  await db
    .updateTable('site_page_analyses')
    .set({ finalized_at: new Date(), source_evaluation_ids: [] })
    .where('id', '=', page.analysisId)
    .execute();
  return page;
}

it('reads what changed between crawls, as a summary and a list, only for its own project', async () => {
  const seed = await fixtures.crawl();
  const read = reader(seed);
  for (const view of ['changes', 'change_list'])
    expect(await read('read_site_health', { view })).toMatchObject({
      state: 'unavailable',
      reason: 'no_persisted_change_snapshot',
    });
  const page = await finalizedPage(seed, '/pricing');
  const snapshot = randomUUID();
  await db
    .insertInto('site_change_snapshots')
    .values({
      id: snapshot,
      workspace_id: seed.workspaceId,
      project_id: seed.projectId,
      crawl_a_id: null,
      crawl_b_id: seed.crawlId,
      state: 'available',
      reason_code: null,
      root_origin: seed.root,
      crawl_scope_hash: 'fixture',
      source_hash: 'fixture',
      source_analysis_ids: [],
      source_artifact_ids: [],
      analyzer_version: 'fixture',
      page_analyzer_version: 'fixture',
      extractor_version: 'fixture',
      complete_pair: true,
      coverage: JSON.stringify({ shared_pages: 1 }),
      summary: JSON.stringify({ total: 1, counts_by_class: { 'potential-regression': 1 } }),
      limitations: [],
      created_at: new Date(),
    })
    .execute();
  await db
    .insertInto('site_change_observations')
    .values({
      id: randomUUID(),
      workspace_id: seed.workspaceId,
      snapshot_id: snapshot,
      site_url_id: page.id,
      normalized_url: 'https://example.test/pricing?session=secret',
      field: 'title',
      change_class: 'potential-regression',
      before_value: JSON.stringify('Pricing'),
      after_value: JSON.stringify(''),
      expected: false,
      created_at: new Date(),
    })
    .execute();
  expect(await read('read_site_health', { view: 'changes' })).toMatchObject({
    state: 'available',
    snapshot_id: snapshot,
    summary: { total: 1, counts_by_class: { 'potential-regression': 1 } },
  });
  expect(await read('read_site_health', { view: 'change_list' })).toMatchObject({
    state: 'available',
    items: [{ site_url_id: page.id, url: 'https://example.test/pricing', field: 'title' }],
  });
  const other = await fixtures.otherProject(seed);
  expect(await reader(other)('read_site_health', { view: 'changes' })).toMatchObject({
    state: 'unavailable',
    reason: 'no_persisted_change_snapshot',
  });
});

it('reads AEO readiness and architecture apart from not measured, refusing another project’s snapshot', async () => {
  const seed = await fixtures.crawl();
  const read = reader(seed);
  const snapshot = await fixtures.snapshot(seed, 'complete');
  expect(await read('read_site_health', { view: 'aeo_readiness' })).toMatchObject({
    state: 'unavailable',
    reason: 'not_measured',
  });
  expect(await read('read_site_health', { view: 'architecture' })).toMatchObject({
    state: 'unavailable',
    reason: 'no_observed_architecture',
  });
  await db
    .updateTable('site_health_snapshots')
    .set({
      aeo_readiness_diagnostic: JSON.stringify({
        state: 'limited_evidence',
        crawl_id: seed.crawlId,
        score: 0,
        coverage: 0.5,
        profile_version: 'p',
        schema_contract_version: 's',
        scoring_version: 'v',
        presentation_version: 'r',
        analyzer_version: 'a',
        source_analysis_ids: [],
        analysis_count: 1,
        affected_page_count: 1,
        dimensions: [],
        limitations: [],
      }),
    })
    .where('id', '=', snapshot)
    .execute();
  expect(
    await read('read_site_health', { view: 'aeo_readiness', snapshot_id: snapshot }),
  ).toMatchObject({
    state: 'available',
    readiness_state: 'limited_evidence',
    score: 0,
    crawl_id: seed.crawlId,
  });
  const home = randomUUID();
  await db
    .insertInto('site_observed_architectures')
    .values({
      id: randomUUID(),
      workspace_id: seed.workspaceId,
      project_id: seed.projectId,
      crawl_id: seed.crawlId,
      source_snapshot_id: snapshot,
      coverage_state: 'complete',
      page_count: 1,
      hierarchy: JSON.stringify([
        {
          site_url_id: home,
          url: 'https://example.test/?ref=mail',
          title: '',
          page_kind: 'home',
          parent_site_url_id: null,
          parent_source: 'unknown',
          depth_from_home: 0,
        },
      ]),
      internal_linking: JSON.stringify({
        internal_link_count: 0,
        content_link_count: 0,
        pages_with_incoming_count: 0,
        pages_with_incoming_percentage: 0,
      }),
      page_kinds: '[]',
      structure_depth: JSON.stringify({
        measured_page_count: 1,
        unmeasured_page_count: 0,
        buckets: [],
      }),
      architecture_formula_version: 'fixture',
      archetype_policy_version: 'fixture',
      analyzer_version: 'fixture',
      extractor_version: 'fixture',
      rule_version: 'fixture',
      created_at: new Date(),
    })
    .execute();
  expect(await read('read_site_health', { view: 'architecture' })).toMatchObject({
    state: 'available',
    page_count: 1,
    nodes: [{ site_url_id: home, url: 'https://example.test/' }],
    pagination: { total_count: 1 },
  });
  const other = await fixtures.otherProject(seed);
  for (const view of ['aeo_readiness', 'architecture'])
    await expect(
      reader(other)('read_site_health', { view, snapshot_id: snapshot }),
    ).rejects.toThrow('Selected snapshot is unavailable');
});

it('reads robots.txt history newest first, apart from never observed', async () => {
  const seed = await fixtures.crawl();
  const read = reader(seed);
  expect(await read('read_ai_crawlability', { view: 'history' })).toEqual({
    state: 'unavailable',
    reason: 'robots_not_observed',
    artifact_refs: [],
  });
  await db.transaction().execute(async (trx) => {
    const snapshot = await insertRobotsSnapshot(
      trx,
      { workspace_id: seed.workspaceId, project_id: seed.projectId },
      'https://example.test',
      'User-agent: *\nAllow: /',
      200,
      524288,
    );
    await trx
      .updateTable('site_crawls')
      .set({
        robots_snapshot_id: snapshot.id,
        robots_observed_at: new Date(),
        site_facts: JSON.stringify({
          robots: {
            observed_at: new Date().toISOString(),
            catalog_version: '1',
            robots_snapshot_id: snapshot.id,
            fetched: true,
            status: 'fetched',
            status_code: 200,
            url: 'https://example.test/robots.txt?v=2',
            sitemaps: [],
            bots: [],
          },
        }),
      })
      .where('id', '=', seed.crawlId)
      .execute();
  });
  expect(await read('read_ai_crawlability', { view: 'history' })).toMatchObject({
    state: 'available',
    items: [{ crawl_id: seed.crawlId, robots: { url: 'https://example.test/robots.txt' } }],
  });
  const other = await fixtures.otherProject(seed);
  expect(await reader(other)('read_ai_crawlability', { view: 'history' })).toMatchObject({
    state: 'unavailable',
  });
});

it('reads one page’s resolved issue history, apart from a page still being analyzed', async () => {
  const seed = await fixtures.crawl();
  const read = reader(seed);
  const home = await finalizedPage(seed, '/');
  expect(
    await read('read_site_pages', { view: 'issue_history', site_url_id: home.id }),
  ).toMatchObject({ state: 'available', crawl_id: seed.crawlId, items: [] });
  const pending = await fixtures.page(seed, '/pending', {}, { observed: true });
  expect(
    await read('read_site_pages', { view: 'issue_history', site_url_id: pending.id }),
  ).toMatchObject({ state: 'unavailable', reason: 'analysis_not_finalized' });
  const other = await fixtures.otherProject(seed);
  await expect(
    reader(other)('read_site_pages', { view: 'issue_history', site_url_id: home.id }),
  ).rejects.toThrow();
  await expect(
    reader(other)('read_site_pages', {
      view: 'issue_history',
      site_url_id: home.id,
      crawl_id: seed.crawlId,
    }),
  ).rejects.toThrow('Crawl was not found in this project');
});

it('lists the Actions on one page and the grouped tree, refusing another project’s page', async () => {
  const seed = await fixtures.crawl();
  const read = reader(seed);
  const pricing = await finalizedPage(seed, '/pricing');
  const bare = await finalizedPage(seed, '/about');
  const action = await db
    .transaction()
    .execute((trx) =>
      attachOrCreateAction(
        trx,
        { workspaceId: seed.workspaceId, projectId: seed.projectId },
        'page',
        'https://example.test/pricing',
        seed.userId,
      ),
    );
  expect(await read('read_actions', { site_url_id: pricing.id })).toMatchObject({
    state: 'available',
    page: { site_url_id: pricing.id },
    items: [{ id: action.id, link: expect.stringContaining(`/actions/${action.id}`) }],
  });
  expect(await read('read_actions', { site_url_id: bare.id })).toMatchObject({
    state: 'available',
    items: [],
  });
  const tree = await read('read_actions', { group_by: 'goal' });
  expect(tree).toMatchObject({ state: 'available', group_by: 'goal' });
  expect(
    (tree.groups as { groupings: { items: { id: string }[] }[] }[]).flatMap((group) =>
      group.groupings.flatMap((grouping) => grouping.items.map((item) => item.id)),
    ),
  ).toEqual([action.id]);
  const other = await fixtures.otherProject(seed);
  await expect(reader(other)('read_actions', { site_url_id: pricing.id })).rejects.toThrow();
  expect(await reader(other)('read_actions', { group_by: 'goal' })).toMatchObject({ groups: [] });
});

it('returns the business map with review states, the themes and the standing instructions', async () => {
  const seed = await fixtures.crawl();
  const read = reader(seed);
  const empty = await read('get_project_business_context', { sections: ['visibility'] });
  expect(empty).not.toHaveProperty('themes');
  const bare = await read('get_project_business_context', { sections: ['profile'] });
  expect(bare).toMatchObject({
    profile: { state: 'unavailable', reason: 'no_brand_profile' },
    themes: [],
    agent_instructions: { revision: null, text: '' },
  });
  expect((bare.project as { report_pdf: string }).report_pdf).toBe(
    `${origin}/api/v1/projects/${seed.projectId}/overview/report.pdf?project=${seed.projectId}`,
  );
  const entry = { value: 'Waterproof', origin: 'model', review_state: 'suggested' };
  await fixtures.businessProfile(seed, {
    business_map: {
      offerings: [
        { offering: 'Boots', attributes: [entry], situations: [], audiences: [], exclusions: [] },
      ],
    },
  });
  await createTheme(
    db,
    { workspaceId: seed.workspaceId, projectId: seed.projectId },
    {
      name: 'Durability',
    },
  );
  await db
    .insertInto('agent_instruction_revisions')
    .values({
      id: randomUUID(),
      workspace_id: seed.workspaceId,
      project_id: seed.projectId,
      created_by_user_id: seed.userId,
      revision: 1,
      text: 'Answer in British English.',
      created_at: new Date(),
    })
    .execute();
  expect(await read('get_project_business_context', { sections: ['profile'] })).toMatchObject({
    profile: {
      business_map: { offerings: [{ offering: 'Boots', attributes: [entry] }] },
    },
    themes: [{ name: 'Durability' }],
    agent_instructions: { revision: 1, text: 'Answer in British English.' },
  });
  const other = await fixtures.otherProject(seed);
  expect(
    await reader(other)('get_project_business_context', { sections: ['profile'] }),
  ).toMatchObject({ themes: [], agent_instructions: { revision: null } });
});
