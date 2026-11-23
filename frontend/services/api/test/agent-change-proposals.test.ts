import { randomUUID } from 'node:crypto';
import { afterAll, expect, it } from 'vitest';
import { sql } from 'kysely';
import { proposeChange } from '../src/agent/change-proposals.ts';
import { decideProposal, proposalChangeId } from '../src/agent/proposal-outcomes.ts';
import { readChat } from '../src/agent/reads.ts';
import { agentPolicy, type Json, type Scope } from '../src/agent/contracts.ts';
import { subjectXactLock } from '../src/db/advisory-lock.ts';
import { ApiError } from '../src/errors.ts';
import { AgentFixtures, scripted, text, toolUse } from './agent-support.ts';
import { auditTenant } from './audit-fixtures.ts';
import { prompt, promptSet, topic } from './prompt-fixtures.ts';
import { gatedGeneration, singleConnectionDatabase } from './live-owner.ts';
import { testConfig, testDatabase } from './support.ts';

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

async function proposed(scope: Scope, calls: { kind: string; payload: Json }[], together = false) {
  const { run, lease } = await fixtures.claimed(scope, { message: 'Please make this change.' });
  await fixtures
    .runtime(
      scope,
      scripted([
        ...(together
          ? [calls.map((call, index) => toolUse('propose_change', call, `call_${index}`))]
          : calls.map((call, index) => [toolUse('propose_change', call, `call_${index}`)])),
        [text('Confirm it below.')],
      ]),
    )
    .execute(lease);
  const chat = await readChat(db, scope, run.chat_id);
  const answer = chat.messages.at(-1)!;
  return { chatId: run.chat_id, messageId: answer.id, proposals: answer.proposals };
}

const promptTexts = async (setId: string) =>
  (
    await db
      .selectFrom('prompts')
      .select('text')
      .where('prompt_set_id', '=', setId)
      .orderBy('created_at')
      .execute()
  ).map((row) => row.text);

const outcome = async (scope: Scope, chatId: string) =>
  (await readChat(db, scope, chatId)).messages.at(-1)!.proposals;

async function status(promise: Promise<unknown>) {
  try {
    await promise;
    return 200;
  } catch (error) {
    if (error instanceof ApiError) return error.status;
    throw error;
  }
}

async function setRole(scope: Pick<Scope, 'workspaceId' | 'userId'>, role: string) {
  await db
    .updateTable('workspace_members')
    .set({ role })
    .where('user_id', '=', scope.userId)
    .where('workspace_id', '=', scope.workspaceId)
    .execute();
}

it('stages a dry-run proposal that commits with the reply, then executes once for a member of its workspace', async () => {
  const t = await tenant();
  const stranger = await tenant();
  const added = 'Which running shoes grip trails best?';
  const { chatId, messageId, proposals } = await proposed(t.scope, [
    { kind: 'add_prompts', payload: { prompt_set_id: t.setId, prompts: [] } },
    { kind: 'add_prompts', payload: { prompt_set_id: t.setId, prompts: [{ text: added }] } },
  ]);
  expect(proposals).toEqual([
    {
      kind: 'change',
      index: 0,
      title: 'Add 1 prompt',
      rows: [
        { label: 'Prompt set', value: 'Set' },
        { label: 'Prompt', value: added },
      ],
      spend: null,
      opens: null,
      outcome: 'open',
      refusal: null,
    },
  ]);
  expect(await promptTexts(t.setId)).toEqual(['Which running shoes suit road use?']);

  const ref = { chatId, messageId, index: 0 };
  const decide = (scope: Pick<Scope, 'workspaceId' | 'userId'>) =>
    status(decideProposal(db, config, { scope, ref, decision: 'confirm' }));
  const colleague = { workspaceId: t.workspaceId, userId: await fixtures.user() };
  expect(await decide(stranger.scope)).toBe(404);
  expect(await decide(colleague)).toBe(404);
  await fixtures.member(t.workspaceId, colleague.userId, 'viewer');
  expect(await decide(colleague)).toBe(403);
  await setRole(colleague, 'member');
  await db
    .deleteFrom('workspace_members')
    .where('user_id', '=', colleague.userId)
    .where('workspace_id', '=', t.workspaceId)
    .execute();
  expect(await decide(colleague)).toBe(404);
  await fixtures.member(t.workspaceId, colleague.userId, 'member');
  await setRole(t.scope, 'viewer');
  expect(await outcome(t.scope, chatId)).toMatchObject([{ outcome: 'open' }]);

  expect((await Promise.all([decide(colleague), decide(colleague)])).sort()).toEqual([200, 409]);
  expect(await promptTexts(t.setId)).toEqual(['Which running shoes suit road use?', added]);
  expect(await outcome(t.scope, chatId)).toMatchObject([{ outcome: 'executed' }]);
  expect(
    await db
      .selectFrom('security_events')
      .select(['event', 'target_id'])
      .where('actor_id', '=', colleague.userId)
      .where('event', 'like', 'agent.change.%')
      .execute(),
  ).toEqual([{ event: 'agent.change.add_prompts', target_id: t.projectId }]);
});

