import { createHash, randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, afterEach, expect, it, vi } from 'vitest';
import type { Actor } from '../src/auth/actor.ts';
import { changeKinds } from '../src/changes/kinds.ts';
import { kindCases, type KindScope, type TabledKind } from './change-kind-cases.ts';
import { SiteFixtures } from './site-health-fixtures.ts';
import { testConfig, testDatabase } from './support.ts';

const config = testConfig();
const db = testDatabase(config);
const fixtures = new SiteFixtures(db);
const table = kindCases(db, fixtures);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});

const owner = (scope: KindScope): Actor => ({
  kind: 'member',
  workspaceId: scope.workspaceId,
  userId: scope.userId,
  role: 'owner',
  scopes: 'all',
});

async function spending(scope: KindScope) {
  const holds = await db
    .selectFrom('consumable_ledger')
    .select(['capability_key', sql<string>`sum(units)::text`.as('units')])
    .where('workspace_id', '=', scope.workspaceId)
    .where('entry_kind', '=', 'reservation')
    .groupBy('capability_key')
    .orderBy('capability_key')
    .execute();
  const budgets = await db
    .selectFrom('usage_windows')
    .select(['operation', 'count'])
    .where('subject_hash', '=', createHash('sha256').update(scope.workspaceId).digest('hex'))
    .orderBy('operation')
    .execute();
  return {
    holds: Object.fromEntries(holds.map((row) => [row.capability_key, Number(row.units)])),
    budgets: Object.fromEntries(budgets.map((row) => [row.operation, row.count])),
  };
}

async function staged(kind: TabledKind) {
  const arranged = await table[kind].arrange();
  const { scope } = arranged;
  const context = { db, config, workspaceId: scope.workspaceId, projectId: scope.projectId };
  const before = await spending(scope);
  const stage = await changeKinds[kind].stage(
    context,
    owner(scope),
    { id: randomUUID(), projectId: scope.projectId },
    arranged.payload,
  );
  return { scope, before, previewed: await spending(scope), ...stage };
}

const UNDO = { label: 'Undo', value: 'This cannot be undone.' };

const DELETES: [TabledKind, string, { label: string; value: string }[]][] = [
  [
    'delete_topic',
    'Delete a topic',
    [
      { label: 'Topic', value: 'Trail' },
      { label: 'Prompts left without a topic', value: '1' },
      UNDO,
    ],
  ],
  [
    'confirm_topics',
    'Save the topic plan',
    [
      { label: 'Delete', value: 'Trail' },
      { label: 'Prompts left without a topic', value: '1' },
      UNDO,
    ],
  ],
  [
    'delete_prompt_set',
    'Delete a prompt set',
    [
      { label: 'Prompt set', value: 'Set' },
      { label: 'Prompts deleted', value: '1' },
      { label: 'Suggestions deleted', value: '0' },
      { label: 'Audit schedules deleted', value: '0' },
      UNDO,
    ],
  ],
  [
    'delete_prompts',
    'Delete 1 prompt',
    [
      { label: 'Prompt', value: 'Which running shoes suit road use?' },
      { label: 'Audits that asked them', value: '1, kept in history' },
      UNDO,
    ],
  ],
  [
    'remove_competitor',
    'Stop tracking a competitor',
    [{ label: 'Competitor', value: 'Rival' }, UNDO],
  ],
  [
    'remove_market',
    'Remove a market',
    [
      { label: 'Market', value: 'Brazil · Portuguese' },
      { label: 'Audit schedules that drop it', value: '0' },
      UNDO,
    ],
  ],
  [
    'delete_audit_schedule',
    'Delete an audit schedule',
    [
      { label: 'Prompt set', value: 'Set' },
      { label: 'Cadence', value: 'daily' },
      { label: 'Audits it ran', value: '0, kept' },
      UNDO,
    ],
  ],
  [
    'delete_objection_group',
    'Delete an objection group',
    [{ label: 'Group', value: 'Price' }, { label: 'Answers deleted', value: '0' }, UNDO],
  ],
  [
    'merge_objection_groups',
    'Merge objection groups',
    [
      { label: 'Merge', value: 'Price' },
      { label: 'Into', value: 'Fit' },
      { label: 'Answers moved', value: '0' },
      UNDO,
    ],
  ],
  [
    'merge_themes',
    'Merge themes',
    [
      { label: 'Merge', value: 'Comfort' },
      { label: 'Into', value: 'Fit' },
      { label: 'Probe answers moved', value: '0' },
      UNDO,
    ],
  ],
  [
    'delete_theme',
    'Delete a theme',
    [
      { label: 'Theme', value: 'Comfort' },
      { label: 'Probe answers left without a theme', value: '0' },
      UNDO,
    ],
  ],
];

