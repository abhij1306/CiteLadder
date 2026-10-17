import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { testDatabase } from './support.ts';
import {
  AgentFixtures,
  catalog,
  emptyPackage,
  loadSkill,
  read,
  reply,
  request,
  result,
  save,
  scripted,
  text,
  toolUse,
  zeroFunding,
  agentPolicy,
  type Response,
} from './agent-support.ts';
import { AgentError } from '../src/agent/contracts.ts';
import { AgentQueue, lockRun } from '../src/agent/queue.ts';
import { AgentOutputs } from '../src/agent/outputs.ts';
import { ModelCalls, type ModelRequest } from '../src/agent/model-calls.ts';
import { readChat, listChats, listRevisions, progress } from '../src/agent/reads.ts';
import { appendMessage, getChat, recoveryReply } from '../src/agent/messages.ts';
import { ToolRegistry } from '../src/agent/tools.ts';
import { contextCitations, manifestSchema, suppliedManifest } from '../src/agent/context.ts';
import { bounded } from '../src/agent/runtime.ts';
import { scrubRecordRefs } from '../src/agent/sources.ts';
import { parseWorkflows } from '../src/agent/workflows.ts';
import { fingerprint } from '../src/crypto-text.ts';
import { readAgentContext } from '../src/agent/context-adapter.ts';
import { runAgentOnce } from '../src/agent/worker.ts';
import { loadSkillCatalog } from '../src/agent/skills.ts';
import { agentSettings } from '../src/agent/config.ts';

/** The tool results a request returned to the model, in call order. */
function toolResults(sent: ModelRequest) {
  return (sent.messages.at(-1)?.content ?? []).filter((block) => block.type === 'tool_result');
}
/** The plain text blocks of a request's newest message. */
function texts(sent: ModelRequest) {
  return (sent.messages.at(-1)?.content ?? []).flatMap((block) =>
    block.type === 'text' ? [String(block.text)] : [],
  );
}

