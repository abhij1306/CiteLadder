import { randomUUID } from 'node:crypto';

import type { Citation } from '../src/answer-engines/contracts.ts';
import { auditRuntime } from '../src/audits/config.ts';
import { createAudits } from '../src/audits/creation.ts';
import { deriveExecution } from '../src/audits/derivation.ts';
import { loadExecutionContext } from '../src/audits/execution-context.ts';
import { finalizeAudit } from '../src/audits/finalization.ts';
import { auditInput } from '../src/audits/inputs.ts';
import { persistExecutionSuccess, type ExecutionResult } from '../src/audits/result-persistence.ts';
import type { Database } from '../src/db/database.ts';
import { AuditQueue } from '../src/queue/audit-queue.ts';
import { auditTenant, auditTestKey, claimAsWorker } from './audit-fixtures.ts';
import { asOwner } from './support.ts';
import type { VisibilityFixtures } from './visibility-fixtures.ts';

function citation(url: string, ordinal: number): Citation {
  return {
    ordinal,
    url,
    title: '',
    domain: new URL(url).hostname,
    start_index: null,
    end_index: null,
    cited_text: '',
  };
}

const result: Omit<ExecutionResult, 'transport_model' | 'citations'> = {
  logical_engine: 'chatgpt',
  transport_provider: 'openai',
  answer_text: 'Acme Running suits road use.',
  search_used: true,
  search_events: [],
  retrieved_sources: [],
  finish_reason: 'stop',
  raw_finish_reason: 'completed',
  latency_ms: 30,
  provider_metadata: { query_text_available: false },
  normalized_usage: {
    uncached_input_tokens: 10,
    cached_input_tokens: 0,
    output_tokens: 5,
    reasoning_tokens: null,
    total_tokens: 15,
    web_search_requests: 1,
    provider_cost_microusd: null,
  },
};

export function finalizedRuns(db: Database, fixtures: VisibilityFixtures) {
  const runtime = auditRuntime({}),
    queue = new AuditQueue(db, 120);
  const tasks: string[] = [];

  async function tenant() {
    const t = await auditTenant(db, fixtures);
    await db
      .insertInto('owned_domains')
      .values({
        id: randomUUID(),
        workspace_id: t.workspaceId,
        project_id: t.projectId,
        domain: 'acme.example',
        created_at: new Date(),
      })
      .execute();
    return t;
  }

  async function finalizedRun(t: Awaited<ReturnType<typeof tenant>>, urls: string[]) {
    const [auditId] = await createAudits(
      db,
      t.workspaceId,
      auditInput.parse({ project_id: t.projectId, prompt_set_id: t.setId, engines: ['chatgpt'] }),
      {},
      runtime,
    );
    const runNext = async () => {
      const [claimed] = await claimAsWorker(db, queue, 1, { workspaceId: t.workspaceId, auditId });
      if (!claimed) return false;
      const owner = claimed.lease_owner;
      const running = await queue.markRunning(claimed, owner);
      const context = await loadExecutionContext(
        db,
        running!.task,
        owner,
        runtime,
        auditTestKey,
        new Date(),
      );
      tasks.push(context!.task.id);
      await persistExecutionSuccess(
        db,
        context!.task,
        owner,
        {
          ...result,
          transport_model: context!.task.transport_model,
          citations: urls.map((url, ordinal) => citation(url, ordinal)),
        },
        deriveExecution,
      );
      return true;
    };
    let more = true;
    while (more)
      more = await /* NOSONAR -- Tasks run one at a time, as one worker runs them. */ runNext();
    await finalizeAudit(db, t.workspaceId, auditId!, async () => {});
    return auditId!;
  }

  async function cleanup() {
    if (tasks.length) {
      await db.deleteFrom('execution_cost_projections').where('task_id', 'in', tasks).execute();
      await asOwner((owner) =>
        owner.deleteFrom('provider_attempts').where('task_id', 'in', tasks).execute(),
      );
    }
    await fixtures.cleanup();
    tasks.length = 0;
  }

  return { tenant, finalizedRun, cleanup };
}
