/**
 * A Commerce answer recorded through the real audit, matching and persistence
 * path: one audit of the tenant's prompt whose single ChatGPT answer is the
 * given text, claimed, matched against the catalog and persisted as a success.
 */
import { randomUUID } from 'node:crypto';

import type { AuditRuntime } from '../src/audits/config.ts';
import { createAudits } from '../src/audits/creation.ts';
import { auditInput } from '../src/audits/inputs.ts';
import { persistExecutionSuccess, type ExecutionResult } from '../src/audits/result-persistence.ts';
import { prepareShelfExecution } from '../src/commerce/shelf.ts';
import type { Database } from '../src/db/database.ts';
import { AuditQueue } from '../src/queue/audit-queue.ts';
import type { auditTenant } from './audit-fixtures.ts';

type Tenant = Awaited<ReturnType<typeof auditTenant>>;

export type RecordedAnswer = { auditId: string; taskId: string };

/** What an answer cited and searched for, as the provider returned it. */
export type AnswerEvidence = { citations: { url: string; title: string }[]; queries: string[] };
const NO_EVIDENCE: AnswerEvidence = { citations: [], queries: [] };

export async function recordAnswer(
  db: Database,
  t: Tenant,
  text: string,
  options: {
    runtime: AuditRuntime;
    worker: string;
    auditScope?: 'brand' | 'commerce';
    evidence?: AnswerEvidence;
  },
): Promise<RecordedAnswer> {
  const evidence = options.evidence ?? NO_EVIDENCE;
  const [auditId] = await createAudits(
    db,
    t.workspaceId,
    auditInput.parse({
      project_id: t.projectId,
      prompt_ids: [t.promptId],
      engines: ['chatgpt'],
      repetitions: 1,
      audit_scope: options.auditScope ?? 'brand',
    }),
    {},
    options.runtime,
  );
  const queue = new AuditQueue(db, 120);
  const [claim] = await queue.claim(options.worker, 1, { workspaceId: t.workspaceId, auditId });
  const running = await queue.markRunning(claim!, claim!.lease_owner);
  const task = running!.task;
  const result: ExecutionResult = {
    logical_engine: 'chatgpt',
    transport_provider: 'openai',
    transport_model: task.transport_model,
    answer_text: text,
    search_used: evidence.queries.length > 0,
    search_events: evidence.queries.map((query, sequence) => ({
      sequence,
      query,
      call_id: `call-${sequence}`,
      call_sequence: 0,
      query_sequence: sequence,
    })),
    finish_reason: 'stop',
    raw_finish_reason: 'stop',
    latency_ms: 1,
    provider_metadata: {},
    retrieved_sources: null,
    citations: evidence.citations.map(({ url, title }, ordinal) => ({
      ordinal,
      url,
      title,
      domain: new URL(url).hostname,
      start_index: null,
      end_index: null,
      cited_text: '',
    })),
    normalized_usage: {
      uncached_input_tokens: null,
      cached_input_tokens: null,
      output_tokens: null,
      reasoning_tokens: null,
      total_tokens: null,
      web_search_requests: null,
      provider_cost_microusd: null,
    },
  };
  const derive = await prepareShelfExecution(db, task, result, null);
  await persistExecutionSuccess(db, task, claim!.lease_owner, result, derive);
  return { auditId: auditId!, taskId: task.id };
}

/**
 * A competitor candidate of the catalog's Acme Road Runner, at its own
 * rival.example page; approved from a provider unless `state` and `source` say
 * otherwise.
 */
export async function addCompetitor(
  db: Database,
  t: Tenant,
  name: string,
  { state = 'approved', source = 'provider' }: { state?: string; source?: string } = {},
) {
  const product = await db
    .selectFrom('commerce_products')
    .select('id')
    .where('workspace_id', '=', t.workspaceId)
    .where('name', '=', 'Acme Road Runner')
    .executeTakeFirstOrThrow();
  await db
    .insertInto('commerce_competitor_candidates')
    .values({
      id: randomUUID(),
      workspace_id: t.workspaceId,
      project_id: t.projectId,
      target_kind: 'product',
      target_id: product.id,
      canonical_url: `https://rival.example/products/${name.toLowerCase().replaceAll(' ', '-')}`,
      product_name: name,
      brand_name: name.split(' ')[0]!,
      evidence: '{}',
      source_kind: source,
      state,
      created_at: new Date(),
    })
    .execute();
}