describe('Agent runtime on PostgreSQL', () => {
  const db = testDatabase();
  const fixtures = new AgentFixtures(db);
  /** Lets the run's lease lapse, then lets recovery end it. */
  async function expireAndRecover(
    queue: AgentQueue,
    workspaceId: string,
    runId: string,
    models: ModelCalls,
  ) {
    await db
      .updateTable('agent_runs')
      .set({ lease_expires_at: new Date(0) })
      .where('id', '=', runId)
      .execute();
    await queue.recover([workspaceId], 1, agentPolicy.unclaimed_grace_seconds, (trx, row) =>
      models.reconcile(trx, row),
    );
  }
  /** Overrides part of a queued run's frozen budget. */
  async function budget(run: { id: string; budget: unknown }, changes: Record<string, number>) {
    await db
      .updateTable('agent_runs')
      .set({ budget: { ...(run.budget as object), ...changes } })
      .where('id', '=', run.id)
      .execute();
  }
  function toolAttempts(runId: string) {
    return db
      .selectFrom('agent_tool_attempts')
      .select(['ordinal', 'call_id', 'status', 'error_code', 'input'])
      .where('run_id', '=', runId)
      .orderBy('ordinal')
      .orderBy('call_id')
      .execute();
  }
  afterAll(async () => {
    await fixtures.cleanup();
    await db.destroy();
  });

  it('serializes same-key races and refuses a changed full request or a second active turn', async () => {
    const scope = await fixtures.scope();
    const store = fixtures.store();
    const request = { key: randomUUID(), message: 'Help with a plan', skillId: 'plan' };
    const [a, b] = await Promise.all([
      store.enqueue(scope, request),
      store.enqueue(scope, request),
    ]);
    expect(a.id).toBe(b.id);
    const detail = await readChat(db, scope, a.chat_id);
    expect(detail.messages.map((message) => message.role)).toEqual(['user']);
    await expect(
      store.enqueue(scope, { ...request, message: 'Changed request' }),
    ).rejects.toMatchObject({ code: 'agent_idempotency_conflict' });
    await expect(
      store.enqueue(scope, { key: randomUUID(), message: 'Another turn', chatId: a.chat_id }),
    ).rejects.toMatchObject({ code: 'agent_run_active' });
    expect(fingerprint({ b: 2, a: { z: 1, y: 2 } })).toBe(fingerprint({ a: { y: 2, z: 1 }, b: 2 }));
  });
  it('rolls back chat and message when funding/context admission refuses; authorizes every Action', async () => {
    const scope = await fixtures.scope();
    const other = await fixtures.scope();
    await expect(
      fixtures
        .store({
          admission: async () => {
            throw new AgentError('funding_unavailable');
          },
        })
        .enqueue(scope, { key: randomUUID(), message: 'Request' }),
    ).rejects.toMatchObject({ code: 'funding_unavailable' });
    await expect(
      fixtures
        .store()
        .enqueue(scope, { key: randomUUID(), message: 'Request', mentionIds: [randomUUID()] }),
    ).rejects.toMatchObject({ code: 'agent_context_unavailable' });
    expect(await listChats(db, scope)).toMatchObject({ items: [] });
    const run = await fixtures
      .store()
      .enqueue(other, { key: randomUUID(), message: 'Other workspace' });
    await expect(readChat(db, scope, run.chat_id)).rejects.toMatchObject({ status: 404 });
    await expect(
      fixtures
        .store()
        .enqueue(
          { ...scope, projectId: other.projectId },
          { key: randomUUID(), message: 'Foreign project' },
        ),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('refuses an idempotency replay across projects in the same workspace', async () => {
    const scope = await fixtures.scope();
    const projectId = await fixtures.project(scope.workspaceId);
    const store = fixtures.store();
    const initial = await store.enqueue(scope, { key: randomUUID(), message: 'Question' });
    await store.cancel(scope, initial.chat_id, initial.id);
    const request = { key: randomUUID(), message: 'Follow up', chatId: initial.chat_id };
    const run = await store.enqueue(scope, request);
    await expect(store.enqueue({ ...scope, projectId }, request)).rejects.toMatchObject({
      status: 404,
    });
    expect((await store.enqueue(scope, request)).id).toBe(run.id);
  });
  it('refuses another active member replaying a workspace key', async () => {
    const scope = await fixtures.scope();
    const userId = await fixtures.user();
    await fixtures.member(scope.workspaceId, userId, 'member');
    const request = { key: randomUUID(), message: 'Private submission' };
    const run = await fixtures.store().enqueue(scope, request);
    await expect(fixtures.store().enqueue({ ...scope, userId }, request)).rejects.toMatchObject({
      code: 'agent_idempotency_conflict',
    });
    expect((await readChat(db, scope, run.chat_id)).messages).toHaveLength(1);
  });
  it('distinguishes inherited selection, clearing a pin and changing output kind', async () => {
    const scope = await fixtures.scope();
    const first = await fixtures.claimed(scope, { skillId: 'plan' });
    await fixtures.runtime(scope, scripted([save('final')])).execute(first.lease);
    const cleared = await fixtures.store().enqueue(scope, {
      chatId: first.run.chat_id,
      key: randomUUID(),
      message: 'Explain the plan',
      skillId: null,
    });
    expect((await readChat(db, scope, first.run.chat_id)).pinned_skill_id).toBeNull();
    const key = randomUUID();
    await fixtures.store().cancel(scope, cleared.chat_id, cleared.id);
    const inherited = await fixtures
      .store()
      .enqueue(scope, { chatId: cleared.chat_id, key, message: 'Question' });
    await expect(
      fixtures
        .store()
        .enqueue(scope, { chatId: cleared.chat_id, key, message: 'Question', skillId: null }),
    ).rejects.toMatchObject({ code: 'agent_idempotency_conflict' });
    await fixtures.store().cancel(scope, inherited.chat_id, inherited.id);
    await expect(
      fixtures.store().enqueue(scope, {
        chatId: inherited.chat_id,
        key: randomUUID(),
        message: 'Change kind',
        skillId: 'content',
      }),
    ).rejects.toMatchObject({ code: 'agent_skill_kind_conflict' });
    expect((await readChat(db, scope, inherited.chat_id)).output?.kind).toBe('plan');
  });
  it('replays an earlier turn exactly as stored, thinking and compaction included, without resupplying its context', async () => {
    const scope = await fixtures.scope();
    const first = await fixtures.claimed(scope, { message: 'Prior question' });
    const thinking = { type: 'thinking', thinking: 'Weighing the evidence', signature: 'sig-1' };
    const compaction = { type: 'compaction', content: 'Summary of the earlier work' };
    const call = toolUse('read_evidence', {}, 'call_prior');
    await fixtures
      .runtime(
        scope,
        scripted([
          [thinking, call],
          [compaction, text('Prior answer')],
        ]),
      )
      .execute(first.lease);
    const second = await fixtures.claimed(scope, {
      chatId: first.run.chat_id,
      message: 'Follow up',
    });
    const sent: ModelRequest[] = [];
    await fixtures
      .runtime(
        scope,
        scripted([reply('Next answer')], async (request) => {
          sent.push(request);
        }),
      )
      .execute(second.lease);
    expect(sent[0]?.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: expect.stringContaining('Context selected for this chat') },
          { type: 'text', text: 'Prior question' },
        ],
      },
      { role: 'assistant', content: [thinking, call] },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'call_prior', content: '{"observed":0}' }],
      },
      { role: 'assistant', content: [compaction, text('Prior answer')] },
      { role: 'user', content: [text('Follow up')] },
    ]);
    // Transcripts are run records for replay; no chat read returns them.
    const detail = await readChat(db, scope, first.run.chat_id);
    expect(detail.messages.map((message) => message.content)).toEqual([
      'Prior question',
      'Prior answer',
      'Follow up',
      'Next answer',
    ]);
    expect(JSON.stringify(detail)).not.toContain('Weighing the evidence');
  });
  it('sends the same tool and system prefix on every call and in every chat', async () => {
    const scope = await fixtures.scope();
    const prefixes = new Set<string>();
    for (const skillId of [undefined, 'plan']) {
      const { lease } = await fixtures.claimed(scope, { skillId });
      await fixtures
        .runtime(
          scope,
          scripted([read(), reply()], async (sent) => {
            prefixes.add(JSON.stringify({ system: sent.system, tools: sent.tools }));
          }),
        )
        .execute(lease);
    }
    expect(prefixes.size).toBe(1);
    const prefix = z
      .object({ tools: z.array(z.object({ name: z.string() })) })
      .parse(JSON.parse([...prefixes][0]!));
    expect(prefix.tools.map((tool) => tool.name)).toEqual([
      'load_skill',
      'read_evidence',
      'save_document',
    ]);
  });

  it('discloses processing versions and distinguishes an unavailable saved manifest', async () => {
    const scope = await fixtures.scope();
    const { run } = await fixtures.claimed(scope);
    const manifest = manifestSchema.parse(run.context_manifest);
    await db
      .updateTable('agent_runs')
      .set({
        context_manifest: {
          ...manifest,
          package: { ...manifest.package, summary: { selection_policy_version: 'selection-1' } },
        },
      })
      .where('id', '=', run.id)
      .execute();
    expect((await readChat(db, scope, run.chat_id)).context.prompt).toMatchObject({
      context_version: manifest.version,
      package_version: manifest.package.version,
      selection_policy_version: 'selection-1',
    });
    await db
      .updateTable('agent_runs')
      .set({ context_manifest: {} })
      .where('id', '=', run.id)
      .execute();
    expect((await readChat(db, scope, run.chat_id)).context.limitations).toContainEqual({
      reason: 'context_manifest_unavailable',
    });
  });

  it('supplies a pinned packaged methodology in the opening message and saves its document as an outline', async () => {
    const scope = await fixtures.scope();
    const packaged = await loadSkillCatalog(agentSettings({}).skillsDirectory);
    const run = await fixtures.store({ catalog: packaged }).enqueue(scope, {
      key: randomUUID(),
      message: 'Build a portfolio of distinct buyer questions. Keep the existing topics.',
      skillId: 'prompt_discovery',
    });
    const queue = new AgentQueue(db, 30);
    const claimed = await queue.claim('prompt-worker', [scope.workspaceId]);
    const lease = await queue.start(claimed!, 'prompt-worker');
    const opening: string[] = [];
    await fixtures
      .runtime(
        scope,
        scripted(
          [read(), save('draft', 'Coverage plan grounded in the current portfolio.')],
          async (sent, ordinal) => {
            if (ordinal === 1) opening.push(...texts(sent));
          },
        ),
        { catalog: packaged },
      )
      .execute(lease);
    expect(opening.at(-1)).toBe(
      'Build a portfolio of distinct buyer questions. Keep the existing topics.',
    );
    expect(opening.some((block) => block.startsWith('Methodology: prompt_discovery'))).toBe(true);
    const detail = await readChat(db, scope, run.chat_id);
    expect(detail.latest_run?.status).toBe('succeeded');
    expect(detail.output).toMatchObject({
      skill_id: 'prompt_discovery',
      kind: 'prompt_portfolio',
      phase: 'outline',
      latest_revision: { source_refs: [`citeladder://project/${scope.projectId}`] },
    });
  });

  it('refuses a save before a methodology, an unknown or second methodology and a second save, then commits the first', async () => {
    const scope = await fixtures.scope();
    const { run, lease } = await fixtures.claimed(scope);
    const sent: ModelRequest[] = [];
    await fixtures
      .runtime(
        scope,
        scripted(
          [
            save(),
            loadSkill('unknown'),
            loadSkill('plan'),
            [...save('final', 'First'), ...save('final', 'Second')],
            loadSkill('content'),
            reply('The plan is ready.'),
          ],
          async (request) => {
            sent.push(request);
          },
        ),
      )
      .execute(lease);
    const results = sent.slice(1).map((request) =>
      toolResults(request).map((block) => ({
        error: block.is_error === true,
        content: String(block.content),
      })),
    );
    expect(results[0]).toEqual([
      {
        error: true,
        content: 'Load the methodology with load_skill first, then save the document.',
      },
    ]);
    expect(results[1]).toEqual([
      { error: true, content: expect.stringMatching(/^Invalid arguments: skill_id/u) },
    ]);
    expect(results[2]).toEqual([
      { error: false, content: expect.stringContaining('Plan requested work.') },
    ]);
    expect(results[3]).toEqual([
      {
        error: false,
        content:
          'Staged the final; it is saved with your reply. Now reply briefly; do not repeat the document.',
      },
      {
        error: true,
        content: 'Save one document per step. The first save in this step was kept.',
      },
    ]);
    expect(results[4]).toEqual([
      {
        error: true,
        content:
          'This turn already uses the plan methodology. A different deliverable belongs in a new chat the user starts; suggest it as a next step.',
      },
    ]);
    const detail = await readChat(db, scope, run.chat_id);
    expect(detail.latest_run).toMatchObject({
      status: 'succeeded',
      skill_id: 'plan',
      skill_source: 'model',
      steps_used: 6,
    });
    expect(detail.output?.latest_revision?.body).toBe('First');
    expect(detail.messages.at(-1)?.content).toBe('The plan is ready.\n\nDocument saved.');
  });
  it('keeps a staged document out of the chat when the turn fails before its reply', async () => {
    const scope = await fixtures.scope();
    const { run, lease } = await fixtures.claimed(scope, { skillId: 'plan' });
    const base = scripted([save('final')]);
    let calls = 0;
    const model = {
      ...base,
      converse: (...args: Parameters<typeof base.converse>) =>
        calls++ === 0 ? base.converse(...args) : Promise.reject(new Error('Provider unavailable')),
    };
    await fixtures.runtime(scope, model).execute(lease);
    const detail = await readChat(db, scope, run.chat_id);
    expect(detail.latest_run).toMatchObject({ status: 'failed', error_code: 'provider_error' });
    expect(detail.output).toBeNull();
    expect(detail.messages.at(-1)?.content).toBe(recoveryReply('provider_error'));
    expect(
      await db
        .selectFrom('agent_run_transcripts')
        .select('id')
        .where('run_id', '=', run.id)
        .execute(),
    ).toEqual([]);
  });
  /** One turn of `skillId` under a catalog with a single long-form page format. */
  async function runWithPageFormat(skillId: string, responses: Response[]) {
    const scope = await fixtures.scope();
    const { run, lease } = await fixtures.claimed(scope, { skillId });
    const formats = new Map([
      ['page', { id: 'page', label: 'Website page', body: 'Write a page.', longForm: true }],
    ]);
    await fixtures
      .runtime(scope, scripted(responses), { catalog: { ...catalog, formats } })
      .execute(lease);
    return readChat(db, scope, run.chat_id);
  }
  it('refuses an unknown content format, then saves the outline in the corrected one', async () => {
    const detail = await runWithPageFormat('content', [
      save('draft', 'Requested document', { format_id: 'unknown' }),
      save('draft', 'Requested document', { format_id: 'page' }),
    ]);
    expect(detail.output).toMatchObject({ phase: 'outline', format_id: 'page' });
    expect(detail.messages.at(-1)?.content).toBe(
      'Answer from supplied evidence.\n\nOutline saved in Website page format. Approve it before requesting a draft.',
    );
    expect(detail.messages.filter((message) => message.role === 'agent')).toHaveLength(1);
  });
  it('saves a deliverable whose skill has no formats even when the model names one', async () => {
    const detail = await runWithPageFormat('plan', [
      save('draft', 'Requested document', { format_id: 'page' }),
    ]);
    expect(detail.latest_run).toMatchObject({ status: 'succeeded' });
    expect(detail.output).toMatchObject({ format_id: null });
    expect(detail.output?.latest_revision?.body).toBe('Requested document');
  });
  it('returns an invalid argument to the model as an error result, then records the corrected read', async () => {
    const scope = await fixtures.scope();
    const { run, lease } = await fixtures.claimed(scope, { skillId: 'plan' });
    const sent: ModelRequest[] = [];
    await fixtures
      .runtime(
        scope,
        scripted([read({ oops: 1 }), read(), reply()], async (request) => {
          sent.push(request);
        }),
      )
      .execute(lease);
    expect(toolResults(sent[1]!)).toEqual([
      expect.objectContaining({
        is_error: true,
        content: expect.stringMatching(/^Invalid arguments: .*oops/u),
      }),
    ]);
    expect(await toolAttempts(run.id)).toEqual([
      expect.objectContaining({
        ordinal: 1,
        status: 'refused',
        error_code: 'invalid_arguments',
        input: { oops: 1 },
      }),
      expect.objectContaining({ ordinal: 2, status: 'completed', error_code: '', input: {} }),
    ]);
    expect((await readChat(db, scope, run.chat_id)).latest_run).toMatchObject({
      status: 'succeeded',
    });
  });
  it('runs one response’s reads together, records each call and refuses reads past the parallel bound', async () => {
    const scope = await fixtures.scope();
    const { run, lease } = await fixtures.claimed(scope);
    await budget(run, { max_parallel_tool_calls: 2 });
    const sent: ModelRequest[] = [];
    const events: unknown[] = [];
    await fixtures
      .runtime(
        scope,
        scripted(
          [
            ['call_a', 'call_b', 'call_c'].map((id) => toolUse('read_evidence', {}, id)),
            reply('Both reads agree.'),
          ],
          async (request) => {
            sent.push(request);
          },
        ),
      )
      .execute(lease, undefined, { tool: (event) => events.push(event) });
    expect(
      (await toolAttempts(run.id)).map(({ call_id, status, error_code }) => [
        call_id,
        status,
        error_code,
      ]),
    ).toEqual([
      ['call_a', 'completed', ''],
      ['call_b', 'completed', ''],
      ['call_c', 'refused', 'parallel_limit'],
    ]);
    expect(
      toolResults(sent[1]!).map((block) => [block.tool_use_id, block.is_error ?? false]),
    ).toEqual([
      ['call_a', false],
      ['call_b', false],
      ['call_c', true],
    ]);
    expect(events).toHaveLength(6);
    expect(events).toEqual(
      expect.arrayContaining([
        { ordinal: 1, call_id: 'call_a', tool: 'read_evidence', status: 'completed' },
        { ordinal: 1, call_id: 'call_b', tool: 'read_evidence', status: 'completed' },
        { ordinal: 1, call_id: 'call_c', tool: 'read_evidence', status: 'refused' },
      ]),
    );
    // Each model call is followed by its reads, which are listed as they finished.
    const rows = (await progress(db, await fixtures.run(run.id))).map(
      ({ ordinal, tool, call_id }) => [ordinal, tool, call_id],
    );
    expect(rows).toHaveLength(5);
    expect([rows[0], rows[4]]).toEqual([
      [1, null, null],
      [2, null, null],
    ]);
    expect(rows.slice(1, 4)).toEqual(
      expect.arrayContaining([
        [1, 'read_evidence', 'call_a'],
        [1, 'read_evidence', 'call_b'],
        [1, 'read_evidence', 'call_c'],
      ]),
    );
  });

  it('claims once under contention and ends an expired turn as interrupted, never claiming it again', async () => {
    const scope = await fixtures.scope();
    const queued = await fixtures
      .store()
      .enqueue(scope, { key: randomUUID(), message: 'Question' });
    const queue = new AgentQueue(db, 30);
    const claims = await Promise.all(
      ['a', 'b'].map((owner) => queue.claim(owner, [scope.workspaceId])),
    );
    const claimed = claims.find((run) => run !== null)!;
    expect(claims.filter(Boolean)).toHaveLength(1);
    const lease = await queue.start(claimed, claimed.lease_owner!);
    expect(await queue.heartbeat(lease)).toBe(true);
    await db
      .updateTable('agent_runs')
      .set({ lease_expires_at: new Date(0) })
      .where('id', '=', queued.id)
      .execute();
    expect(await queue.heartbeat(lease)).toBe(false);
    await expect(db.transaction().execute((trx) => lockRun(trx, lease))).rejects.toMatchObject({
      code: 'lease',
    });
    const calls = new ModelCalls(db, zeroFunding);
    expect(
      await queue.recover([scope.workspaceId], 1, agentPolicy.unclaimed_grace_seconds, (trx, run) =>
        calls.reconcile(trx, run),
      ),
    ).toBe(1);
    // The stopped turn answers its request and is never replayed.
    expect(await fixtures.run(queued.id)).toMatchObject({
      status: 'failed',
      error_code: 'interrupted',
    });
    expect((await readChat(db, scope, queued.chat_id)).messages.at(-1)?.content).toBe(
      recoveryReply('interrupted'),
    );
    expect(await queue.claim(lease.owner, [scope.workspaceId])).toBeNull();
  });
  it('ends a run no stream claimed once its grace has passed', async () => {
    const scope = await fixtures.scope();
    const queued = await fixtures
      .store()
      .enqueue(scope, { key: randomUUID(), message: 'Question' });
    const queue = new AgentQueue(db, 30);
    const calls = new ModelCalls(db, zeroFunding);
    const recover = () =>
      queue.recover([scope.workspaceId], 1, agentPolicy.unclaimed_grace_seconds, (trx, run) =>
        calls.reconcile(trx, run),
      );
    // The browser that admitted it may still be opening its stream.
    expect(await recover()).toBe(0);
    await db
      .updateTable('agent_runs')
      .set({
        available_at: new Date(Date.now() - (agentPolicy.unclaimed_grace_seconds + 1) * 1000),
      })
      .where('id', '=', queued.id)
      .execute();
    expect(await recover()).toBe(1);
    expect(await fixtures.run(queued.id)).toMatchObject({
      status: 'failed',
      error_code: 'interrupted',
    });
  });
  it('contains start failure without dispatching the runtime', async () => {
    const scope = await fixtures.scope();
    await fixtures.store().enqueue(scope, { key: randomUUID(), message: 'Question' });
    const queue = new AgentQueue(db, 30);
    const runtime = fixtures.runtime(scope, scripted([reply()]));
    const start = vi.spyOn(queue, 'start').mockRejectedValueOnce(new AgentError('lease'));
    const execute = vi.spyOn(runtime, 'execute');
    try {
      expect(await runAgentOnce(queue, runtime, 'lost', [scope.workspaceId])).toBe(true);
      expect(execute).not.toHaveBeenCalled();
    } finally {
      start.mockRestore();
      execute.mockRestore();
    }
  });
  it('commits dispatch before model I/O, exposes progress, records read sources and appends a reply atomically', async () => {
    const scope = await fixtures.scope();
    const { run, lease } = await fixtures.claimed(scope);
    const uri = `citeladder://project/${scope.projectId}`;
    const fake = scripted(
      [
        [toolUse('load_skill', { skill_id: 'plan' }), toolUse('read_evidence', {}, 'call_read')],
        save('final', 'Use the supplied evidence.'),
        reply(`Read ${uri}; invented citeladder://project/${randomUUID()}.`),
      ],
      async (_request, ordinal) => {
        const committed = await db
          .selectFrom('agent_model_attempts')
          .selectAll()
          .where('run_id', '=', run.id)
          .where('ordinal', '=', ordinal)
          .executeTakeFirstOrThrow();
        expect(committed.outcome).toBe('dispatched');
        expect((await progress(db, await fixtures.run(run.id))).at(-1)).toMatchObject({
          status: 'working',
          ordinal,
          tool: null,
        });
      },
    );
    await fixtures.runtime(scope, fake).execute(lease);
    const detail = await readChat(db, scope, run.chat_id);
    expect(detail.latest_run).toMatchObject({
      status: 'succeeded',
      steps_used: 3,
      skill_id: 'plan',
    });
    // Sources are what the turn read; record references never reach the reader.
    expect(detail.messages.at(-1)).toMatchObject({
      role: 'agent',
      evidence_refs: [uri],
      content: 'Read; invented.\n\nDocument saved.',
      steps: [
        { kind: 'model', ordinal: 1 },
        { kind: 'skill', skill_id: 'plan' },
        {
          kind: 'tool',
          ordinal: 1,
          tool: 'read_evidence',
          status: 'completed',
          call_id: 'call_read',
        },
        { kind: 'model', ordinal: 2 },
        { kind: 'document' },
        { kind: 'model', ordinal: 3 },
      ],
    });
    expect(detail.output?.latest_revision).toMatchObject({ number: 1, source_refs: [uri] });
    expect(detail.output?.message_id).toBe(detail.messages.at(-1)?.id);
    const attempts = await db
      .selectFrom('agent_model_attempts')
      .selectAll()
      .where('run_id', '=', run.id)
      .execute();
    expect(attempts.map((attempt) => attempt.settlement_status)).toEqual([
      'zero_debit',
      'zero_debit',
      'zero_debit',
    ]);
    expect(
      attempts.every(
        (attempt) => attempt.request_hash.length === 64 && attempt.output_hash.length === 64,
      ),
    ).toBe(true);
  });
  it('settles a model cancelled in flight exactly once and answers with the stop, not a late reply', async () => {
    const scope = await fixtures.scope();
    const { run, lease } = await fixtures.claimed(scope);
    const settle = vi.fn(zeroFunding.settle);
    const models = new ModelCalls(db, { ...zeroFunding, settle });
    const fake = scripted([reply()], async () => {
      await fixtures.store().cancel(scope, run.chat_id, run.id);
    });
    await fixtures.runtime(scope, fake, { models }).execute(lease);
    const attempt = await db
      .selectFrom('agent_model_attempts')
      .selectAll()
      .where('run_id', '=', run.id)
      .executeTakeFirstOrThrow();
    await models.receipt(scope.workspaceId, attempt.id, result(reply('Duplicate receipt')));
    expect(settle).toHaveBeenCalledTimes(1);
    expect(
      (await readChat(db, scope, run.chat_id)).messages.map(({ role, content }) => [role, content]),
    ).toEqual([
      ['user', expect.any(String)],
      ['agent', recoveryReply('cancelled')],
    ]);
    expect((await fixtures.run(run.id)).status).toBe('cancelled');
  });
  it('reconciles a lost dispatch as unknown when recovery ends an expired turn', async () => {
    const scope = await fixtures.scope();
    const { run, lease, queue } = await fixtures.claimed(scope);
    const settle = vi.fn(async () => ({ credits: 0, status: 'zero_debit' }));
    const models = new ModelCalls(db, { ...zeroFunding, settle });
    const attempt = await models.dispatch(lease, 1, scripted([]), request);
    await expireAndRecover(queue, scope.workspaceId, run.id, models);
    // A late answer after recovery settles nothing twice.
    await models.receipt(scope.workspaceId, attempt.id, result(reply()));
    expect(settle).toHaveBeenCalledTimes(1);
    expect(
      await db
        .selectFrom('agent_model_attempts')
        .select('outcome')
        .where('id', '=', attempt.id)
        .executeTakeFirst(),
    ).toMatchObject({ outcome: 'recovered_unknown' });
    expect(await fixtures.run(run.id)).toMatchObject({
      status: 'failed',
      error_code: 'interrupted',
    });
    expect(await queue.claim('again', [scope.workspaceId])).toBeNull();
  });
  it('ends a turn once on a provider failure, with its reply and no replay', async () => {
    const scope = await fixtures.scope();
    const run = await fixtures
      .store()
      .enqueue(scope, { key: randomUUID(), message: 'Read and explain' });
    const queue = new AgentQueue(db, 30);
    let calls = 0;
    const model = {
      ...scripted([]),
      converse: async () => {
        calls++;
        throw new Error('Provider unavailable');
      },
    };
    await runAgentOnce(queue, fixtures.runtime(scope, model), 'provider', [scope.workspaceId]);
    expect(calls).toBe(1);
    expect(await fixtures.run(run.id)).toMatchObject({
      status: 'failed',
      error_code: 'provider_error',
    });
    expect(
      (await readChat(db, scope, run.chat_id)).messages.map(({ role, content }) => [role, content]),
    ).toEqual([
      ['user', expect.any(String)],
      ['agent', recoveryReply('provider_error')],
    ]);
    expect(await queue.claim('again', [scope.workspaceId])).toBeNull();
  });
  it('stops before dispatch for changed catalogs and removed members, with no model call', async () => {
    const scope = await fixtures.scope();
    const first = await fixtures.claimed(scope);
    let calls = 0;
    const model = scripted([], async () => {
      calls++;
    });
    await fixtures
      .runtime(scope, model, { catalog: { ...catalog, version: 'changed' } })
      .execute(first.lease);
    expect((await fixtures.run(first.run.id)).error_code).toBe('skills_changed');
    const second = await fixtures.claimed(scope);
    await db
      .updateTable('workspace_members')
      .set({ role: 'viewer' })
      .where('workspace_id', '=', scope.workspaceId)
      .execute();
    await fixtures.runtime(scope, model).execute(second.lease);
    expect((await fixtures.run(second.run.id)).error_code).toBe('access_revoked');
    expect(calls).toBe(0);
  });
  it.each([
    ['max_tokens', 'output_too_long'],
    ['refusal', 'model_refused'],
  ] as const)(
    'ends a response stopped by %s after one call, saving nothing',
    async (stop, code) => {
      const scope = await fixtures.scope();
      const { run, lease } = await fixtures.claimed(scope, { skillId: 'plan' });
      let calls = 0;
      const model = scripted([result(save(), { stop })], async () => {
        calls++;
      });
      await fixtures.runtime(scope, model).execute(lease);
      expect(calls).toBe(1);
      const detail = await readChat(db, scope, run.chat_id);
      expect(detail.latest_run).toMatchObject({ status: 'failed', error_code: code });
      expect(detail.messages.at(-1)?.content).toBe(recoveryReply(code));
      expect(detail.output).toBeNull();
    },
  );
  it('refuses a fixed project, an unknown tool and any call on the last step, then ends with the limit reply', async () => {
    const scope = await fixtures.scope();
    const { run, lease } = await fixtures.claimed(scope);
    await budget(run, { max_model_calls: 3 });
    const sent: ModelRequest[] = [];
    await fixtures
      .runtime(
        scope,
        scripted(
          [read({ project_id: randomUUID() }), read({}, 'unknown_tool'), read()],
          async (request) => {
            sent.push(request);
          },
        ),
      )
      .execute(lease);
    expect(
      (await toolAttempts(run.id)).map(({ status, error_code }) => [status, error_code]),
    ).toEqual([
      ['refused', 'invalid_arguments'],
      ['refused', 'unknown_tool'],
    ]);
    expect(toolResults(sent[1]!)).toEqual([
      expect.objectContaining({
        is_error: true,
        content: 'The project is fixed for this chat. Remove project_id and workspace_id.',
      }),
    ]);
    // The last call keeps the same tools, so the cached prefix holds; a note says to answer.
    expect(JSON.stringify(sent[2]!.tools)).toBe(JSON.stringify(sent[0]!.tools));
    expect(texts(sent[2]!).at(-1)).toMatch(/last step/u);
    const detail = await readChat(db, scope, run.chat_id);
    expect(detail.latest_run).toMatchObject({ status: 'succeeded', steps_used: 3 });
    expect(detail.messages.at(-1)?.content).toBe(
      'I reached this turn’s limit before writing an answer. Nothing was saved. Narrow the request and ask again.',
    );
    expect(detail.output).toBeNull();
  });
  it('answers with the last call’s text when it still asks for a read', async () => {
    const scope = await fixtures.scope();
    const { run, lease } = await fixtures.claimed(scope);
    await budget(run, { max_model_calls: 2 });
    await fixtures
      .runtime(
        scope,
        scripted([read(), [text('The observed value is zero.'), toolUse('read_evidence')]]),
      )
      .execute(lease);
    expect((await toolAttempts(run.id)).map(({ ordinal }) => ordinal)).toEqual([1]);
    const detail = await readChat(db, scope, run.chat_id);
    expect(detail.latest_run).toMatchObject({ status: 'succeeded', steps_used: 2, skill_id: null });
    expect(detail.messages.at(-1)?.content).toBe('The observed value is zero.');
  });
  it('enforces outline approval and refuses editing during the admitted draft', async () => {
    const scope = await fixtures.scope();
    const { run, lease } = await fixtures.claimed(scope, { skillId: 'content' });
    await fixtures.runtime(scope, scripted([save()])).execute(lease);
    const outputs = new AgentOutputs(db);
    let detail = await readChat(db, scope, run.chat_id);
    const original = detail.output!.latest_revision!;
    expect(original.phase).toBe('outline');
    expect(detail.messages.at(-1)?.content).toContain('Outline saved');
    await expect(
      fixtures.store().enqueue(scope, {
        chatId: run.chat_id,
        key: randomUUID(),
        message: 'Change kind',
        skillId: 'plan',
      }),
    ).rejects.toMatchObject({ code: 'agent_skill_kind_conflict' });
    const draft = await fixtures
      .store()
      .approveOutline(scope, run.chat_id, original.id, randomUUID());
    const queue = new AgentQueue(db, 30);
    const owned = await queue.claim('draft', [scope.workspaceId]);
    const next = await queue.start(owned!, 'draft');
    await expect(
      outputs.edit(scope, run.chat_id, original.id, 'Busy', 'Busy'),
    ).rejects.toMatchObject({ code: 'agent_run_active' });
    await fixtures
      .runtime(
        scope,
        scripted([save('draft', 'Draft after approval')], async (request) => {
          // The outline is in the replayed exchange that saved it.
          expect(JSON.stringify(request.messages)).toContain(original.body);
        }),
      )
      .execute(next);
    detail = await readChat(db, scope, run.chat_id);
    expect(detail.output!.latest_revision).toMatchObject({
      phase: 'draft',
      number: 2,
      parent_revision_id: original.id,
    });
    expect((await fixtures.run(draft.id)).status).toBe('succeeded');
    expect(detail.messages.find((message) => message.event)?.event).toMatchObject({
      kind: 'outline_approved',
      revision_id: original.id,
      run_id: draft.id,
    });
  });
  it('appends user edits and restores while refusing stale bases', async () => {
    const scope = await fixtures.scope();
    const { run, lease } = await fixtures.claimed(scope, { skillId: 'plan' });
    await fixtures.runtime(scope, scripted([save('final')])).execute(lease);
    const outputs = new AgentOutputs(db);
    const original = (await readChat(db, scope, run.chat_id)).output!.latest_revision!;
    const edited = await outputs.edit(scope, run.chat_id, original.id, 'Edited', 'User document');
    await expect(
      outputs.edit(scope, run.chat_id, original.id, 'Stale', 'Stale edit'),
    ).rejects.toMatchObject({ code: 'output_conflict' });
    const restored = await outputs.restore(scope, run.chat_id, original.id);
    expect(restored).toMatchObject({
      number: 3,
      parent_revision_id: edited.id,
      body: original.body,
    });
    expect(
      (await listRevisions(db, scope, run.chat_id)).items.map((revision) => revision.number),
    ).toEqual([3, 2, 1]);
  });
  it('supplies the user’s edit as the base of a later Agent revision', async () => {
    const scope = await fixtures.scope();
    const { run, lease } = await fixtures.claimed(scope, { skillId: 'plan' });
    await fixtures.runtime(scope, scripted([save('draft')])).execute(lease);
    const outputs = new AgentOutputs(db);
    const latest = (await readChat(db, scope, run.chat_id)).output!.latest_revision!;
    const userEdit = await outputs.edit(
      scope,
      run.chat_id,
      latest.id,
      'My draft',
      'User edited draft',
    );
    const followup = await fixtures.claimed(scope, {
      chatId: run.chat_id,
      message: 'Refine the current draft',
    });
    const opening: string[] = [];
    await fixtures
      .runtime(
        scope,
        scripted([save('final', 'Refined')], async (request, ordinal) => {
          if (ordinal === 1) opening.push(...texts(request));
        }),
      )
      .execute(followup.lease);
    expect(opening).toEqual([
      'The chat\'s current document (draft), which a revision updates:\n{"title":"My draft","body":"User edited draft"}',
      'Refine the current draft',
    ]);
    expect(
      (await readChat(db, scope, run.chat_id)).output!.latest_revision!.parent_revision_id,
    ).toBe(userEdit.id);
  });
  it('rolls back reply/output together when the base revision or target attachment changes', async () => {
    const scope = await fixtures.scope();
    const { run, lease } = await fixtures.claimed(scope, { skillId: 'plan' });
    await fixtures
      .runtime(scope, scripted([save('final')]), {
        attachTarget: async () => {
          throw new AgentError('output_conflict');
        },
      })
      .execute(lease);
    const detail = await readChat(db, scope, run.chat_id);
    expect(detail.messages.map((message) => message.role)).toEqual(['user', 'agent']);
    expect(detail.messages.at(-1)?.content).toBe(recoveryReply('output_conflict'));
    expect(detail.output).toBeNull();
    expect(detail.latest_run?.error_code).toBe('output_conflict');
  });
  it('freezes the exact upstream revision and refuses mismatched or sibling-project references', async () => {
    const scope = await fixtures.scope();
    const first = await fixtures.claimed(scope, { skillId: 'plan' });
    await fixtures
      .runtime(scope, scripted([save('final', 'Accepted upstream brief')]))
      .execute(first.lease);
    const detail = await readChat(db, scope, first.run.chat_id);
    const refs = {
      output_revision_reference: {
        output_id: detail.output!.id,
        revision_id: detail.output!.latest_revision!.id,
      },
    };
    const accepted = await fixtures
      .store({ context: readAgentContext })
      .enqueue(scope, { key: randomUUID(), message: 'Measure this accepted brief', refs });
    await new AgentOutputs(db).edit(
      scope,
      first.run.chat_id,
      detail.output!.latest_revision!.id,
      'Edited brief',
      'Later changed content',
    );
    const manifest = accepted.context_manifest as {
      package: { sections: { upstream_revision: { body: string } } };
    };
    expect(manifest.package.sections.upstream_revision.body).toBe('Accepted upstream brief');
    const sibling = await fixtures.project(scope.workspaceId);
    await expect(
      readAgentContext(db, { ...scope, projectId: sibling }, refs, 'Measure'),
    ).rejects.toMatchObject({ code: 'agent_context_unavailable' });
    await expect(
      readAgentContext(
        db,
        scope,
        {
          output_revision_reference: { ...refs.output_revision_reference, output_id: randomUUID() },
        },
        'Measure',
      ),
    ).rejects.toMatchObject({ code: 'agent_context_unavailable' });
  });
  it('bounds unavailable tool results with explicit omissions and keeps record IDs out of replies', async () => {
    const scope = await fixtures.scope();
    const sourceId = randomUUID();
    const tools = new ToolRegistry('test-tools-1', [
      {
        name: 'missing',
        description: 'Read missing evidence.',
        arguments: z.object({}).strict(),
        read: async () => ({
          state: 'unavailable',
          data: 'x'.repeat(agentPolicy.tool_result_max_chars + 1),
          artifactRefs: [{ id: sourceId }],
          omissions: [{ reason: 'missing_snapshot', count: 1 }],
        }),
      },
    ]);
    const outcome = await tools.execute(db, scope, 'missing', {}, AbortSignal.timeout(1000));
    expect(outcome.status).toBe('unavailable');
    expect(outcome.refs).toEqual([{ id: sourceId }]);
    expect(outcome.omissions).toContainEqual({
      reason: 'tool_result_truncated',
      count: 1,
      sections: ['value'],
    });
    expect(JSON.parse(outcome.text)).toMatchObject({
      complete: false,
      omitted_sections: ['value'],
    });
    const { run, lease } = await fixtures.claimed(scope);
    await fixtures
      .runtime(
        scope,
        scripted([
          read({}, 'missing'),
          reply(`Source citeladder://evidence/${sourceId} (${sourceId})`),
        ]),
        { tools },
      )
      .execute(lease);
    const attempt = await db
      .selectFrom('agent_tool_attempts')
      .select('artifact_refs')
      .where('run_id', '=', run.id)
      .executeTakeFirstOrThrow();
    expect(attempt.artifact_refs).toEqual([{ id: sourceId }]);
    const completed = await readChat(db, scope, run.chat_id);
    expect(completed.messages.at(-1)).toMatchObject({
      content: 'Source',
      evidence_refs: [],
    });
    // A skill's fenced submission block keeps the IDs its schema needs.
    // A fence line with an info string does not close the block.
    const block = ['```json', '```not-a-close', `{"topic_id":"${sourceId}"}`, '```'].join('\n');
    expect(scrubRecordRefs(`See [the run](citeladder://audit/${sourceId}).\n\n${block}`)).toBe(
      `See the run.\n\n${block}`,
    );
    // URI schemes are case-insensitive, and padding inside a link's parentheses is removed too.
    expect(
      scrubRecordRefs('Read CITELADDER://Audit/x and [the run]( citeladder://audit/y ).'),
    ).toBe('Read and the run.');
    const id = randomUUID();
    const manifest = {
      version: 'agent-context-1',
      refs: {},
      package: emptyPackage,
      instructions: null,
      action: null,
      mentions: [
        {
          id: randomUUID(),
          target_label: 'A',
          skill_id: 'plan',
          diagnosis: { what_happened: [{ opportunity_id: id }] },
        },
      ],
    };
    expect(contextCitations(manifest)).toEqual(new Set([`citeladder://opportunity/${id}`]));
    expect(
      suppliedManifest({
        ...manifest,
        package: {
          ...emptyPackage,
          brand_block: 'x'.repeat(agentPolicy.context_package_max_chars),
        },
      }).text.length,
    ).toBeLessThanOrEqual(agentPolicy.context_package_max_chars);
    expect(bounded('123456', 3, 'CUT')).toBe('CUT');
  });
  it('freezes instruction revisions and pages persisted chats without doing work', async () => {
    const scope = await fixtures.scope();
    const outputs = new AgentOutputs(db);
    await outputs.saveInstructions(scope, 'Use a concise voice.');
    const a = await fixtures.store().enqueue(scope, { key: randomUUID(), message: 'First' });
    await outputs.saveInstructions(scope, 'Use a formal voice.');
    const b = await fixtures.store().enqueue(scope, { key: randomUUID(), message: 'Second' });
    await db
      .updateTable('agent_chats')
      .set({ last_activity_at: sql<Date>`'2026-01-01T00:00:00.123455Z'::timestamptz` })
      .where('id', '=', a.chat_id)
      .execute();
    await db
      .updateTable('agent_chats')
      .set({ last_activity_at: sql<Date>`'2026-01-01T00:00:00.123456Z'::timestamptz` })
      .where('id', '=', b.chat_id)
      .execute();
    expect((await readChat(db, scope, a.chat_id)).context.instructions).toMatchObject({
      revision: 1,
    });
    expect((await readChat(db, scope, b.chat_id)).context.instructions).toMatchObject({
      revision: 2,
    });
    const page = await listChats(db, scope, { limit: 1 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.id).toBe(b.chat_id);
    const next = await listChats(db, scope, { limit: 1, cursor: page.next_cursor! });
    expect(next.items[0]?.id).not.toBe(page.items[0]?.id);
    expect(next.items[0]?.id).toBe(a.chat_id);
    await fixtures.store().cancel(scope, a.chat_id, a.id);
    await fixtures.store().archive(scope, a.chat_id);
    expect((await listChats(db, scope)).items.map((chat) => chat.id)).toEqual([b.chat_id]);
  });
  it('searches later message content without duplicate chats or sibling/workspace leakage', async () => {
    const scope = await fixtures.scope();
    const run = await fixtures
      .store()
      .enqueue(scope, { key: randomUUID(), message: 'Unrelated title' });
    await db.transaction().execute(async (trx) => {
      const chat = await getChat(trx, scope, run.chat_id, true);
      await appendMessage(trx, chat, { role: 'user', content: 'Later topic: robots permission' });
      await appendMessage(trx, chat, { role: 'agent', content: 'Explain robots permission' });
    });
    const foreign = await fixtures.scope();
    await fixtures.store().enqueue(foreign, { key: randomUUID(), message: 'robots permission' });
    const sibling = await fixtures.project(scope.workspaceId);
    await fixtures
      .store()
      .enqueue(
        { ...scope, projectId: sibling },
        { key: randomUUID(), message: 'robots permission' },
      );
    expect(
      (await listChats(db, scope, { query: 'robots permission' })).items.map((chat) => chat.id),
    ).toEqual([run.chat_id]);
    expect((await listChats(db, scope, { query: '%' })).items).toEqual([]);
  });
  it('bounds a reply to its frozen size', async () => {
    const scope = await fixtures.scope();
    const { run, lease } = await fixtures.claimed(scope);
    await budget(run, { reply_max_chars: 100 });
    await fixtures.runtime(scope, scripted([reply('a'.repeat(200))])).execute(lease);
    const content = (await readChat(db, scope, run.chat_id)).messages.at(-1)?.content;
    expect(content).toBe(`${'a'.repeat(62)}\n[reply truncated at its size bound]`);
  });
  it('runs the bounded worker unit with an explicit tenant set', async () => {
    const scope = await fixtures.scope();
    const queued = await fixtures
      .store()
      .enqueue(scope, { key: randomUUID(), message: 'Answer this' });
    const queue = new AgentQueue(db, 30);
    const runtime = fixtures.runtime(scope, scripted([reply()]));
    expect(await runAgentOnce(queue, runtime, 'bounded-worker', [])).toBe(false);
    expect(await runAgentOnce(queue, runtime, 'bounded-worker', [scope.workspaceId])).toBe(true);
    expect((await fixtures.run(queued.id)).status).toBe('succeeded');
  });
  it.each(['model', 'tool'] as const)(
    'scopes concurrent interactive turns and ends an interrupted %s call as interrupted',
    async (boundary) => {
      const scope = await fixtures.scope();
      const store = fixtures.store();
      const requested = await store.enqueue(scope, { key: randomUUID(), message: 'Requested' });
      const sibling = await store.enqueue(scope, { key: randomUUID(), message: 'Other chat' });
      const controller = new AbortController();
      const interrupt = vi.fn(async (signal: AbortSignal) => {
        controller.abort();
        expect(signal.aborted).toBe(true);
        signal.throwIfAborted();
        throw new Error('Expected interruption');
      });
      const model =
        boundary === 'model'
          ? {
              ...scripted([]),
              converse: (_request: unknown, signal: AbortSignal) => interrupt(signal),
            }
          : scripted([read()]);
      const tools = new ToolRegistry('test-tools-1', [
        {
          name: 'read_evidence',
          description: 'Interrupted persisted read',
          arguments: z.object({}).strict(),
          read: (_scope, _args, signal) => interrupt(signal),
        },
      ]);
      const runtime = fixtures.runtime(scope, model, { tools });
      const queue = new AgentQueue(db, 30);
      await Promise.all(
        ['first', 'second'].map((owner) =>
          runAgentOnce(queue, runtime, owner, [scope.workspaceId], {
            runId: requested.id,
            signal: controller.signal,
          }),
        ),
      );
      expect(interrupt).toHaveBeenCalledTimes(1);
      // The browser left mid-call: the turn ends once, with its reply.
      expect(await fixtures.run(requested.id)).toMatchObject({
        status: 'failed',
        error_code: 'interrupted',
        attempt_count: 1,
        lease_owner: null,
      });
      expect((await readChat(db, scope, requested.chat_id)).messages.at(-1)?.content).toBe(
        recoveryReply('interrupted'),
      );
      expect(await fixtures.run(sibling.id)).toMatchObject({ status: 'queued', attempt_count: 0 });
    },
  );
  it('recovers an abandoned cancellation’s dispatch exactly once', async () => {
    const scope = await fixtures.scope();
    const turn = await fixtures.claimed(scope);
    const calls = new ModelCalls(db, zeroFunding);
    const attempt = await calls.dispatch(turn.lease, 1, scripted([]), request);
    await fixtures.store().cancel(scope, turn.run.chat_id, turn.run.id);
    await db
      .updateTable('agent_model_attempts')
      .set({ deadline_at: new Date(0) })
      .where('id', '=', attempt.id)
      .execute();
    expect(await calls.recoverCancelled([scope.workspaceId], 1, 0)).toBe(1);
    expect(await calls.recoverCancelled([scope.workspaceId], 1, 0)).toBe(0);
    expect(
      await db
        .selectFrom('agent_model_attempts')
        .select('outcome')
        .where('id', '=', attempt.id)
        .executeTakeFirst(),
    ).toMatchObject({ outcome: 'recovered_unknown' });
  });
  it('fences a moved output base and never commits its reply on top of that revision', async () => {
    const scope = await fixtures.scope();
    const first = await fixtures.claimed(scope, { skillId: 'plan' });
    await fixtures.runtime(scope, scripted([save('final')])).execute(first.lease);
    const initial = (await readChat(db, scope, first.run.chat_id)).output!.latest_revision!;
    const followup = await fixtures.claimed(scope, {
      chatId: first.run.chat_id,
      message: 'Revise',
    });
    let changedId = '';
    await fixtures
      .runtime(
        scope,
        scripted([save('final', 'Stale model body')], async (_request, ordinal) => {
          if (ordinal !== 1) return;
          const source = await db
            .selectFrom('agent_output_revisions')
            .selectAll()
            .where('id', '=', initial.id)
            .executeTakeFirstOrThrow();
          changedId = randomUUID();
          await db
            .insertInto('agent_output_revisions')
            .values({
              ...source,
              id: changedId,
              number: 2,
              parent_revision_id: source.id,
              author: 'user',
              author_user_id: scope.userId,
              run_id: null,
              message_id: null,
              body: 'A concurrently committed revision',
              source_refs: JSON.stringify(source.source_refs),
              created_at: new Date(),
            })
            .execute();
        }),
      )
      .execute(followup.lease);
    const detail = await readChat(db, scope, first.run.chat_id);
    expect(detail.latest_run?.error_code).toBe('output_conflict');
    expect(detail.messages.map((message) => message.role)).toEqual([
      'user',
      'agent',
      'user',
      'agent',
    ]);
    expect(detail.output!.latest_revision!.id).toBe(changedId);
  });
  it('leaves unsettled dispatches recoverable when accounting is temporarily unavailable', async () => {
    const scope = await fixtures.scope();
    const { run, lease, queue } = await fixtures.claimed(scope);
    const models = new ModelCalls(db, {
      ...zeroFunding,
      settle: async () => {
        throw new Error('Accounting unavailable');
      },
    });
    await expect(
      fixtures.runtime(scope, scripted([reply()]), { models }).execute(lease),
    ).rejects.toThrow('Accounting unavailable');
    expect((await fixtures.run(run.id)).status).toBe('running');
    expect(
      await db
        .selectFrom('agent_model_attempts')
        .select('outcome')
        .where('run_id', '=', run.id)
        .executeTakeFirst(),
    ).toMatchObject({ outcome: 'dispatched' });
    const restored = new ModelCalls(db, zeroFunding);
    await expireAndRecover(queue, scope.workspaceId, run.id, restored);
    expect((await fixtures.run(run.id)).status).toBe('failed');
    expect(
      await db
        .selectFrom('agent_model_attempts')
        .select('outcome')
        .where('run_id', '=', run.id)
        .executeTakeFirst(),
    ).toMatchObject({ outcome: 'recovered_unknown' });
  });
  it('drafts short formats directly and starts long-form formats from an outline', async () => {
    const scope = await fixtures.scope();
    const formats = new Map([
      ['post', { id: 'post', label: 'Post', body: 'Write a post.', longForm: false }],
      ['guide', { id: 'guide', label: 'Guide', body: 'Write a guide.', longForm: true }],
    ]);
    const phases = [];
    for (const format_id of ['post', 'guide']) {
      const { run, lease } = await fixtures.claimed(scope, { skillId: 'content' });
      await fixtures
        .runtime(scope, scripted([save('draft', 'Requested document', { format_id })]), {
          catalog: { ...catalog, formats },
        })
        .execute(lease);
      phases.push((await readChat(db, scope, run.chat_id)).output?.phase);
    }
    expect(phases).toEqual(['draft', 'outline']);
  });
  it('keeps a revision’s sources and adds the records its turn read', async () => {
    const scope = await fixtures.scope();
    const first = await fixtures.claimed(scope, { skillId: 'plan' });
    const uri = `citeladder://project/${scope.projectId}`;
    await fixtures.runtime(scope, scripted([read(), save()])).execute(first.lease);
    const next = await fixtures.claimed(scope, { chatId: first.run.chat_id });
    await fixtures
      .runtime(scope, scripted([save('draft', `Revised with ${uri} kept.`)]))
      .execute(next.lease);
    const detail = await readChat(db, scope, first.run.chat_id);
    expect(detail.output?.latest_revision).toMatchObject({
      number: 2,
      body: 'Revised with kept.',
      source_refs: [uri],
    });
    expect(detail.messages.at(-1)?.evidence_refs).toEqual([]);
  });
  it('pins a workflow’s skill and format, and keeps them through a clarifying first turn', async () => {
    const scope = await fixtures.scope();
    const formats = new Map([
      ['post', { id: 'post', label: 'Post', body: 'Write one short post.', longForm: false }],
    ]);
    const workflows = parseWorkflows(
      JSON.stringify({
        groups: [{ id: 'social', label: 'Social' }],
        workflows: [
          {
            id: 'post',
            group: 'social',
            label: 'Post',
            description: 'A short post.',
            skill_id: 'content',
            format_id: 'post',
            prompt: 'Write a post.',
            inputs: [],
          },
        ],
        kinds: {},
      }),
      catalog.skills,
      formats,
    );
    const pinned = { ...catalog, formats, workflows };
    const store = fixtures.store({ catalog: pinned });
    await expect(
      store.enqueue(scope, { key: randomUUID(), message: 'Write', workflowId: 'missing' }),
    ).rejects.toMatchObject({ code: 'agent_workflow_unavailable' });
    const queue = new AgentQueue(db, 30);
    const execute = async (responses: Response[], onCall?: Parameters<typeof scripted>[1]) => {
      const claimed = await queue.claim('workflow-worker', [scope.workspaceId]);
      const lease = await queue.start(claimed!, 'workflow-worker');
      await fixtures
        .runtime(scope, scripted(responses, onCall), { catalog: pinned })
        .execute(lease);
    };
    const first = await store.enqueue(scope, {
      key: randomUUID(),
      message: 'Write a post.',
      workflowId: 'post',
    });
    expect(first.requested_skill_id).toBe('content');
    const opening: string[] = [];
    await execute([reply('Which topic should it cover?')], async (request) => {
      opening.push(...texts(request));
    });
    expect(opening.find((block) => block.startsWith('Methodology: content'))).toContain(
      'this chat uses post',
    );
    await store.enqueue(scope, { key: randomUUID(), chatId: first.chat_id, message: 'Pricing' });
    // The save names no format, so the pinned one applies.
    await execute([save('draft')]);
    // The pinned short format is saved without an outline.
    expect((await readChat(db, scope, first.chat_id)).output).toMatchObject({
      format_id: 'post',
      phase: 'draft',
    });
  });
});
