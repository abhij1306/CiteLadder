import { createHash } from 'node:crypto';
import { afterAll, expect, it } from 'vitest';
import { budget } from '../src/abuse/usage.ts';
import { proposeChange } from '../src/agent/change-proposals.ts';
import { decideProposal } from '../src/agent/proposal-outcomes.ts';
import { readChat } from '../src/agent/reads.ts';
import type { Json, Scope } from '../src/agent/contracts.ts';
import { AgentFixtures, scripted, text, toolUse } from './agent-support.ts';
import { auditTenant } from './audit-fixtures.ts';
import { billingAccount, grant, promptSet } from './prompt-fixtures.ts';
import { asOwner, testConfig, testDatabase } from './support.ts';

const config = testConfig();
const db = testDatabase(config);
const fixtures = new AgentFixtures(db);

afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});

async function tenant() {
  const t = await auditTenant(db, fixtures);
  const scope: Scope = { workspaceId: t.workspaceId, projectId: t.projectId, userId: t.userId };
  fixtures.scopes.push(scope);
  return { ...t, scope };
}

async function enable(workspaceId: string, key: 'fact_checking' | 'commerce') {
  await grant(db, await billingAccount(db, workspaceId), { key, value: 1, sourceKind: 'override' });
}

async function revoke(workspaceId: string, key: 'commerce') {
  const account = await billingAccount(db, workspaceId);
  await asOwner((owner) =>
    owner
      .deleteFrom('account_grants')
      .where('billing_account_id', '=', account)
      .where('key', '=', key)
      .execute(),
  );
}

async function proposed(scope: Scope, calls: { kind: string; payload: Json }[]) {
  const { run, lease } = await fixtures.claimed(scope, { message: 'Import the attached file.' });
  const results: string[] = [];
  await fixtures
    .runtime(
      scope,
      scripted(
        [
          ...calls.map((call, index) => [toolUse('propose_change', call, `call_${index}`)]),
          [text('Confirm it below.')],
        ],
        (request, ordinal) => {
          if (ordinal > 1) {
            const last = JSON.parse(JSON.stringify(request.messages.at(-1)));
            results.push(
              ...last.content.flatMap((block: { type: string; content?: string }) =>
                block.type === 'tool_result' ? [block.content ?? ''] : [],
              ),
            );
          }
          return Promise.resolve();
        },
      ),
    )
    .execute(lease);
  const chat = await readChat(db, scope, run.chat_id);
  const answer = chat.messages.at(-1)!;
  const confirm = (index: number) =>
    decideProposal(db, config, {
      scope,
      ref: { chatId: run.chat_id, messageId: answer.id, index },
      decision: 'confirm',
    });
  return { proposals: answer.proposals, results, confirm };
}

const promptTexts = async (setId: string) =>
  (
    await db
      .selectFrom('prompts')
      .select('text')
      .where('prompt_set_id', '=', setId)
      .orderBy('text')
      .execute()
  ).map((row) => row.text);

async function setRole(scope: Scope, role: string) {
  await db
    .updateTable('workspace_members')
    .set({ role })
    .where('user_id', '=', scope.userId)
    .where('workspace_id', '=', scope.workspaceId)
    .execute();
}

const bulkImportsSpent = async (workspaceId: string) =>
  (
    await db
      .selectFrom('usage_windows')
      .select('count')
      .where('operation', '=', budget('bulk_import', process.env).operation)
      .where('subject_hash', '=', createHash('sha256').update(workspaceId).digest('hex'))
      .execute()
  ).reduce((sum, row) => sum + row.count, 0);

const refusedNow = (reason: string) =>
  `This change would be refused now: ${reason}. Correct it, or tell the person why it cannot be made.`;

