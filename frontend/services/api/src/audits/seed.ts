import { z } from 'zod';
import type { Database } from '../db/database.ts';
import { auditInput } from './inputs.ts';
import { createAudits } from './creation.ts';
import { auditRuntime } from './config.ts';
import { auditProjections } from './projections.ts';
import { AuditWorker } from '../workers/audit-worker.ts';
import type { Answer } from '../answer-engines/contracts.ts';
import { devSeed } from '../config/dev-seed.ts';
import { waitForPoll } from '../workers/poll.ts';

const citation = z.object({
  ordinal: z.int().nonnegative(),
  url: z.url(),
  title: z.string(),
  domain: z.string(),
  start_index: z.int().nonnegative().nullable(),
  end_index: z.int().nonnegative().nullable(),
  cited_text: z.string(),
});
const seedInput = z
  .object({
    workspace_id: z.uuid(),
    input: auditInput,
    answers: z.record(
      z.string(),
      z.object({ answer_text: z.string(), search_used: z.boolean(), citations: z.array(citation) }),
    ),
  })
  .refine(
    (value) =>
      value.input.engines.every((engine) => ['chatgpt', 'gemini', 'claude'].includes(engine)),
    'Development fixtures support only direct answer engines',
  );
/** Planner/worker with explicit fixture intelligence and an audit-scoped claim; no provider transport. */
export async function seedAudit(
  db: Database,
  raw: unknown,
  encryptionKey: string,
  env: Record<string, string | undefined> = {},
) {
  const request = seedInput.parse(raw),
    runtime = auditRuntime(env);
  runtime.audits.min_request_interval_seconds = 0;
  const [auditId] = await createAudits(
    db,
    request.workspace_id,
    request.input,
    { trigger: 'system' },
    runtime,
  );
  const worker = new AuditWorker(db, runtime, encryptionKey, auditProjections(db, null, env), {
    taskScope: { workspaceId: request.workspace_id, auditId },
    send: () => Promise.reject(new Error('Development fixture cannot call a provider')),
    execute: (input) => {
      const fixture = request.answers[input.prompt];
      if (!fixture) return Promise.reject(new Error('Development fixture answer is missing'));
      const answer: Answer = {
        ...fixture,
        logical_engine: input.logical_engine,
        transport_provider: input.transport_provider,
        transport_model: input.transport_model,
        // A fixture answer read exactly the pages it cites.
        retrieved_sources: fixture.citations.map(({ ordinal, url, title, domain }) => ({
          ordinal,
          url,
          title,
          domain,
        })),
        search_events: fixture.search_used
          ? [
              {
                sequence: 0,
                query: input.prompt,
                call_id: 'fixture',
                call_sequence: 0,
                query_sequence: 0,
              },
            ]
          : [],
        finish_reason: 'stop',
        raw_finish_reason: 'stop',
        normalized_usage: {
          uncached_input_tokens: 12,
          cached_input_tokens: null,
          output_tokens: 48,
          reasoning_tokens: null,
          total_tokens: 60,
          web_search_requests: fixture.search_used ? 1 : 0,
          provider_cost_microusd: null,
        },
        provider_metadata: { query_text_available: true },
        latency_ms: 850,
      };
      return Promise.resolve(answer);
    },
  });
  const signal = AbortSignal.timeout(devSeed.budgetSeconds * 1000);
  for (let batch = 0; batch < 1000 && !signal.aborted; batch++) {
    const advanced = await worker.runOnce(signal);
    const audit = await db
      .selectFrom('audits')
      .select('status')
      .where('workspace_id', '=', request.workspace_id)
      .where('id', '=', auditId)
      .executeTakeFirstOrThrow();
    if (['completed', 'partially_completed'].includes(audit.status)) return auditId;
    if (['failed', 'cancelled'].includes(audit.status))
      throw new Error(`Seed audit ended ${audit.status}`);
    if (advanced === 0) await waitForPoll(runtime.audits.poll_interval_seconds * 1000, signal);
  }
  throw new Error('Development audit did not finish within its bounded drain');
}