it('returns the owner’s error when the world changed and leaves the card confirmable', async () => {
  const t = await tenant();
  const { chatId, messageId } = await proposed(t.scope, [
    { kind: 'create_topic', payload: { name: 'Trail' } },
  ]);
  const clash = await topic(db, t.projectId, 'Trail');
  const ref = { chatId, messageId, index: 0 };
  const confirm = () => decideProposal(db, config, { scope: t.scope, ref, decision: 'confirm' });
  expect(await status(confirm())).toBe(409);
  expect(await outcome(t.scope, chatId)).toMatchObject([
    { outcome: 'open', refusal: 'A topic with this name already exists in the project' },
  ]);
  await db.deleteFrom('topics').where('id', '=', clash).execute();
  expect(await status(confirm())).toBe(200);
  expect(await outcome(t.scope, chatId)).toMatchObject([{ outcome: 'executed', refusal: null }]);
});

it('previews a paid launch with its spend from the estimate, never the model’s ceiling, and holds nothing until the click', async () => {
  const t = await tenant();
  const ledger = () =>
    db
      .selectFrom('consumable_ledger')
      .select('id')
      .where('workspace_id', '=', t.workspaceId)
      .execute();
  const audits = () =>
    db.selectFrom('audits').select('status').where('project_id', '=', t.projectId).execute();
  const before = await ledger();
  const { chatId, messageId, proposals } = await proposed(t.scope, [
    {
      kind: 'launch_audit',
      payload: { request: { prompt_set_id: t.setId, engines: ['chatgpt'], max_attempts: 500 } },
    },
  ]);
  expect(proposals).toMatchObject([
    {
      title: 'Launch an audit',
      spend: 'Up to 3 prompt runs, in at most 9 provider attempts',
      opens: { label: 'Open Runs', path: '/runs' },
    },
  ]);
  expect(await audits()).toEqual([]);
  expect(await ledger()).toEqual(before);

  await decideProposal(db, config, {
    scope: t.scope,
    ref: { chatId, messageId, index: 0 },
    decision: 'confirm',
  });
  expect(await audits()).toEqual([{ status: 'queued' }]);
});

it('caps a long card at its list, keeping the rows after it, and shows the topics a generation covers', async () => {
  const t = await tenant();
  const road = await topic(db, t.projectId, 'Road');
  await topic(db, t.projectId, 'Trail');
  const ids = await Promise.all(
    Array.from({ length: 24 }, (_, index) => prompt(db, t.setId, `Which shoe ${index}?`)),
  );
  const { proposals } = await proposed(t.scope, [
    { kind: 'delete_prompts', payload: { prompt_ids: ids } },
    {
      kind: 'generate_prompts',
      payload: { prompt_set_id: t.setId, request: { count: 5, topic_ids: [road] } },
    },
    { kind: 'generate_prompts', payload: { prompt_set_id: t.setId, request: { count: 5 } } },
  ]);
  const rows = proposals.map((proposal) => (proposal.kind === 'change' ? proposal.rows : []));
  expect(rows[0]).toHaveLength(agentPolicy.proposal_preview_rows_max);
  expect(rows[0]!.slice(-3)).toEqual([
    { label: 'More', value: '7 more' },
    { label: 'Audits that asked them', value: '0, kept in history' },
    { label: 'Undo', value: 'This cannot be undone.' },
  ]);
  expect(rows.slice(1).map((card) => card.at(-1))).toEqual([
    { label: 'Topic', value: 'Road' },
    { label: 'Topics', value: 'All 2 topics' },
  ]);
});

