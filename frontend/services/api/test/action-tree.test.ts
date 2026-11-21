import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  actionsPageSchema,
  actionTreeSchema,
  actionUrlsPageSchema,
  urlActionsSchema,
} from '@citeladder/contracts/actions';

import { buildManifest } from '../src/agent/context.ts';
import { createApp } from '../src/app.ts';
import type { Database } from '../src/db/database.ts';
import { attachOrCreateAction } from '../src/opportunities/actions.ts';
import { writeActionUrls } from '../src/opportunities/action-urls.ts';
import { recomputeOpportunities } from '../src/opportunities/refresh.ts';
import { actionRow } from './opportunity-fixtures.ts';
import { SiteFixtures, type SiteSeed } from './site-health-fixtures.ts';
import { TEST_SESSION_COOKIE, sessionToken, testConfig, testDatabase } from './support.ts';

const config = testConfig();
const db = testDatabase(config);
const app = createApp(config, db);
const seeds: SiteSeed[] = [];

type Rule = Readonly<{
  rule_id: string;
  finding_class: string;
  severity: string;
  dimension: string;
  category: string;
}>;
const DEFECT: Rule = {
  rule_id: 'web.mobile_viewport',
  finding_class: 'defect',
  severity: 'high',
  dimension: 'technical',
  category: 'content',
};
const ADVISORY: Rule = {
  rule_id: 'aeo.structured_data_present',
  finding_class: 'advisory',
  severity: 'medium',
  dimension: 'aeo',
  category: 'structured_data',
};
const DIAGNOSTIC: Rule = {
  rule_id: 'technical.hsts_present',
  finding_class: 'diagnostic',
  severity: 'low',
  dimension: 'technical',
  category: 'security',
};

const UNKNOWN_SITE_LEVEL: Rule = {
  rule_id: 'architecture.fixture_unknown',
  finding_class: 'defect',
  severity: 'high',
  dimension: 'technical',
  category: 'architecture',
};

async function failingPage(trx: Database, seed: SiteSeed, path: string, rules: readonly Rule[]) {
  const fixtures = new SiteFixtures(trx);
  const at = new Date(Date.now() - 3_600_000);
  const page = await fixtures.page(seed, path, { has_html: true }, { fetchedAt: at });
  const evaluations = rules.map((rule) => ({ id: randomUUID(), rule }));
  for (const { id, rule } of evaluations) {
    const shared = {
      workspace_id: seed.workspaceId,
      rule_id: rule.rule_id,
      dimension: rule.dimension,
      category: rule.category,
      severity: rule.severity,
      finding_class: rule.finding_class,
      evidence: '{}',
      analyzer_version: 'v1',
      rule_version: 'v1',
      created_at: at,
    };
    await trx // NOSONAR -- One transaction: fixture statements run in order.
      .insertInto('site_rule_evaluations')
      .values({
        ...shared,
        id,
        analysis_id: page.analysisId,
        source_artifact_id: page.artifactId,
        weight: 1,
        outcome: 'missing',
        extractor_version: '',
        scope: 'page',
        display_applicability: true,
        score_applicability: false,
        reason_code: '',
        readiness_dimension: '',
        readiness_weight: 0,
      })
      .execute();
    await trx // NOSONAR -- One transaction: fixture statements run in order.
      .insertInto('site_issues')
      .values({
        ...shared,
        id: randomUUID(),
        project_id: seed.projectId,
        crawl_id: seed.crawlId,
        site_url_id: page.id,
        analysis_id: page.analysisId,
        evaluation_id: id,
        source_artifact_id: page.artifactId,
        description: '',
        remediation: '',
        is_current: true,
      })
      .execute();
  }
  await trx
    .updateTable('site_page_analyses')
    .set({ source_evaluation_ids: evaluations.map((e) => e.id), finalized_at: at })
    .where('id', '=', page.analysisId)
    .execute();
  return { id: page.id, url: `https://example.test${path}` };
}

async function crawledProject() {
  return db.transaction().execute(async (trx) => {
    const seed = await new SiteFixtures(trx).crawl();
    seeds.push(seed);
    const pages = [];
    for (let index = 0; index < 12; index += 1) {
      const rules = [
        DEFECT,
        ...(index < 3 ? [ADVISORY] : []),
        ...(index < 2 ? [DIAGNOSTIC] : []),
        ...(index < 1 ? [UNKNOWN_SITE_LEVEL] : []),
      ];
      // NOSONAR -- One transaction: fixture statements run in order.
      pages.push(await failingPage(trx, seed, `/p${String(index).padStart(2, '0')}`, rules));
    }
    return { seed, pages };
  });
}

const scopeOf = (seed: SiteSeed) => ({ workspaceId: seed.workspaceId, projectId: seed.projectId });