it.each(DELETES)(
  '%s names what it deletes, what goes with it and that it cannot be undone',
  async (kind, title, rows) => {
    const { preview } = await staged(kind);
    expect({ title: preview.title, rows: preview.rows }).toEqual({ title, rows });
  },
);

type Spend = Awaited<ReturnType<typeof spending>>;
const nothing: Spend = { holds: {}, budgets: {} };

const METERED: [TabledKind, string, Spend | null][] = [
  ['generate_prompts', 'AI credits for up to 3 model calls', null],
  ['refresh_logos', "One of the day's logo refreshes", null],
  [
    'run_probe',
    '45 AI credits',
    { holds: { ai_credits: 45 }, budgets: { 'audit.provider_tasks': 9 } },
  ],
  ['set_probe_schedule', '45 AI credits each run', nothing],
  [
    'rerun_audit_failures',
    '3 prompt runs for 3 answers, with your own provider keys',
    { holds: { prompt_runs_per_period: 3 }, budgets: { 'audit.provider_tasks': 3 } },
  ],
  [
    'start_crawl',
    'Up to 5 page fetches from the Site Health allowance',
    {
      holds: { site_health_page_fetches_per_period: 5 },
      budgets: { 'site_health.crawl_create': 1 },
    },
  ],
  [
    'rerun_page',
    'Up to 1 page fetch from the Site Health allowance',
    { holds: { site_health_page_fetches_per_period: 1 }, budgets: {} },
  ],
  [
    'rerun_issue_group',
    'Up to 1 page fetch from the Site Health allowance',
    { holds: { site_health_page_fetches_per_period: 1 }, budgets: {} },
  ],
  [
    'start_link_analysis',
    "One of the day's internal-link analyses",
    { holds: {}, budgets: { 'internal_links.analysis': 1 } },
  ],
  ['analyze_page', 'Agent usage for the analysis, as for a chat message', nothing],
  ['confirm_keyword_run', '5 AI credits', { holds: { ai_credits: 5 }, budgets: {} }],
  ['generate_buyer_prompts', 'AI credits for up to 1 model call', null],
  [
    'discover_commerce_competitors',
    "1 competitor discovery from the day's allowance; no AI credits",
    { holds: {}, budgets: { 'commerce.competitor_discovery': 1 } },
  ],
  [
    'start_brand_discovery',
    "One of the day's brand discoveries; its research spends AI credits as it runs",
    { holds: {}, budgets: { 'brand_discovery.create': 1 } },
  ],
  [
    'rerun_brand_discovery',
    "One of the day's brand discoveries; its research spends AI credits as it runs",
    { holds: {}, budgets: { 'brand_discovery.create': 1 } },
  ],
  [
    'sync_performance',
    "1 on-demand sync from the workspace's sync allowance",
    { holds: {}, budgets: { 'integrations.sync.on_demand': 1 } },
  ],
  [
    'sync_integration',
    "1 on-demand sync from the workspace's sync allowance",
    { holds: {}, budgets: { 'integrations.sync.on_demand': 1 } },
  ],
];