it('stages at most the per-turn bound of proposals when the model proposes them in parallel', async () => {
  const t = await tenant();
  const names = ['Trail', 'Road', 'Hills', 'Track', 'Beach', 'Snow'];
  const { proposals } = await proposed(
    t.scope,
    names.map((name) => ({ kind: 'create_topic', payload: { name } })),
    true,
  );
  expect(proposals).toHaveLength(5);
});

it('dismisses a card without changing anything and refuses to execute it afterwards', async () => {
  const t = await tenant();
  const name = `Trail ${randomUUID().slice(0, 4)}`;
  const { chatId, messageId } = await proposed(t.scope, [
    { kind: 'create_topic', payload: { name } },
  ]);
  const ref = { chatId, messageId, index: 0 };
  await decideProposal(db, config, { scope: t.scope, ref, decision: 'dismiss' });
  expect(
    await status(decideProposal(db, config, { scope: t.scope, ref, decision: 'confirm' })),
  ).toBe(409);
  expect(await outcome(t.scope, chatId)).toMatchObject([{ outcome: 'dismissed' }]);
  expect(
    await db.selectFrom('topics').select('name').where('project_id', '=', t.projectId).execute(),
  ).toEqual([]);
});

async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return error.message;
    throw error;
  }
  throw new Error('The change was not refused');
}

it('tells each later turn what happened to its cards once, by their card, and refuses another project’s record', async () => {
  const t = await tenant();
  const otherSet = await promptSet(db, await fixtures.project(t.workspaceId));
  const { chatId, messageId, proposals } = await proposed(t.scope, [
    { kind: 'create_topic', payload: { name: 'Trail' } },
    { kind: 'create_topic', payload: { name: 'Road' } },
    { kind: 'create_topic', payload: { name: 'Hills' } },
    {
      kind: 'add_prompts',
      payload: {
        prompt_set_id: t.setId,
        prompts: [{ text: 'Which trail running shoes grip best in mud?' }],
      },
    },
    { kind: 'create_topic', payload: { name: 'Track' } },
  ]);
  expect(proposals.map((card) => card.kind === 'change' && card.title)).toEqual([
    'Create a topic',
    'Create a topic',
    'Create a topic',
    'Add 1 prompt',
    'Create a topic',
  ]);
  const stored = await db
    .selectFrom('agent_messages')
    .select('proposals')
    .where('id', '=', messageId)
    .executeTakeFirstOrThrow();
  const tampered = JSON.parse(JSON.stringify(stored.proposals));
  tampered[3].payload.prompt_set_id = otherSet;
  await db
    .updateTable('agent_messages')
    .set({ proposals: JSON.stringify(tampered) })
    .where('id', '=', messageId)
    .execute();
  const decide = (index: number, decision: 'confirm' | 'dismiss' = 'confirm') =>
    decideProposal(db, config, { scope: t.scope, ref: { chatId, messageId, index }, decision });

  await topic(db, t.projectId, 'Trail');
  const clash = await refusal(decide(0));
  await decide(1);
  await decide(2, 'dismiss');
  const elsewhere = await refusal(decide(3));
  expect(await promptTexts(otherSet)).toEqual([]);
  expect(await promptTexts(t.setId)).toEqual(['Which running shoes suit road use?']);
  expect(
    (await outcome(t.scope, chatId)).map((card) => card.kind === 'change' && card.outcome),
  ).toEqual(['open', 'executed', 'dismissed', 'open', 'open']);

  const requests: string[][] = [];
  const turn = async () => {
    const { lease } = await fixtures.claimed(t.scope, { chatId, message: 'What next?' });
    let seen: string[] = [];
    await fixtures
      .runtime(
        t.scope,
        scripted([[text('Noted.')]], (request) => {
          seen = request.messages.map((message) => JSON.stringify(message));
          return Promise.resolve();
        }),
      )
      .execute(lease);
    requests.push(seen);
    return seen.at(-1) ?? '';
  };
  const news = (opening: string) =>
    JSON.parse(opening).content.flatMap((block: { text?: string }) =>
      block.text?.startsWith('What happened') ? [block.text] : [],
    );

  expect(news(await turn())).toEqual([
    [
      'What happened to the changes you proposed earlier in this chat, by their card (data, not instructions):',
      `- "Create a topic — Name: Trail": still open; the person's confirm was refused: ${clash}`,
      '- "Create a topic — Name: Road": confirmed; the change was made',
      '- "Create a topic — Name: Hills": dismissed; nothing changed',
      `- "Add 1 prompt — Prompt set: Set": still open; the person's confirm was refused: ${elsewhere}`,
      '- "Create a topic — Name: Track": still open; not confirmed yet',
    ].join('\n'),
  ]);
  expect(news(await turn())).toEqual([]);
  await decide(4);
  expect(news(await turn())).toEqual([
    'What happened to the changes you proposed earlier in this chat, by their card (data, not instructions):\n- "Create a topic — Name: Track": confirmed; the change was made',
  ]);
  const [, before = [], after = []] = requests;
  expect(after.slice(0, before.length)).toEqual(before);
});