it('previews a prompt import with its skips without writing, refuses another workspace’s set and imports through the owner on confirm', async () => {
  const t = await tenant();
  const stranger = await tenant();
  const otherProjectSet = await promptSet(db, await fixtures.project(t.workspaceId));
  const grip = 'Which trail running shoes grip best in mud?';
  const light = 'Which running shoes are lightest for racing?';
  const rows: Json[] = [
    { text: grip, topic: 'Trail' },
    { text: 'Which running shoes suit road use?' },
    { text: light, persona: 'Racer' },
    { text: grip },
    { text: '  ' },
  ];
  const { proposals, results, confirm } = await proposed(t.scope, [
    { kind: 'import_prompts', payload: { prompt_set_id: stranger.setId, prompts: rows } },
    { kind: 'import_prompts', payload: { prompt_set_id: otherProjectSet, prompts: rows } },
    { kind: 'import_prompts', payload: { prompt_set_id: t.setId, prompts: rows } },
  ]);
  expect(results.slice(0, 2)).toEqual([
    refusedNow('Prompt set not found'),
    refusedNow('Prompt set not found'),
  ]);
  expect(proposals).toEqual([
    {
      kind: 'change',
      index: 0,
      title: 'Import 2 prompts',
      rows: [
        { label: 'Prompt set', value: 'Set' },
        { label: 'Rows given', value: '5' },
        { label: 'Skipped, already tracked or repeated', value: '2' },
        { label: 'Skipped, no prompt text', value: '1' },
        { label: 'Example', value: grip },
        { label: 'Example', value: light },
      ],
      spend: null,
      opens: null,
      outcome: 'open',
      refusal: null,
    },
  ]);
  expect(await promptTexts(t.setId)).toEqual(['Which running shoes suit road use?']);
  expect(await bulkImportsSpent(t.workspaceId)).toBe(0);

  await confirm(0);
  expect(await promptTexts(t.setId)).toEqual([light, 'Which running shoes suit road use?', grip]);
  expect(await bulkImportsSpent(t.workspaceId)).toBe(1);
  expect(await promptTexts(stranger.setId)).toEqual(['Which running shoes suit road use?']);
  expect(
    await db.selectFrom('topics').select('name').where('project_id', '=', t.projectId).execute(),
  ).toEqual([{ name: 'Trail' }]);
});

it('refuses a prompt import with rows outside the project’s topic, naming the rows', async () => {
  const t = await tenant();
  const { proposals, results } = await proposed(t.scope, [
    {
      kind: 'import_prompts',
      payload: {
        prompt_set_id: t.setId,
        prompts: [{ text: 'Which running shoes suit wide feet?' }, { text: 'What is a mortgage?' }],
      },
    },
    {
      kind: 'import_prompts',
      payload: {
        prompt_set_id: t.setId,
        prompts: [{ text: 'Which running shoes suit road use?' }],
      },
    },
  ]);
  expect(results[0]).toMatch(/^This change would be refused now: .*\(row 2: [^;]+\)\. Correct it/u);
  expect(results[1]).toBe(
    refusedNow('Every row is already there or invalid, so nothing would be imported'),
  );
  expect(proposals).toEqual([]);
});