it.each(METERED)(
  '%s shows its spend on the card and holds or spends nothing until the click',
  async (kind, spend, clicked) => {
    const { scope, before, previewed, preview, payload } = await staged(kind);
    expect(preview.spend).toBe(spend);
    expect(previewed).toEqual(before);
    if (!clicked) return;
    const change = { id: randomUUID(), projectId: scope.projectId };
    await db
      .transaction()
      .execute((trx) => changeKinds[kind].confirm(trx, config, owner(scope), change, payload));
    const after = await spending(scope);
    const added = (field: keyof Spend) =>
      Object.fromEntries(
        Object.entries(after[field]).flatMap(([key, value]) => {
          const grown = value - (before[field][key] ?? 0);
          return grown ? [[key, grown]] : [];
        }),
      );
    expect({ holds: added('holds'), budgets: added('budgets') }).toEqual(clicked);
  },
);

it('generate_buyer_prompts quotes the AI credits its model call can hold when the model is priced', async () => {
  vi.stubEnv('DEFAULT_AGENT_MODEL', 'claude-haiku-5-5');
  const { before, previewed, preview } = await staged('generate_buyer_prompts');
  expect(preview.spend).toBe('Up to 6 AI credits');
  expect(previewed).toEqual(before);
});

it('start_crawl says in plain words when the crawl ignores robots.txt, chosen or inherited', async () => {
  const { scope } = await table.start_crawl.arrange();
  const robots = async (payload: Record<string, unknown>) => {
    const { preview } = await changeKinds.start_crawl.stage(
      { db, config, workspaceId: scope.workspaceId, projectId: scope.projectId },
      owner(scope),
      { id: randomUUID(), projectId: scope.projectId },
      payload,
    );
    return preview.rows.find((row) => row.label === 'robots.txt')?.value;
  };
  expect(await robots({})).toBe('Followed');
  expect(await robots({ robots: 'ignore' })).toBe(
    'Ignored: the crawl also fetches pages robots.txt disallows. Your click records this as your decision.',
  );
  await db
    .updateTable('site_crawls')
    .set({
      configuration: sql`coalesce(configuration, '{}'::jsonb) || ${JSON.stringify({
        robots: 'ignore',
        robots_decision: {
          user_id: scope.userId,
          email: 'owner@example.com',
          decided_at: new Date().toISOString(),
        },
      })}::jsonb`,
    })
    .where('workspace_id', '=', scope.workspaceId)
    .execute();
  expect(await robots({})).toBe(
    'Ignored, as decided for the last crawl: the crawl also fetches pages robots.txt disallows.',
  );
  expect(await robots({ robots: 'respect' })).toBe('Followed');
});

it('rerun_audit_failures quotes no spend once the failed answers are already queued', async () => {
  const arranged = await table.rerun_audit_failures.arrange();
  const { scope, payload } = arranged;
  const context = { db, config, workspaceId: scope.workspaceId, projectId: scope.projectId };
  const change = () => ({ id: randomUUID(), projectId: scope.projectId });
  const stage = () =>
    changeKinds.rerun_audit_failures.stage(context, owner(scope), change(), payload);
  expect((await stage()).preview.spend).toBe(
    '3 prompt runs for 3 answers, with your own provider keys',
  );
  await db
    .transaction()
    .execute((trx) =>
      changeKinds.rerun_audit_failures.confirm(trx, config, owner(scope), change(), payload),
    );
  expect((await stage()).preview.spend).toBe('Nothing new: these answers are already queued');
});

it('override_claim_verdict shows the claim, the model verdict, the current one and the new one', async () => {
  const { preview } = await staged('override_claim_verdict');
  expect(preview.rows).toEqual([
    { label: 'Claim', value: 'Acme Pro costs $49 per month.' },
    { label: 'Model verdict', value: 'contradicted' },
    { label: 'Now', value: 'contradicted' },
    { label: 'After', value: 'supported' },
    { label: 'Note', value: 'Checked the pricing page' },
  ]);
});
