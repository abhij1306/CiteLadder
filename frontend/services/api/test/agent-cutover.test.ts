import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { sql } from 'kysely';
import { z } from 'zod';
import { createApp } from '../src/app.ts';
import { createAgentBindings } from '../src/agent/bindings.ts';
import * as bindingsOwner from '../src/agent/bindings.ts';
import { ModelCalls } from '../src/agent/model-calls.ts';
import { recoveryReply } from '../src/agent/messages.ts';
import { AgentWorker } from '../src/workers/agent-worker.ts';
import {
  AgentFixtures,
  agentPolicy,
  reply,
  request,
  save,
  scripted,
  toolUse,
  zeroFunding,
} from './agent-support.ts';
import { TEST_SESSION_COOKIE, sessionToken, testConfig, testDatabase } from './support.ts';
import {
  agentTurnAcceptedSchema,
  agentChatDetailSchema,
  agentRevisionsPageSchema,
  agentChatsPageSchema,
  agentTurnEventSchema,
} from '@citeladder/contracts/agent';

describe('served Agent cutover on PostgreSQL', () => {
  const db = testDatabase(),
    fixtures = new AgentFixtures(db),
    config = testConfig(),
    app = createApp(config, db);
  afterAll(async () => {
    vi.restoreAllMocks();
    await fixtures.cleanup();
    await db.destroy();
  });
  async function setup() {
    const scope = await fixtures.scope(),
      bindings = await createAgentBindings(db, {});
    bindings.store.dependencies.admission = fixtures.store().dependencies.admission;
    bindings.runtime.deps.models = new ModelCalls(db, zeroFunding);
    bindings.runtime.deps.modelFor = () =>
      scripted([save('outline', 'Requested document', { format_id: 'content_page' })]);
    bindings.models = bindings.runtime.deps.models;
    vi.spyOn(bindingsOwner, 'agentBindings').mockResolvedValue(bindings);
    const token = await sessionToken({ sub: scope.userId, ver: 0 });
    const headers = {
      cookie: `${TEST_SESSION_COOKIE}=${token}`,
      'X-Workspace-Id': scope.workspaceId,
      'Content-Type': 'application/json',
    };
    return {
      scope,
      bindings,
      headers,
      worker: new AgentWorker(db, bindings, scope.workspaceId),
    };
  }
  /** Accepts one message and opens the browser's stream for its turn. */
  async function startTurn(projectId: string, headers: Record<string, string>) {
    const accepted = agentTurnAcceptedSchema.parse(
      await (
        await app.request(`/api/v1/projects/${projectId}/agent/chats`, {
          method: 'POST',
          headers: { ...headers, 'Idempotency-Key': randomUUID() },
          body: JSON.stringify({ message: 'Explain our visibility' }),
        })
      ).json(),
    );
    const response = await app.request(
      `/api/v1/agent/chats/${accepted.chat_id}/runs/${accepted.run.id}/run`,
      { method: 'POST', headers: { ...headers, Accept: 'text/event-stream' } },
    );
    return { accepted, response };
  }
  it('streams thinking, tool states, the document and the reply, then saves the same reply', async () => {
    const { scope, bindings, headers } = await setup();
    const long = `Here is the answer. ${'Detail. '.repeat(40)}`.trim();
    bindings.runtime.deps.modelFor = () =>
      scripted([
        [
          { type: 'thinking', thinking: 'Choosing a method', signature: 'sig' },
          toolUse('load_skill', { skill_id: 'content_create' }, 'call_skill'),
        ],
        save('outline', 'Outline body', { format_id: 'content_page' }),
        reply(long),
      ]);
    const { accepted, response } = await startTurn(scope.projectId, headers);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const events = (await response.text())
      .split('\n\n')
      .filter((frame) => frame.startsWith('data: '))
      .map((frame) => agentTurnEventSchema.parse(JSON.parse(frame.slice(6))));
    expect(events.slice(0, -1)).toEqual([
      { type: 'step', ordinal: 1 },
      { type: 'thinking', ordinal: 1, text: 'Choosing a method' },
      { type: 'tool', ordinal: 1, call_id: 'call_skill', tool: 'load_skill', status: 'started' },
      { type: 'tool', ordinal: 1, call_id: 'call_skill', tool: 'load_skill', status: 'completed' },
      { type: 'step', ordinal: 2 },
      { type: 'document_delta', ordinal: 2, title: 'Document', body: 'Outline body' },
      {
        type: 'tool',
        ordinal: 2,
        call_id: expect.any(String),
        tool: 'save_document',
        status: 'started',
      },
      {
        type: 'tool',
        ordinal: 2,
        call_id: expect.any(String),
        tool: 'save_document',
        status: 'completed',
      },
      { type: 'step', ordinal: 3 },
      { type: 'reply_delta', ordinal: 3, text: long.slice(0, Math.ceil(long.length / 2)) },
      { type: 'reply_delta', ordinal: 3, text: long.slice(Math.ceil(long.length / 2)) },
    ]);
    expect(events.at(-1)).toMatchObject({ type: 'done', run: { status: 'succeeded' } });
    const detail = agentChatDetailSchema.parse(
      await (await app.request(`/api/v1/agent/chats/${accepted.chat_id}`, { headers })).json(),
    );
    expect(detail.messages.at(-1)?.content).toBe(
      `${long}\n\nOutline saved in Website page format. Approve it before requesting a draft.`,
    );
    expect(detail.output?.latest_revision?.body).toBe('Outline body');
    // A second request for the finished turn never executes it again.
    const again = await app.request(
      `/api/v1/agent/chats/${accepted.chat_id}/runs/${accepted.run.id}/run`,
      { method: 'POST', headers: { ...headers, Accept: 'text/event-stream' } },
    );
    expect((await again.text()).match(/"type":"(\w+)"/gu)).toEqual(['"type":"done"']);
  });
  it('ends the turn as interrupted when the browser closes its stream', async () => {
    const { scope, bindings, headers } = await setup();
    let started!: () => void;
    const calling = new Promise<void>((resolve) => {
      started = resolve;
    });
    bindings.runtime.deps.modelFor = () => ({
      ...scripted([]),
      // The model answers only when the turn is stopped.
      converse: (_request, signal) =>
        new Promise((_resolve, reject) => {
          started();
          signal?.addEventListener('abort', () => reject(signal.reason));
        }),
    });
    const { accepted, response } = await startTurn(scope.projectId, headers);
    await calling;
    await response.body?.cancel();
    await vi.waitFor(async () =>
      expect(await fixtures.run(accepted.run.id)).toMatchObject({
        status: 'failed',
        error_code: 'interrupted',
      }),
    );
    const detail = agentChatDetailSchema.parse(
      await (await app.request(`/api/v1/agent/chats/${accepted.chat_id}`, { headers })).json(),
    );
    expect(detail.messages.at(-1)?.content).toBe(recoveryReply('interrupted'));
  });
  it('projects only public skill metadata on the raw HTTP wire', async () => {
    const { headers } = await setup();
    const response = await app.request('/api/v1/agent/skills', { headers });
    expect(response.status).toBe(200);
    const raw = z
      .object({ skills: z.array(z.record(z.string(), z.unknown())) })
      .parse(await response.json());
    expect(raw.skills.length).toBeGreaterThan(0);
    for (const skill of raw.skills)
      expect(Object.keys(skill).sort()).toEqual([
        'description',
        'group',
        'id',
        'label',
        'output_kind',
      ]);
    expect(raw.skills.find((skill) => skill.id === 'content_create')).toMatchObject({
      output_kind: 'content',
    });
  });
  it('serves instructions, a queued outline, optimistic edits, restoration and archive without model calls on reads', async () => {
    const { scope, headers, worker } = await setup();
    const instructions = `/api/v1/projects/${scope.projectId}/agent/instructions`;
    expect(
      (
        await app.request(instructions, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ text: 'Use reviewed facts' }),
        })
      ).status,
    ).toBe(200);
    const response = await app.request(`/api/v1/projects/${scope.projectId}/agent/chats`, {
      method: 'POST',
      headers: { ...headers, 'Idempotency-Key': randomUUID() },
      body: JSON.stringify({
        message: 'Écrivez un plan',
        skill_id: 'content_create',
        context: { target_url: null },
      }),
    });
    expect(response.status).toBe(202);
    const accepted = agentTurnAcceptedSchema.parse(await response.json()),
      chat = `/api/v1/agent/chats/${accepted.chat_id}`;
    const before = await app.request(chat, { headers });
    expect(before.status).toBe(200);
    expect(agentChatDetailSchema.parse(await before.json()).latest_run?.status).toBe('queued');
    // The runner never executes a turn; the browser's run request does.
    expect(await worker.runOnce()).toBe(0);
    // It is due for the lane only once no stream has claimed it within the grace.
    const { available_at } = await db
      .selectFrom('agent_runs')
      .select('available_at')
      .where('id', '=', accepted.run.id)
      .executeTakeFirstOrThrow();
    expect((await worker.nextDue())?.getTime()).toBe(
      new Date(available_at).getTime() + agentPolicy.unclaimed_grace_seconds * 1000,
    );
    expect(
      (await app.request(`${chat}/runs/${accepted.run.id}/run`, { method: 'POST', headers }))
        .status,
    ).toBe(200);
    const detail = agentChatDetailSchema.parse(await (await app.request(chat, { headers })).json());
    expect(detail.latest_run?.status).toBe('succeeded');
    expect(detail.output?.latest_revision?.phase).toBe('outline');
    const revisionId = detail.output!.latest_revision!.id;
    const edit = { base_revision_id: revisionId, title: 'Revised title', body: 'Reviewed outline' };
    const edited = await app.request(`${chat}/output/revisions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(edit),
    });
    expect(edited.status).toBe(201);
    expect(
      (
        await app.request(`${chat}/output/revisions`, {
          method: 'POST',
          headers,
          body: JSON.stringify(edit),
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await app.request(`${chat}/output/revisions/${revisionId}/restore`, {
          method: 'POST',
          headers,
        })
      ).status,
    ).toBe(201);
    expect(
      agentRevisionsPageSchema.parse(
        await (await app.request(`${chat}/output/revisions`, { headers })).json(),
      ).items,
    ).toHaveLength(3);
    expect((await app.request(chat, { method: 'DELETE', headers })).status).toBe(204);
    const list = await app.request(`/api/v1/projects/${scope.projectId}/agent/chats`, { headers });
    expect(agentChatsPageSchema.parse(await list.json()).items).toEqual([]);
  });
  it('ends an expired claim as interrupted, fences cancellation and refuses foreign chat reads', async () => {
    const { scope, bindings, headers, worker } = await setup();
    const run = await bindings.store.enqueue(scope, {
      message: 'Write a plan',
      key: randomUUID(),
      skillId: 'content_create',
    });
    const claimed = await bindings.queue.claim('lost-worker', [scope.workspaceId]);
    expect(claimed?.id).toBe(run.id);
    await db
      .updateTable('agent_runs')
      .set({ lease_expires_at: sql<Date>`clock_timestamp() - interval '1 second'` })
      .where('workspace_id', '=', scope.workspaceId)
      .where('id', '=', run.id)
      .execute();
    expect(await worker.runOnce()).toBe(1);
    expect(await fixtures.run(run.id)).toMatchObject({
      status: 'failed',
      error_code: 'interrupted',
    });
    const next = await bindings.store.enqueue(scope, {
      message: 'Continue',
      key: randomUUID(),
      chatId: run.chat_id,
    });
    const dispatch = await bindings.queue.claim('cancel-worker', [scope.workspaceId]);
    const lease = await bindings.queue.start(dispatch!, 'cancel-worker');
    const model = scripted([]);
    const attempt = await bindings.models.dispatch(lease, 1, model, request);
    expect(
      (
        await app.request(`/api/v1/agent/chats/${run.chat_id}/runs/${next.id}/cancel`, {
          method: 'POST',
          headers,
        })
      ).status,
    ).toBe(200);
    expect(await worker.runOnce()).toBe(0);
    await db
      .updateTable('agent_model_attempts')
      .set({ deadline_at: sql<Date>`clock_timestamp() - interval '1 hour'` })
      .where('workspace_id', '=', scope.workspaceId)
      .where('id', '=', attempt.id)
      .execute();
    expect(await worker.runOnce()).toBe(0);
    expect(
      await db
        .selectFrom('agent_model_attempts')
        .select(['outcome', 'settlement_status'])
        .where('id', '=', attempt.id)
        .executeTakeFirst(),
    ).toMatchObject({ outcome: 'recovered_unknown', settlement_status: 'zero_debit' });
    const other = await fixtures.scope();
    const foreignHeaders = {
      ...headers,
      'X-Workspace-Id': other.workspaceId,
      cookie: `${TEST_SESSION_COOKIE}=${await sessionToken({ sub: other.userId, ver: 0 })}`,
    };
    expect(
      (await app.request(`/api/v1/agent/chats/${run.chat_id}`, { headers: foreignHeaders })).status,
    ).toBe(404);
    expect(
      (
        await app.request(`/api/v1/projects/${scope.projectId}/readiness`, {
          headers: foreignHeaders,
        })
      ).status,
    ).toBe(404);
    const readiness = await app.request(`/api/v1/projects/${scope.projectId}/readiness`, {
      headers,
    });
    expect(readiness.status).toBe(200);
    expect(await readiness.json()).toMatchObject({
      stage: 'not_connected',
      has_performance_snapshot: false,
    });
  });
});
