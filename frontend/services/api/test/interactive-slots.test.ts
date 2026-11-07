import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.ts';
import { createAgentBindings } from '../src/agent/bindings.ts';
import * as bindingsOwner from '../src/agent/bindings.ts';
import { budgetSchema } from '../src/agent/contracts.ts';
import { ModelCalls, type AgentModel } from '../src/agent/model-calls.ts';
import { auditRuntime } from '../src/audits/config.ts';
import { createAudits } from '../src/audits/creation.ts';
import { auditInput } from '../src/audits/inputs.ts';
import { interactiveSlots, type InteractiveSlot } from '../src/http/interactive-slots.ts';
import { AgentFixtures, reply, scripted, zeroFunding } from './agent-support.ts';
import { auditTenant } from './audit-fixtures.ts';
import { TEST_SESSION_COOKIE, sessionToken, testConfig, testDatabase } from './support.ts';
import { agentTurnAcceptedSchema } from '@citeladder/contracts/agent';

// This file owns its module graph, so it may fill and drain the process's slots.
describe('in-request work slots on one API instance', () => {
  const db = testDatabase(),
    fixtures = new AgentFixtures(db),
    config = testConfig(),
    app = createApp(config, db);
  afterAll(async () => {
    vi.restoreAllMocks();
    await fixtures.cleanup();
    await db.destroy();
  });
  async function agent(model: AgentModel) {
    const scope = await fixtures.scope(),
      bindings = await createAgentBindings(db, {});
    bindings.store.dependencies.admission = fixtures.store().dependencies.admission;
    bindings.runtime.deps.models = new ModelCalls(db, zeroFunding);
    bindings.runtime.deps.modelFor = () => model;
    bindings.models = bindings.runtime.deps.models;
    vi.spyOn(bindingsOwner, 'agentBindings').mockResolvedValue(bindings);
    const headers = {
      cookie: `${TEST_SESSION_COOKIE}=${await sessionToken({ sub: scope.userId, ver: 0 })}`,
      'X-Workspace-Id': scope.workspaceId,
      'Content-Type': 'application/json',
    };
    const accepted = agentTurnAcceptedSchema.parse(
      await (
        await app.request(`/api/v1/projects/${scope.projectId}/agent/chats`, {
          method: 'POST',
          headers: { ...headers, 'Idempotency-Key': randomUUID() },
          body: JSON.stringify({ message: 'Explain our visibility' }),
        })
      ).json(),
    );
    const run = () =>
      app.request(`/api/v1/agent/chats/${accepted.chat_id}/runs/${accepted.run.id}/run`, {
        method: 'POST',
        headers: { ...headers, Accept: 'text/event-stream' },
      });
    return { scope, headers, runId: accepted.run.id, run };
  }
  /** Holds every free slot until released. */
  function fill() {
    const held: InteractiveSlot[] = [];
    for (;;) {
      try {
        held.push(interactiveSlots.acquire());
      } catch {
        return held;
      }
    }
  }
  /** A model that answers only when its turn is stopped. */
  function blocking(started: () => void): AgentModel {
    return {
      ...scripted([]),
      converse: (_request, signal) =>
        new Promise((_resolve, reject) => {
          started();
          signal.addEventListener('abort', () => reject(signal.reason));
        }),
    };
  }

  it('refuses a turn with 429 and Retry-After while the instance is full, then admits it', async () => {
    const turn = await agent(scripted([reply('Admitted answer')]));
    const held = fill();
    expect(held).toHaveLength(6);
    const refused = await turn.run();
    expect(refused.status).toBe(429);
    expect(refused.headers.get('retry-after')).toBe('15');
    expect((await fixtures.run(turn.runId)).status).toBe('queued');
    held.pop()?.release();
    const admitted = await turn.run();
    expect(admitted.status).toBe(200);
    expect(await admitted.text()).toContain('"type":"done"');
    expect(await fixtures.run(turn.runId)).toMatchObject({ status: 'succeeded' });
    for (const slot of held) slot.release();
  });

  it('refuses an interactive audit drive while the instance is full and keeps the audit queued', async () => {
    const tenant = await auditTenant(db, fixtures);
    const [auditId] = await createAudits(
      db,
      tenant.workspaceId,
      auditInput.parse({
        project_id: tenant.projectId,
        prompt_set_id: tenant.setId,
        engines: ['chatgpt'],
      }),
      {},
      auditRuntime({}),
    );
    const held = fill();
    const response = await app.request(`/api/v1/audits/${auditId}/run`, {
      method: 'POST',
      headers: {
        cookie: `${TEST_SESSION_COOKIE}=${await sessionToken({ sub: tenant.userId, ver: 0 })}`,
        'x-workspace-id': tenant.workspaceId,
      },
    });
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('15');
    const audit = await db
      .selectFrom('audits')
      .select('status')
      .where('id', '=', auditId!)
      .executeTakeFirstOrThrow();
    expect(audit.status).toBe('queued');
    for (const slot of held) slot.release();
  });

  it('ends a turn at the time limit frozen in its budget, not the live setting', async () => {
    let started!: () => void;
    const calling = new Promise<void>((resolve) => {
      started = resolve;
    });
    const turn = await agent(blocking(() => started()));
    // Admission froze a short limit; the live setting is still 1,800 seconds.
    const run = await fixtures.run(turn.runId);
    await db
      .updateTable('agent_runs')
      .set({ budget: { ...budgetSchema.parse(run.budget), turn_timeout_seconds: 0.3 } })
      .where('id', '=', turn.runId)
      .execute();
    const response = await turn.run();
    await calling;
    expect(await response.text()).toContain('"type":"done"');
    expect(await fixtures.run(turn.runId)).toMatchObject({
      status: 'failed',
      error_code: 'turn_timeout',
    });
  });

  // Last: draining stops this process's slots for good.
  it('stops open turns on shutdown so they settle as interrupted, and admits nothing after', async () => {
    let started!: () => void;
    const calling = new Promise<void>((resolve) => {
      started = resolve;
    });
    const turn = await agent(blocking(() => started()));
    const response = await turn.run();
    await calling;
    expect(await interactiveSlots.drain(5000)).toBe(true);
    expect(await fixtures.run(turn.runId)).toMatchObject({
      status: 'failed',
      error_code: 'interrupted',
    });
    expect(await response.text()).toContain('"type":"done"');
    const late = await agent(scripted([reply()]));
    expect((await late.run()).status).toBe(429);
  });
});