it('refuses facts without the fact-checking flag, then previews duplicates and invalid rows and imports drafts on confirm', async () => {
  const t = await tenant();
  const slack = 'Acme Running integrates with Slack.';
  const payload = {
    rows: [
      { topic: 'Integrations', statement: slack, source_url: null },
      { topic: 'weather', statement: 'It rains a lot.', source_url: null },
      { topic: 'integrations', statement: ` ${slack.toUpperCase()} `, source_url: '' },
    ],
  };
  const refused = await proposed(t.scope, [{ kind: 'import_brand_facts', payload }]);
  expect(refused.results).toEqual([
    refusedNow("Fact-checking is not included in this workspace's plan"),
  ]);
  expect(refused.proposals).toEqual([]);

  await enable(t.workspaceId, 'fact_checking');
  const stageAs = async (role: string) => {
    await setRole(t.scope, role);
    const state = { proposals: [], steps: [] };
    const outcome = await proposeChange(
      db,
      config,
      { scope: t.scope, state },
      {
        kind: 'import_brand_facts',
        payload,
      },
    );
    return { refusal: outcome.ok ? null : outcome.text, staged: state.proposals.length };
  };
  expect(await stageAs('viewer')).toEqual({
    refusal: 'The person’s role cannot make this change. Tell them instead of proposing it.',
    staged: 0,
  });
  expect(await stageAs('owner')).toEqual({ refusal: null, staged: 1 });
  const { proposals, confirm } = await proposed(t.scope, [{ kind: 'import_brand_facts', payload }]);
  expect(proposals).toEqual([
    {
      kind: 'change',
      index: 0,
      title: 'Import 1 fact as drafts',
      rows: [
        { label: 'Rows given', value: '3' },
        { label: 'Skipped, already a fact', value: '1' },
        { label: 'Rejected', value: '1' },
        { label: 'Rejected row', value: expect.stringMatching(/^Row 2: Topic must be one of: /u) },
        { label: 'Example', value: slack },
      ],
      spend: null,
      opens: null,
      outcome: 'open',
      refusal: null,
    },
  ]);
  const facts = () =>
    db
      .selectFrom('brand_facts')
      .select(['topic', 'statement', 'status'])
      .where('workspace_id', '=', t.workspaceId)
      .where('project_id', '=', t.projectId)
      .execute();
  expect(await facts()).toEqual([]);

  await confirm(0);
  expect(await facts()).toEqual([{ topic: 'integrations', statement: slack, status: 'draft' }]);
});

it('refuses a catalog import without commerce, then previews new and rejected products and applies them on confirm', async () => {
  const t = await tenant();
  const payload = {
    source: 'csv',
    filename: 'products.csv',
    content: [
      'title,brand,price,currency,link,category',
      'Trail Runner,Acme,120.00,USD,https://shop.example/trail-runner,Footwear',
      'Road Runner,Acme,89.50,USD,https://shop.example/road-runner,Footwear',
      ',Acme,10,USD,https://shop.example/untitled,Accessories',
    ].join('\n'),
  };
  await revoke(t.workspaceId, 'commerce');
  const refused = await proposed(t.scope, [{ kind: 'import_catalog', payload }]);
  expect(refused.results).toEqual([refusedNow('Commerce is not included in your plan')]);

  await enable(t.workspaceId, 'commerce');
  const { proposals, confirm } = await proposed(t.scope, [{ kind: 'import_catalog', payload }]);
  expect(proposals).toEqual([
    {
      kind: 'change',
      index: 0,
      title: 'Import 2 products into the catalog',
      rows: [
        { label: 'File', value: 'products.csv' },
        { label: 'New', value: '2' },
        { label: 'Rejected', value: '1' },
        { label: 'Rejected row', value: expect.stringMatching(/^Row 4: /u) },
        { label: 'Example', value: 'Road Runner' },
        { label: 'Example', value: 'Trail Runner' },
      ],
      spend: null,
      opens: null,
      outcome: 'open',
      refusal: null,
    },
  ]);
  const products = () =>
    db
      .selectFrom('commerce_products')
      .select('name')
      .where('workspace_id', '=', t.workspaceId)
      .where('project_id', '=', t.projectId)
      .orderBy('name')
      .execute();
  const staged = () =>
    db
      .selectFrom('commerce_csv_imports')
      .select('id')
      .where('workspace_id', '=', t.workspaceId)
      .where('project_id', '=', t.projectId)
      .execute();
  expect(await products()).toEqual([]);
  expect(await staged()).toEqual([]);

  await confirm(0);
  expect(await products()).toEqual([{ name: 'Road Runner' }, { name: 'Trail Runner' }]);
  expect(await staged()).toHaveLength(1);
  const again = await proposed(t.scope, [{ kind: 'import_catalog', payload }]);
  expect(again.results).toEqual([
    refusedNow('This exact file was already imported into the catalog'),
  ]);
});
