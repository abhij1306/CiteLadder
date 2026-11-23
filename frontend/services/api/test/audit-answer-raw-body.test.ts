import { describe, expect, it } from 'vitest';
import { auditTenant, auditTestKey } from './audit-fixtures.ts';
import { auditWorkerHarness } from './audit-worker-fixtures.ts';
import { createAudits } from '../src/audits/creation.ts';
import { auditInput } from '../src/audits/inputs.ts';
import { record } from '../src/db/json.ts';
import { createConnection } from '../src/providers/connections.ts';
import { createConnectionInput } from '../src/providers/inputs.ts';
import { probeConnection } from '../src/providers/probes.ts';
import { getExecutionEvidence } from '../src/visibility/execution.ts';

const { db, fixtures, runtime, workspaces, tasks, worker } = auditWorkerHarness();

const longAnswer = `${Array.from(
  { length: 430 },
  (_, n) => `Point ${n} weighs fit, value and comfort.`,
).join(' ')} Acme Running suits road use.`;
const bodies = {
  openai: {
    id: 'resp-1',
    status: 'completed',
    output: [
      { type: 'web_search_call', id: 'ws-1', action: { query: 'road shoes' } },
      {
        type: 'message',
        content: [{ type: 'output_text', text: 'Acme Running suits road use.', annotations: [] }],
      },
    ],
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
  },
  anthropic: {
    id: 'msg-1',
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: longAnswer }],
    usage: { input_tokens: 10, output_tokens: 4000, server_tool_use: { web_search_requests: 2 } },
  },
};

async function seed() {
  const t = await auditTenant(db, fixtures);
  workspaces.push(t.workspaceId);
  const anthropic = await createConnection(
    db,
    t.workspaceId,
    t.userId,
    createConnectionInput.parse({
      transport_provider: 'anthropic',
      api_key: 'anthropic-test-secret',
      routes: [{ logical_engine: 'claude' }],
    }),
    auditTestKey,
    runtime.providers,
  );
  await probeConnection(db, t.workspaceId, anthropic.id, auditTestKey, runtime.providers, () =>
    Promise.resolve({ status: 200, body: { content: [{ type: 'text', text: 'ok' }] } }),
  );
  const [auditId] = await createAudits(
    db,
    t.workspaceId,
    auditInput.parse({
      project_id: t.projectId,
      prompt_set_id: t.setId,
      engines: ['chatgpt', 'claude'],
      repetitions: 1,
    }),
    {},
    runtime,
  );
  const rows = await db
    .selectFrom('audit_tasks')
    .select(['id', 'transport_provider'])
    .where('audit_id', '=', auditId)
    .execute();
  tasks.push(...rows.map((row) => row.id));
  return { ...t, auditId, rows };
}

function providerDouble(sent: Record<string, Record<string, unknown>>): typeof fetch {
  return async (url, init) => {
    const provider = String(url).includes('anthropic') ? 'anthropic' : 'openai';
    sent[provider] = record(JSON.parse(String(init?.body)));
    return Response.json(bodies[provider]);
  };
}

describe('API-engine answers keep their raw body', () => {
  it('stores each body on its artifact, sends 2 searches and the 4096 cap, and reads a long answer whole in its workspace only', async () => {
    const t = await seed();
    const other = await auditTenant(db, fixtures);
    workspaces.push(other.workspaceId);
    const sent: Record<string, Record<string, unknown>> = {};
    await worker(t, providerDouble(sent)).drain(() => true);

    expect(sent.openai).toMatchObject({ max_output_tokens: 4096, max_tool_calls: 2 });
    expect(sent.anthropic).toMatchObject({ max_tokens: 4096, tools: [{ max_uses: 2 }] });
    expect([sent.openai?.instructions, sent.anthropic?.system]).toEqual([undefined, undefined]);

    const artifacts = await db
      .selectFrom('raw_response_artifacts')
      .select(['task_id', 'transport_provider', 'provider_metadata'])
      .where('workspace_id', '=', t.workspaceId)
      .where('audit_id', '=', t.auditId)
      .execute();
    const stored = Object.fromEntries(
      artifacts.map((row) => [row.transport_provider, record(row.provider_metadata).raw_body]),
    );
    expect(stored).toEqual({
      openai: {
        kind: 'stored',
        bytes: Buffer.byteLength(JSON.stringify(bodies.openai)),
        body: bodies.openai,
      },
      anthropic: {
        kind: 'stored',
        bytes: Buffer.byteLength(JSON.stringify(bodies.anthropic)),
        body: bodies.anthropic,
      },
    });
    expect(JSON.stringify(artifacts)).not.toMatch(/test-key|anthropic-test-secret/u);

    const taskMetadata = await db
      .selectFrom('audit_tasks')
      .select('provider_metadata')
      .where('audit_id', '=', t.auditId)
      .execute();
    expect(
      taskMetadata.map((row) => Object.hasOwn(record(row.provider_metadata), 'raw_body')),
    ).toEqual([false, false]);
    expect(taskMetadata.map((row) => record(row.provider_metadata).id).sort()).toEqual([
      'msg-1',
      'resp-1',
    ]);

    const claudeTask = t.rows.find((row) => row.transport_provider === 'anthropic')!.id;
    const evidence = await getExecutionEvidence(db, {
      workspaceId: t.workspaceId,
      taskId: claudeTask,
    });
    expect(evidence).toMatchObject({ answer_text: longAnswer, brand_mentioned: true });
    await expect(
      getExecutionEvidence(db, { workspaceId: other.workspaceId, taskId: claudeTask }),
    ).rejects.toThrow('Execution analysis not found');
    const foreign = await db
      .selectFrom('raw_response_artifacts')
      .select('id')
      .where('workspace_id', '=', other.workspaceId)
      .where('task_id', '=', claudeTask)
      .execute();
    expect(foreign).toEqual([]);
  });

  it('records a body over the configured bound as over_bound with its size instead of storing it', async () => {
    const t = await seed();
    const limit = 64;
    await worker(t, providerDouble({}), {
      ...runtime,
      providers: { ...runtime.providers, answerRawBodyMaxBytes: limit },
    }).drain(() => true);
    const artifacts = await db
      .selectFrom('raw_response_artifacts')
      .select(['transport_provider', 'provider_metadata', 'answer_text'])
      .where('workspace_id', '=', t.workspaceId)
      .where('audit_id', '=', t.auditId)
      .execute();
    expect(
      Object.fromEntries(
        artifacts.map((row) => [row.transport_provider, record(row.provider_metadata).raw_body]),
      ),
    ).toEqual({
      openai: {
        kind: 'over_bound',
        bytes: Buffer.byteLength(JSON.stringify(bodies.openai)),
        limit_bytes: limit,
      },
      anthropic: {
        kind: 'over_bound',
        bytes: Buffer.byteLength(JSON.stringify(bodies.anthropic)),
        limit_bytes: limit,
      },
    });
    expect(artifacts.map((row) => row.answer_text).sort()).toEqual([
      'Acme Running suits road use.',
      longAnswer,
    ]);
  });
});
