import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { actionsPageSchema } from '@citeladder/contracts/actions';
import { createApp } from '../src/app.ts';
import { readChat } from '../src/agent/reads.ts';
import { agentTools } from '../src/agent/tool-adapters.ts';
import { attachOrCreateAction } from '../src/opportunities/actions.ts';
import { actionFixture, type ActionSeed } from './action-support.ts';
import { AgentFixtures } from './agent-support.ts';
import { TEST_SESSION_COOKIE, sessionToken, testConfig, testDatabase } from './support.ts';

const config = testConfig();
const db = testDatabase(config);
const app = createApp(config, db);
const fixtures = new AgentFixtures(db);
const seeds: ActionSeed[] = [];
const pageRule = 'site_link_near_orphan';
const otherRule = 'site_link_weak_authority';
const promptRule = 'brand_absent_high_value_prompt';
async function seed() {
  const s = await actionFixture<ActionSeed>('seed');
  seeds.push(s);
  return s;
}
const actionId = (s: ActionSeed, rule: string) => s.actions[rule]!;
async function request(s: ActionSeed, path: string, method = 'GET', body?: unknown) {
  const cookie = `${TEST_SESSION_COOKIE}=${await sessionToken({ sub: s.user_id, ver: 0 })}`;
  const headers = { cookie, 'x-workspace-id': s.workspace_id };
  if (body === undefined) return app.request(path, { method, headers });
  return app.request(path, {
    method,
    headers: { ...headers, 'content-type': 'application/json', 'Idempotency-Key': randomUUID() },
    body: JSON.stringify(body),
  });
}
afterAll(async () => {
  for (const s of seeds) {
    await db.deleteFrom('workspaces').where('id', '=', s.workspace_id).execute();
    await db.deleteFrom('users').where('id', '=', s.user_id).execute();
  }
  await fixtures.cleanup();
  await db.destroy();
});

describe('Finding Actions by name', () => {
  it('finds Actions by label text in every status with any, and only in their own project', async () => {
    const s = await seed();
    const foreign = await seed();
    const list = `/api/v1/projects/${s.project_id}/actions`;
    const ids = async (query: string) =>
      actionsPageSchema
        .parse(await (await request(s, `${list}?${query}`)).json())
        .items.map((item) => item.id);
    await db
      .updateTable('actions')
      .set({ effective_status: 'measuring' })
      .where('id', '=', actionId(s, promptRule))
      .execute();
    expect(await ids('q=CRM')).toEqual([]);
    expect(await ids('q=CRM&status=any')).toEqual([actionId(s, promptRule)]);
    expect(await ids('q=acme.test/&status=any')).toEqual([
      actionId(s, pageRule),
      actionId(s, otherRule),
    ]);
    expect(await ids('q=%25&status=any')).toEqual([]);
    expect((await request(s, `${list}?status=every`)).status).toBe(422);
    expect((await request(s, `${list}?q=${'x'.repeat(201)}`)).status).toBe(422);
    expect((await request(foreign, `${list}?q=CRM&status=any`)).status).toBe(404);
    const theirs = actionsPageSchema.parse(
      await (
        await request(foreign, `/api/v1/projects/${foreign.project_id}/actions?q=CRM&status=any`)
      ).json(),
    );
    expect(theirs.items.map((item) => item.id)).toEqual([actionId(foreign, promptRule)]);
  });

  it('lets the Agent find a measuring Action by name with read_actions and search, only in its project', async () => {
    const scope = await fixtures.scope();
    const sibling = await fixtures.project(scope.workspaceId);
    const create = (projectId: string, topic: string) =>
      db
        .transaction()
        .execute((trx) =>
          attachOrCreateAction(trx, { ...scope, projectId }, 'planned_page', topic, scope.userId),
        );
    const open = await create(scope.projectId, 'School uniform sizes');
    const measuring = await create(scope.projectId, 'Affordable school uniform shops');
    await create(sibling, 'School uniform outlet');
    await db
      .updateTable('actions')
      .set({ effective_status: 'measuring' })
      .where('id', '=', measuring.id)
      .execute();
    const tools = agentTools(db);
    const read = async (name: string, args: Parameters<typeof tools.execute>[3]) =>
      JSON.parse((await tools.execute(db, scope, name, args, AbortSignal.timeout(5000))).text);
    expect((await read('read_actions', { query: 'SHOPS' })).items).toEqual([]);
    expect((await read('read_actions', { query: 'shops', status: 'any' })).items).toMatchObject([
      { id: measuring.id, status: 'done', measurement: 'measuring' },
    ]);
    expect((await read('search', { query: 'school uniform' })).results).toMatchObject([
      { id: `citeladder://action/${open.id}`, text: 'Status: open.' },
      { id: `citeladder://action/${measuring.id}`, text: 'Status: done.' },
    ]);
  });

  it('projects the mentioned and cited Actions of the chat’s own project, with their current status', async () => {
    const scope = await fixtures.scope();
    const other = await fixtures.scope();
    const create = (where: typeof scope, topic: string) =>
      db
        .transaction()
        .execute((trx) => attachOrCreateAction(trx, where, 'planned_page', topic, where.userId));
    const mentioned = await create(scope, 'School uniform guide');
    const cited = await create(scope, 'Returns policy');
    const foreign = await create(other, 'Foreign guide');
    const run = await fixtures.store().enqueue(scope, {
      key: randomUUID(),
      message: 'Find @School uniform guide',
      mentionIds: [mentioned.id],
    });
    await db
      .updateTable('actions')
      .set({ effective_status: 'measuring' })
      .where('id', '=', mentioned.id)
      .execute();
    await db
      .updateTable('agent_messages')
      .set({
        evidence_refs: JSON.stringify([
          `citeladder://action/${cited.id}`,
          `citeladder://action/${foreign.id}`,
          `citeladder://opportunity/${randomUUID()}`,
        ]),
      })
      .where('chat_id', '=', run.chat_id)
      .execute();
    const { actions } = await readChat(db, scope, run.chat_id);
    expect(new Map(actions.map((action) => [action.id, action]))).toEqual(
      new Map([
        [mentioned.id, { id: mentioned.id, target_label: 'School uniform guide', status: 'done' }],
        [cited.id, { id: cited.id, target_label: 'Returns policy', status: 'open' }],
      ]),
    );
  });
});