async function request(seed: SiteSeed, path: string) {
  const cookie = `${TEST_SESSION_COOKIE}=${await sessionToken({ sub: seed.userId, ver: 0 })}`;
  return app.request(path, { headers: { cookie, 'x-workspace-id': seed.workspaceId } });
}

async function issueActions(seed: SiteSeed) {
  return db
    .selectFrom('actions')
    .select(['id', 'target_label', 'goal', 'goal_grouping', 'priority_score'])
    .where('workspace_id', '=', seed.workspaceId)
    .where('project_id', '=', seed.projectId)
    .where('target_kind', '=', 'issue_family')
    .orderBy('target_label')
    .execute();
}

async function urlsOf(actionId: string) {
  const rows = await db
    .selectFrom('action_urls')
    .select('site_url_id')
    .where('action_id', '=', actionId)
    .execute();
  return rows.map((row) => row.site_url_id).sort();
}

let own: Awaited<ReturnType<typeof crawledProject>>;
let foreign: Awaited<ReturnType<typeof crawledProject>>;

beforeAll(async () => {
  [own, foreign] = await Promise.all([crawledProject(), crawledProject()]);
  await recomputeOpportunities(db, scopeOf(own.seed));
});

afterAll(async () => {
  for (const seed of seeds) {
    await db.deleteFrom('workspaces').where('id', '=', seed.workspaceId).execute();
    await db.deleteFrom('users').where('id', '=', seed.userId).execute();
  }
  await db.destroy();
});

describe('issue-group Actions', () => {
  it('files one Action per defect and advisory group, never a diagnostic or unknown site-level rule, with its URLs', async () => {
    const actions = await issueActions(own.seed);
    expect(
      actions.map((row) => [row.target_label, row.goal, row.goal_grouping, row.priority_score]),
    ).toEqual([
      ['Missing structured data', 'read_site', 'aeo', 20],
      ['Mobile viewport missing', 'read_site', 'content', 30.3],
    ]);
    const ids = (pages: { id: string }[]) => pages.map((page) => page.id).sort();
    expect([await urlsOf(actions[0]!.id), await urlsOf(actions[1]!.id)]).toEqual([
      ids(own.pages.slice(0, 3)),
      ids(own.pages),
    ]);
    const path = `/api/v1/projects/${own.seed.projectId}/actions/tree?group_by=topic`;
    const byTopic = actionTreeSchema.parse(await (await request(own.seed, path)).json());
    expect(byTopic.groups.map((group) => [group.key, group.count])).toEqual([['', 2]]);
  });

  it('lists every Action touching a URL, and never another workspace’s URL', async () => {
    const [page] = own.pages;
    const agentPage = await db
      .transaction()
      .execute((trx) =>
        attachOrCreateAction(trx, scopeOf(own.seed), 'page', page!.url, own.seed.userId),
      );
    const path = `/api/v1/projects/${own.seed.projectId}/urls/${page!.id}/actions`;
    const read = urlActionsSchema.parse(await (await request(own.seed, path)).json());
    const labels = Object.fromEntries((await issueActions(own.seed)).map((a) => [a.id, a]));
    expect(
      read.items.map((item) => [
        labels[item.id]?.target_label ?? item.id,
        item.summary,
        item.finding_class,
      ]),
    ).toEqual([
      ['Mobile viewport missing', 'Add a responsive viewport meta declaration.', 'defect'],
      [
        'Missing structured data',
        'Add schema.org structured data (JSON-LD preferred).',
        'advisory',
      ],
      [agentPage.id, null, null],
    ]);
    expect(read.page_kind).toBe('product');
    expect(Date.parse(read.last_crawled_at)).toBeGreaterThan(Date.parse('2026-01-01'));
    expect((await request(foreign.seed, path)).status).toBe(404);
    const theirs = `/api/v1/projects/${foreign.seed.projectId}/urls/${page!.id}/actions`;
    expect((await request(foreign.seed, theirs)).status).toBe(404);
  });

  it('pages an issue group’s URLs ten at a time, only in its own workspace', async () => {
    const [, defect] = await issueActions(own.seed);
    const path = `/api/v1/actions/${defect!.id}/urls`;
    const first = actionUrlsPageSchema.parse(await (await request(own.seed, path)).json());
    const second = actionUrlsPageSchema.parse(
      await (await request(own.seed, `${path}?cursor=${first.next_cursor}`)).json(),
    );
    expect([first.total, [...first.items, ...second.items].map((url) => url.url)]).toEqual([
      12,
      own.pages.map((page) => page.url),
    ]);
    expect(second.next_cursor).toBeNull();
    expect(first.items.map((url) => [url.page_kind, url.open_action_count])).toEqual([
      ['product', 3],
      ['product', 2],
      ['product', 2],
      ...Array.from({ length: 7 }, () => ['product', 1]),
    ]);
    expect((await request(foreign.seed, path)).status).toBe(404);
  });

  it('resyncs an Action by writing only the URL pairs that changed, never a foreign URL', async () => {
    const [advisory] = await issueActions(own.seed);
    const [p0, p1, , p3] = own.pages.map((page) => page.id);
    const rolledBack = new Error('roll back');
    let rows: { site_url_id: string; rewritten: boolean }[] = [];
    await db
      .transaction()
      .execute(async (trx) => {
        const pages = [p0!, p1!, p3!, foreign.pages[0]!.id].map((site_url_id) => ({ site_url_id }));
        await writeActionUrls(trx, scopeOf(own.seed), [
          {
            actionId: advisory!.id,
            kind: 'issue_family',
            url: null,
            cohort: { whole_site: false, pages },
          },
        ]);
        rows = (
          await sql<{ site_url_id: string; rewritten: boolean }>`
            select site_url_id, xmin = pg_current_xact_id()::xid as rewritten
            from action_urls where action_id = ${advisory!.id}`.execute(trx)
        ).rows;
        throw rolledBack;
      })
      .catch((error: unknown) => {
        if (error !== rolledBack) throw error;
      });
    const sorted = [
      { site_url_id: p0!, rewritten: false },
      { site_url_id: p1!, rewritten: false },
      { site_url_id: p3!, rewritten: true },
    ].sort((a, b) => a.site_url_id.localeCompare(b.site_url_id));
    expect(rows.sort((a, b) => a.site_url_id.localeCompare(b.site_url_id))).toEqual(sorted);
  });
});

