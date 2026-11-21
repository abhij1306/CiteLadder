import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { testDatabase } from './support.ts';
import { AgentFixtures } from './agent-support.ts';
import { chatOrigin, listChats } from '../src/agent/reads.ts';

const ID = '00000000-0000-4000-8000-000000000001';

describe('Agent chat list origin', () => {
  const db = testDatabase();
  const fixtures = new AgentFixtures(db);
  afterAll(async () => {
    await fixtures.cleanup();
    await db.destroy();
  });

  it('lists each chat with the origin its context references name, in this workspace only', async () => {
    const scope = await fixtures.scope();
    const run = await fixtures.store().enqueue(scope, { key: randomUUID(), message: 'Origin' });
    await fixtures.store().enqueue(await fixtures.scope(), { key: randomUUID(), message: 'Other' });
    const listed = async () =>
      (await listChats(db, scope)).items.map((chat) => [chat.id, chat.origin]);
    expect(await listed()).toEqual([[run.chat_id, 'chat']]);
    await db
      .updateTable('agent_chats')
      .set({ context_refs: { demand_signal_id: randomUUID() } })
      .where('id', '=', run.chat_id)
      .execute();
    expect(await listed()).toEqual([[run.chat_id, 'demand']]);
  });
  it.each([
    [{}, null, 'chat'],
    [{ target_site_url_id: null }, null, 'chat'],
    [{}, ID, 'action'],
    [{ prompt_reference: { topic_id: ID, prompt_ids: [ID] } }, ID, 'prompts'],
    [
      { search_intelligence_reference: { dataset_id: ID, row_ids: [ID] } },
      null,
      'keyword_research',
    ],
    [
      { demand_signal_id: ID, prompt_reference: { topic_id: ID, prompt_ids: [ID] } },
      null,
      'demand',
    ],
    [{ opportunity_id: ID, demand_signal_id: ID }, null, 'recommendation'],
    [{ page_snapshot_reference: { snapshot_id: ID }, opportunity_id: ID }, null, 'page'],
    [{ target_url: 'https://example.com/', target_site_url_id: null }, null, 'page'],
    [
      { issue_group_reference: { crawl_id: ID, group_id: ID }, target_url: 'https://e.com/' },
      ID,
      'site_health',
    ],
    [{ site_facts_reference: { crawl_id: ID } }, null, 'site_health'],
    [{ objection_group_id: ID }, ID, 'objection'],
  ])('derives the origin of refs %j with action %s as %s', (refs, actionId, origin) => {
    expect(chatOrigin({ context_refs: refs, action_id: actionId })).toBe(origin);
  });
});