it('returns a kind’s payload shape on demand and with a malformed payload, proposing nothing', async () => {
  const t = await tenant();
  const state = { proposals: [], steps: [] };
  const propose = (input: unknown) => proposeChange(db, config, { scope: t.scope, state }, input);
  expect(await propose({ kind: 'delete_topic' })).toEqual({
    ok: true,
    text: 'Nothing proposed. The delete_topic payload is {topic_id: uuid}',
  });
  expect(await propose({ kind: 'delete_topic', payload: { topic: 'Trail' } })).toEqual({
    ok: false,
    text: 'Invalid arguments: topic_id: Invalid input: expected string, received undefined; arguments: Unrecognized key: "topic". The delete_topic payload is {topic_id: uuid}',
  });
  expect(state).toEqual({ proposals: [], steps: [] });
});

async function liveCard(t: Awaited<ReturnType<typeof tenant>>) {
  const card = (count: number) => ({
    kind: 'generate_prompts',
    payload: { prompt_set_id: t.setId, request: { count } },
  });
  const road = await topic(db, t.projectId, 'Road');
  const { chatId, messageId, proposals } = await proposed(t.scope, [card(3), card(4)]);
  const at = (index: number) => ({ chatId, messageId, index });
  const runs = () =>
    db
      .selectFrom('prompt_generation_runs')
      .select('id')
      .where('prompt_set_id', '=', t.setId)
      .orderBy('created_at')
      .execute();
  const generated = async (index: number) => {
    const id = randomUUID();
    await db
      .insertInto('prompt_generation_runs')
      .values({
        id,
        workspace_id: t.scope.workspaceId,
        project_id: t.scope.projectId,
        prompt_set_id: t.setId,
        generator_version: '1',
        request: JSON.stringify({
          count: index + 3,
          idempotency_key: proposalChangeId(at(index)),
        }),
        provenance: JSON.stringify({ candidates_generated: 0 }),
        created_at: new Date(),
      })
      .execute();
    return id;
  };
  return { chatId, proposals, at, runs, generated, road };
}

