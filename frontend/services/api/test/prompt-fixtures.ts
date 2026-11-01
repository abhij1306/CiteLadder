/** Prompt-library and candidate rows for the prompts suites. */
import { randomUUID } from 'node:crypto';
import { vi } from 'vitest';

import type { Database } from '../src/db/database.ts';
import { createModelGateway, gatewaySettings } from '../src/models/gateway.ts';
import { promptTextHash } from '../src/prompts/normalization.ts';

const now = () => new Date();

export async function promptSet(db: Database, projectId: string): Promise<string> {
  const id = randomUUID();
  await db
    .insertInto('prompt_sets')
    .values({
      id,
      project_id: projectId,
      name: 'Set',
      description: '',
      created_at: now(),
      updated_at: now(),
    })
    .execute();
  return id;
}

export async function topic(db: Database, projectId: string, name: string, description = '') {
  const id = randomUUID();
  await db
    .insertInto('topics')
    .values({
      id,
      project_id: projectId,
      parent_id: null,
      name,
      description,
      origin: 'manual',
      created_at: now(),
      updated_at: now(),
    })
    .execute();
  return id;
}

export async function prompt(
  db: Database,
  setId: string,
  text: string,
  options: { status?: string; topicId?: string | null; createdAt?: Date } = {},
): Promise<string> {
  const id = randomUUID();
  await db
    .insertInto('prompts')
    .values({
      id,
      prompt_set_id: setId,
      topic_id: options.topicId ?? null,
      text,
      normalized_text_hash: promptTextHash(text),
      theme: '',
      intent: '',
      cohort: 'core',
      branded: false,
      enabled: true,
      status: options.status ?? 'active',
      origin: 'manual',
      created_at: options.createdAt ?? now(),
      updated_at: now(),
    })
    .execute();
  return id;
}

/** A persisted generation run. */
export async function generationRun(
  db: Database,
  scope: { workspaceId: string; projectId: string; setId: string },
  provenance: Record<string, unknown>,
): Promise<string> {
  const id = randomUUID();
  await db
    .insertInto('prompt_generation_runs')
    .values({
      id,
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      prompt_set_id: scope.setId,
      generator_version: 'test',
      request: JSON.stringify({}),
      provenance: JSON.stringify(provenance),
      created_at: now(),
    })
    .execute();
  return id;
}

export async function candidate(
  db: Database,
  scope: { workspaceId: string; setId: string; runId: string },
  text: string,
  options: {
    decision?: Record<string, unknown> | null;
    createdAt?: Date;
    expiresAt?: Date;
    topicId?: string | null;
    cohort?: string;
    evidenceRefs?: Record<string, unknown>[];
  } = {},
): Promise<string> {
  const id = randomUUID();
  await db
    .insertInto('prompt_candidates')
    .values({
      id,
      workspace_id: scope.workspaceId,
      run_id: scope.runId,
      prompt_set_id: scope.setId,
      topic_id: options.topicId ?? null,
      text,
      normalized_text_hash: promptTextHash(text),
      intent: 'discovery',
      buyer_stage: 'consideration',
      prompt_intent: 'compare',
      cohort: options.cohort ?? 'core',
      slot_id: `slot-${id}`,
      evidence_refs: JSON.stringify(options.evidenceRefs ?? [{ kind: 'page' }]),
      validation: JSON.stringify({ admission: 'passed' }),
      jev_decision: options.decision == null ? null : JSON.stringify(options.decision),
      disposition: 'pending',
      prompt_id: null,
      created_at: options.createdAt ?? now(),
      expires_at: options.expiresAt ?? new Date(Date.now() + 86_400_000),
      reviewed_at: null,
    })
    .execute();
  return id;
}

/** One draft request as the model received it: the system prompt, brief and the batch's slots. */
export type DraftRequest = {
  system: string;
  slots: (Record<string, unknown> & { slot_id: string })[];
  reference: Record<string, unknown>;
};

/**
 * Generation dependencies whose gateway answers every planned slot of a batch
 * with a distinct question, or fails the calls `fail` names (1-based) with a
 * non-retried provider error. `onRequest` sees each answered request.
 */
export function echoDependencies({
  fail = [],
  onCall,
  onRequest,
  topics = [],
  maps = [],
}: {
  fail?: number[];
  onCall?: (call: number) => void;
  onRequest?: (request: DraftRequest) => void;
  /** The answer to a topic proposal request, which carries offerings instead of slots. */
  topics?: { name: string; offerings: string[] }[];
  /** The answer to a business-map suggestion request, which also carries the knowledge base. */
  maps?: { offering: string; attributes: string[]; situations: string[]; audiences: string[] }[];
} = {}) {
  let calls = 0;
  const answer = (init?: RequestInit): Response => {
    const call = ++calls;
    onCall?.(call);
    if (fail.includes(call)) return new Response('bad request', { status: 400 });
    const body = JSON.parse(String(init?.body)) as { messages: { content: string }[] };
    const user = JSON.parse(body.messages[1]!.content.split('\n\nReturn only JSON')[0]!) as {
      slots?: DraftRequest['slots'];
      reference_evidence: DraftRequest['reference'];
      knowledge_base?: unknown;
    };
    if (user.knowledge_base)
      return Response.json({
        choices: [{ message: { content: JSON.stringify({ offerings: maps }) } }],
      });
    if (!user.slots)
      return Response.json({ choices: [{ message: { content: JSON.stringify({ topics }) } }] });
    onRequest?.({
      system: body.messages[0]!.content,
      slots: user.slots,
      reference: user.reference_evidence,
    });
    // Two words unique to the slot, so no two answers are near duplicates; a
    // branded batch names the brand it was given.
    const brand = user.reference_evidence.brand_name;
    const named = typeof brand === 'string' && brand ? brand + ' ' : '';
    const prompts = user.slots.map((slot) => ({
      slot_id: slot.slot_id,
      text: `Which ${named}running shoes suit ${slot.slot_id}style runners on ${slot.slot_id}grade trails?`,
      buyer_stage: 'consideration',
      prompt_intent: 'recommend',
    }));
    return Response.json({ choices: [{ message: { content: JSON.stringify({ prompts }) } }] });
  };
  // A throw becomes a rejection, as a real fetch would.
  const fetch = vi.fn<typeof globalThis.fetch>((_url, init) =>
    Promise.resolve().then(() => answer(init)),
  );
  const gateway = createModelGateway(
    {
      ...gatewaySettings({}),
      apiKey: 'test-only',
      model: 'claude-haiku-5-5',
      baseUrl: 'https://model.test',
    },
    { fetch, sleep: async () => {} },
  );
  return { gateway: () => gateway, judge: () => null, io: { fetch } };
}