describe('Agent hand-off scopes', () => {
  const manifest = (seed: SiteSeed, refs: Record<string, unknown>, actionId: string | null) =>
    buildManifest(
      db,
      { ...scopeOf(seed), userId: seed.userId },
      { refs: refs as Record<string, never>, request: '', actionId, mentionIds: [] },
      () =>
        Promise.resolve({
          version: 'test',
          brand_block: '',
          target_page_block: '',
          issue_block: '',
          related_site_block: '',
          sections: {},
          summary: {},
        }),
    );

  it('gives ticked URLs of an Action and every Action on one URL, never a URL beyond them', async () => {
    const [advisory, defect] = await issueActions(own.seed);
    const ticked = await manifest(
      own.seed,
      { action_url_ids: [own.pages[1]!.id, own.pages[0]!.id] },
      defect!.id,
    );
    expect(ticked.action?.selected_urls).toEqual([own.pages[0]!.url, own.pages[1]!.url]);
    await expect(
      manifest(own.seed, { action_url_ids: [own.pages[4]!.id] }, advisory!.id),
    ).rejects.toMatchObject({ code: 'agent_context_unavailable' });

    const one = await manifest(
      own.seed,
      { url_actions_reference: { site_url_id: own.pages[5]!.id } },
      null,
    );
    expect(one.package.sections.url_actions).toMatchObject({
      url: own.pages[5]!.url,
      action_count: 1,
      actions: [{ id: defect!.id, goal: 'read_site', grouping: 'content' }],
    });
    await expect(
      manifest(foreign.seed, { url_actions_reference: { site_url_id: own.pages[5]!.id } }, null),
    ).rejects.toMatchObject({ code: 'agent_context_unavailable' });
  });
});