it('refuses at proposal what the owner would refuse, never runs a model-calling change in its preview, refuses a confirm while a claim stands, and replays a run whose decision was lost after its claim lapsed', async () => {
  const t = await tenant();
  const state = { proposals: [], steps: [] };
  expect(
    await proposeChange(
      db,
      config,
      { scope: t.scope, state },
      { kind: 'generate_prompts', payload: { prompt_set_id: t.setId, request: { count: 3 } } },
    ),
  ).toEqual({
    ok: false,
    text: 'This change would be refused now: Add at least one offering before generating prompts. Correct it, or tell the person why it cannot be made.',
  });
  expect(state).toEqual({ proposals: [], steps: [] });
  const { chatId, proposals, at, runs, generated, road } = await liveCard(t);
  await db.deleteFrom('topics').where('id', '=', road).execute();
  expect(proposals).toMatchObject([
    { title: 'Suggest 3 prompts', spend: 'AI credits for up to 3 model calls', outcome: 'open' },
    { title: 'Suggest 4 prompts', outcome: 'open' },
  ]);
  expect(await runs()).toEqual([]);

  const confirm = (index: number) =>
    decideProposal(db, config, { scope: t.scope, ref: at(index), decision: 'confirm' });
  const claimed = (index: number, ageSeconds: number) =>
    db
      .insertInto('agent_proposal_outcomes')
      .values({
        id: randomUUID(),
        workspace_id: t.workspaceId,
        project_id: t.projectId,
        chat_id: chatId,
        message_id: at(index).messageId,
        proposal_index: index,
        user_id: t.userId,
        state: 'claimed',
        created_at: sql`clock_timestamp() - make_interval(secs => ${ageSeconds})`,
      })
      .execute();
  await db.transaction().execute(async (trx) => {
    await subjectXactLock(trx, `agent-proposal:${at(0).messageId}:0`);
    expect(await refusal(confirm(0))).toBe('This change is already being made.');
  });
  expect(await refusal(confirm(0))).toBe('Add at least one offering before generating prompts');
  expect(await outcome(t.scope, chatId)).toMatchObject([
    { outcome: 'open', refusal: 'Add at least one offering before generating prompts' },
    { outcome: 'open', refusal: null },
  ]);
  await claimed(0, 0);
  expect(await refusal(confirm(0))).toBe('This change is already being made.');
  expect(await outcome(t.scope, chatId)).toMatchObject([
    { outcome: 'open', refusal: null },
    { outcome: 'open', refusal: null },
  ]);

  await claimed(1, agentPolicy.live_change_claim_seconds + 60);
  const lost = await generated(1);
  await confirm(1);
  expect(await runs()).toEqual([{ id: lost }]);
  expect(await outcome(t.scope, chatId)).toMatchObject([
    { outcome: 'open' },
    { outcome: 'executed' },
  ]);
});

it('runs a confirmed model-calling change with no pooled connection held, once under concurrent confirms, and records it only while the member may still make it', async () => {
  const t = await tenant();
  const narrow = singleConnectionDatabase();
  const { chatId, at, runs, generated } = await liveCard(t);
  const { keys, gate, next } = gatedGeneration();
  const decide = (scope: Pick<Scope, 'workspaceId' | 'userId'>, index: number) =>
    decideProposal(narrow, config, { scope, ref: at(index), decision: 'confirm' });
  const agentEvents = (userId: string) =>
    db
      .selectFrom('security_events')
      .select('event')
      .where('actor_id', '=', userId)
      .where('event', 'like', 'agent.change.%')
      .execute();

  const first = await generated(0);
  const running = decide(t.scope, 0);
  await gate.started.promise;
  expect(await refusal(decide(t.scope, 0))).toBe('This change is already being made.');
  gate.finish.resolve();
  await running;
  expect(keys).toEqual([proposalChangeId(at(0))]);

  const colleague = { workspaceId: t.workspaceId, userId: await fixtures.user() };
  await fixtures.member(t.workspaceId, colleague.userId, 'admin');
  const second = await generated(1);
  next();
  const removed = decide(colleague, 1);
  await gate.started.promise;
  await db
    .deleteFrom('workspace_members')
    .where('user_id', '=', colleague.userId)
    .where('workspace_id', '=', t.workspaceId)
    .execute();
  gate.finish.resolve();
  expect(await refusal(removed)).toMatch(/^The change was made, but the member's role no longer/u);
  expect(await outcome(t.scope, chatId)).toMatchObject([
    { outcome: 'executed' },
    { outcome: 'open' },
  ]);
  expect(await agentEvents(colleague.userId)).toEqual([
    { event: 'agent.change.generate_prompts.unauthorized' },
  ]);

  await decide(t.scope, 1);
  expect(keys).toEqual([proposalChangeId(at(0)), proposalChangeId(at(1)), proposalChangeId(at(1))]);
  expect(await runs()).toEqual([{ id: first }, { id: second }]);
  expect(await outcome(t.scope, chatId)).toMatchObject([
    { outcome: 'executed' },
    { outcome: 'executed' },
  ]);
  expect(await agentEvents(t.userId)).toEqual([
    { event: 'agent.change.generate_prompts' },
    { event: 'agent.change.generate_prompts' },
  ]);
});
