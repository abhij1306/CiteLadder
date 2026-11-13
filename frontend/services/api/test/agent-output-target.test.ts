import { afterAll, describe, expect, it } from 'vitest';
import { agentChatDetailSchema } from '@citeladder/contracts/agent';
import { createApp } from '../src/app.ts';
import { attachAgentTarget } from '../src/agent/target-adapter.ts';
import { readChat } from '../src/agent/reads.ts';
import { AgentFixtures, save, scripted } from './agent-support.ts';
import { TEST_SESSION_COOKIE, sessionToken, testConfig, testDatabase } from './support.ts';

describe('a document naming another page than its Action, on PostgreSQL', () => {
  const db = testDatabase(),
    fixtures = new AgentFixtures(db),
    config = testConfig(),
    app = createApp(config, db);
  afterAll(async () => {
    await fixtures.cleanup();
    await db.destroy();
  });
  async function headersFor(scope: { userId: string; workspaceId: string }) {
    const token = await sessionToken({ sub: scope.userId, ver: 0 });
    return {
      cookie: `${TEST_SESSION_COOKIE}=${token}`,
      'X-Workspace-Id': scope.workspaceId,
      'Content-Type': 'application/json',
    };
  }
  /** A chat whose first document made `Buyer guide` its Action, then three more documents. */
  async function chatWithNamedDocuments() {
    const scope = await fixtures.scope();
    const first = await fixtures.claimed(scope, { skillId: 'content' });
    await fixtures
      .runtime(
        scope,
        scripted([
          save('Guide', { title: 'Guide', target_kind: 'planned_page', target: 'Buyer guide' }),
        ]),
        { attachTarget: attachAgentTarget },
      )
      .execute(first.lease);
    const next = await fixtures.claimed(scope, { chatId: first.run.chat_id });
    await fixtures
      .runtime(
        scope,
        scripted([
          save('Pricing', {
            title: 'Pricing',
            target_kind: 'page',
            target: 'https://acme.example/pricing',
          }),
          save('Same guide', {
            title: 'Same guide',
            target_kind: 'planned_page',
            target: '  Buyer guide ',
          }),
          save('Docs', { title: 'Docs', target_kind: 'page', target: 'https://acme.example/docs' }),
        ]),
        { attachTarget: attachAgentTarget },
      )
      .execute(next.lease);
    const chat = await readChat(db, scope, first.run.chat_id);
    return { scope, chatId: first.run.chat_id, chat };
  }
  const choose = (
    chatId: string,
    outputId: string,
    decision: string,
    headers: Record<string, string>,
  ) =>
    app.request(`/api/v1/agent/chats/${chatId}/outputs/${outputId}/target`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ decision }),
    });
  const actionOf = (id: string) =>
    db
      .selectFrom('actions')
      .select(['target_kind', 'target_label', 'effective_status'])
      .where('id', '=', id)
      .executeTakeFirstOrThrow();

  it('offers the named page, links the document there or keeps it with its Action', async () => {
    const { scope, chatId, chat } = await chatWithNamedDocuments();
    const guideAction = chat.chat.action_id!;
    expect(
      chat.outputs.map((output) => [
        output.number,
        output.action_id === guideAction,
        output.target_label,
        output.named_target,
      ]),
    ).toEqual([
      [1, true, 'Buyer guide', null],
      [
        2,
        true,
        'https://acme.example/pricing',
        { kind: 'page', target: 'https://acme.example/pricing' },
      ],
      // The same Action, named again with spacing, settles at once.
      [3, true, 'Buyer guide', null],
      [4, true, 'https://acme.example/docs', { kind: 'page', target: 'https://acme.example/docs' }],
    ]);
    const headers = await headersFor(scope);
    const pricing = chat.outputs[1]!.id,
      docs = chat.outputs[3]!.id;

    const linked = await choose(chatId, pricing, 'link', headers);
    expect(linked.status).toBe(200);
    const afterLink = agentChatDetailSchema.parse(await linked.json());
    const pricingOutput = afterLink.outputs[1]!;
    expect(pricingOutput.action_id).not.toBe(guideAction);
    expect(pricingOutput.named_target).toBeNull();
    expect(await actionOf(pricingOutput.action_id!)).toEqual({
      target_kind: 'page',
      target_label: 'https://acme.example/pricing',
      effective_status: 'in_progress',
    });
    // The chat keeps the Action it was opened for.
    expect(afterLink.chat.action_id).toBe(guideAction);

    const kept = await choose(chatId, docs, 'keep', headers);
    expect(kept.status).toBe(200);
    expect(agentChatDetailSchema.parse(await kept.json()).outputs[3]).toMatchObject({
      action_id: guideAction,
      target_kind: 'planned_page',
      target_label: 'Buyer guide',
      named_target: null,
    });

    // A settled document has nothing left to choose.
    expect((await choose(chatId, docs, 'link', headers)).status).toBe(409);
    expect((await choose(chatId, chat.outputs[0]!.id, 'keep', headers)).status).toBe(409);
    // A later revision naming another page again does not reopen the choice.
    const again = await fixtures.claimed(scope, { chatId });
    await fixtures
      .runtime(
        scope,
        scripted([
          save('Docs again', {
            document: 4,
            title: 'Docs',
            target_kind: 'page',
            target: 'https://acme.example/support',
          }),
        ]),
        { attachTarget: attachAgentTarget },
      )
      .execute(again.lease);
    expect((await readChat(db, scope, chatId)).outputs[3]).toMatchObject({
      action_id: guideAction,
      named_target: null,
    });
  });

  it('refuses another workspace and leaves the document as it was', async () => {
    const { scope, chatId, chat } = await chatWithNamedDocuments();
    const stranger = await fixtures.scope();
    const pricing = chat.outputs[1]!;
    const refused = await choose(chatId, pricing.id, 'link', await headersFor(stranger));
    expect(refused.status).toBe(404);
    const stored = await db
      .selectFrom('agent_outputs')
      .select(['action_id', 'target_label'])
      .where('id', '=', pricing.id)
      .executeTakeFirstOrThrow();
    expect(stored).toEqual({
      action_id: chat.chat.action_id,
      target_label: 'https://acme.example/pricing',
    });
    // No Action was created for the named page in either workspace.
    expect(
      await db
        .selectFrom('actions')
        .select('id')
        .where('target_label', '=', 'https://acme.example/pricing')
        .where('workspace_id', 'in', [scope.workspaceId, stranger.workspaceId])
        .execute(),
    ).toEqual([]);
  });
});