describe('the Actions tree', () => {
  async function treeProject() {
    const seed = await new SiteFixtures(db).crawl();
    seeds.push(seed);
    const scope = { workspace_id: seed.workspaceId, project_id: seed.projectId };
    const row = (index: number, values: Parameters<typeof actionRow>[1]) =>
      actionRow(scope, {
        ...values,
        id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      });
    const cohort = (rule: string) =>
      JSON.stringify({
        rule_id: rule,
        rule_label: rule,
        finding_class: 'defect',
        crawl_id: 'c',
        group_id: 'g',
        page_count: 0,
        whole_site: false,
        pages: [],
      });
    const prompts = Array.from({ length: 23 }, (_, index) =>
      row(index, {
        group_key: `prompt:${index}`,
        target_kind: 'prompt',
        target_label: `Prompt ${index}`,
        priority_score: 100 - index,
        goal: 'own_pages',
        goal_grouping: 'prompts',
      }),
    );
    await db
      .insertInto('actions')
      .values([
        ...prompts,
        row(30, {
          group_key: 'issue-family:a',
          target_kind: 'issue_family',
          target_label: 'Critical',
          priority_score: 40.4,
          goal: 'read_site',
          goal_grouping: 'seo',
          cohort: cohort('a'),
        }),
        row(31, {
          group_key: 'issue-family:b',
          target_kind: 'issue_family',
          target_label: 'Low',
          priority_score: 10,
          goal: 'read_site',
          goal_grouping: 'seo',
          cohort: cohort('b'),
        }),
        row(32, {
          group_key: 'issue-family:c',
          target_kind: 'issue_family',
          target_label: 'Declined',
          priority_score: 20,
          goal: 'read_site',
          goal_grouping: 'aeo',
          status: 'dismissed',
          cohort: cohort('c'),
        }),
        row(33, {
          group_key: 'page:old',
          target_kind: 'page',
          target_label: 'Not yet synced',
          priority_score: 5,
        }),
      ])
      .execute();
    return { seed, prompts };
  }

  it('returns the literal counts and first ten rows, and the grouping page rows 11–20', async () => {
    const { seed, prompts } = await treeProject();
    const base = `/api/v1/projects/${seed.projectId}/actions`;
    const tree = actionTreeSchema.parse(await (await request(seed, `${base}/tree`)).json());
    const shape = tree.groups.map((group) => [
      group.key,
      group.count,
      group.groupings.map((g) => [g.grouping, g.count, g.items.map((item) => item.target_label)]),
    ]);
    expect([tree.status_counts, tree.goals, shape]).toEqual([
      { open: 26, in_progress: 0, done: 0, dismissed: 1 },
      [
        { goal: 'read_site', count: 2, blocking: true },
        { goal: 'own_pages', count: 24, blocking: false },
        { goal: 'mentions', count: 0, blocking: false },
        { goal: 'wrong_claims', count: 0, blocking: false },
      ],
      [
        ['read_site', 2, [['seo', 2, ['Critical', 'Low']]]],
        [
          'own_pages',
          24,
          [
            ['prompts', 23, prompts.slice(0, 10).map((p) => p.target_label)],
            ['improve_pages', 1, ['Not yet synced']],
          ],
        ],
      ],
    ]);
    const cursor = tree.groups[1]!.groupings[0]!.next_cursor;
    const next = actionsPageSchema.parse(
      await (await request(seed, `${base}?grouping=prompts&limit=10&cursor=${cursor}`)).json(),
    );
    expect(next.items.map((item) => item.target_label)).toEqual(
      prompts.slice(10, 20).map((p) => p.target_label),
    );

    const declined = actionTreeSchema.parse(
      await (await request(seed, `${base}/tree?status=dismissed`)).json(),
    );
    expect([
      declined.goals.map((goal) => goal.count),
      declined.groups.map((group) => [group.key, group.groupings.map((g) => g.grouping)]),
    ]).toEqual([[2, 24, 0, 0], [['read_site', ['aeo']]]]);

    const byImpact = actionTreeSchema.parse(
      await (await request(seed, `${base}/tree?group_by=impact`)).json(),
    );
    expect(byImpact.groups.map((group) => [group.key, group.count])).toEqual([
      ['high', 24],
      ['low', 2],
    ]);
    const byApproach = actionTreeSchema.parse(
      await (await request(seed, `${base}/tree?group_by=what_to_do`)).json(),
    );
    expect(byApproach.groups.map((group) => [group.key, group.count])).toEqual([['', 26]]);
    const more = byApproach.groups[0]!.groupings.find((g) => g.grouping === 'prompts')!;
    const morePage = actionsPageSchema.parse(
      await (
        await request(
          seed,
          `${base}?grouping=prompts&approach=&limit=10&cursor=${more.next_cursor}`,
        )
      ).json(),
    );
    expect(morePage.items.map((item) => item.target_label)).toEqual(
      prompts.slice(10, 20).map((p) => p.target_label),
    );
    const newOnly = actionTreeSchema.parse(
      await (await request(seed, `${base}/tree?status=open&group_by=what_to_do`)).json(),
    );
    const newMore = newOnly.groups[0]!.groupings.find((g) => g.grouping === 'prompts')!;
    const newPage = await request(
      seed,
      `${base}?approach=&status=open&grouping=prompts&cursor=${newMore.next_cursor}&limit=10`,
    );
    expect(
      actionsPageSchema.parse(await newPage.json()).items.map((item) => item.target_label),
    ).toEqual(prompts.slice(10, 20).map((p) => p.target_label));

    const products = actionTreeSchema.parse(
      await (await request(seed, `${base}/tree?topic=products`)).json(),
    );
    expect([products.goals.map((goal) => goal.count), products.groups]).toEqual([[0, 0, 0, 0], []]);
    expect((await request(seed, `${base}/tree?group_by=colour`)).status).toBe(422);
    expect((await request(own.seed, `${base}/tree`)).status).toBe(404);
  });
});
