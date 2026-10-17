import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Database } from '../src/db/database.ts';
import type { Json, Scope, SkillCatalog } from '../src/agent/contracts.ts';
import { blockText, blockToolCalls, type ConversationBlock } from '../src/models/conversation.ts';
import { AgentStore, type FundingIdentity } from '../src/agent/store.ts';
import { SELF_HOSTED } from '../src/agent/funding.ts';
import { AgentQueue } from '../src/agent/queue.ts';
import {
  ModelCalls,
  type AgentModel,
  type Funding,
  type ModelResult,
  type ModelRequest,
} from '../src/agent/model-calls.ts';
import { AgentRuntime } from '../src/agent/runtime.ts';
import { ToolRegistry } from '../src/agent/tools.ts';
import { VisibilityFixtures } from './visibility-fixtures.ts';

export const catalog: SkillCatalog = {
  version: 'test-skills-1',
  operatingContract: 'Use only supplied evidence.',
  skills: new Map([
    [
      'content',
      {
        id: 'content',
        description: 'Create requested long-form content.',
        version: 1,
        outputKind: 'content',
        body: 'Write requested content.',
        outlineFirst: true,
      },
    ],
    [
      'plan',
      {
        id: 'plan',
        description: 'Turn supplied evidence into a bounded plan.',
        version: 1,
        outputKind: 'plan',
        body: 'Plan requested work.',
        outlineFirst: false,
      },
    ],
  ]),
};
export const emptyPackage = {
  version: 'content-context-v1',
  brand_block: '',
  target_page_block: '',
  issue_block: '',
  related_site_block: '',
  summary: { omissions: [{ reason: 'no_persisted_evidence', count: 1 }] },
  sections: {},
};
/** One scripted model response: the content blocks a provider would return. */
export type Response = ConversationBlock[];
export const text = (value: string): ConversationBlock => ({ type: 'text', text: value });
export const toolUse = (
  name: string,
  input: Record<string, Json> = {},
  id = `toolu_${randomUUID().slice(0, 8)}`,
): ConversationBlock => ({ type: 'tool_use', id, name, input });
export const reply = (value = 'Answer from supplied evidence.'): Response => [text(value)];
export const read = (input: Record<string, Json> = {}, name = 'read_evidence'): Response => [
  toolUse(name, input),
];
export const loadSkill = (skillId: string): Response => [
  toolUse('load_skill', { skill_id: skillId }),
];
export const save = (
  phase = 'draft',
  body = 'Requested document',
  extra: Record<string, Json> = {},
): Response => [toolUse('save_document', { title: 'Document', body, phase, ...extra })];
/** A request for a dispatch that never reaches a model. */
export const request: ModelRequest = {
  system: 'test',
  tools: [],
  messages: [{ role: 'user', content: [text('test')] }],
  effort: 'medium',
  compactAtTokens: 80_000,
};
export function result(blocks: Response, overrides: Partial<ModelResult> = {}): ModelResult {
  const toolCalls = blockToolCalls(blocks);
  const stop = toolCalls.length ? 'tool_use' : 'end_turn';
  return {
    blocks,
    text: blockText(blocks),
    toolCalls,
    stop,
    provider_adapter: 'test',
    endpoint_host: 'model.example.test',
    requested_model: 'test-model',
    returned_model: 'test-model',
    usage: { input_tokens: 20, output_tokens: 10 },
    latency_ms: 1,
    finish_status: stop,
    ...overrides,
  };
}
/** A model that returns `responses` in order, then plain replies; it streams as a provider does. */
export function scripted(
  responses: (Response | ModelResult)[],
  onCall?: (request: ModelRequest, ordinal: number) => Promise<void>,
): AgentModel {
  let count = 0;
  return {
    model: 'test-model',
    adapter: 'test',
    endpointHost: 'model.example.test',
    converse: async (request, _signal, listener) => {
      const ordinal = ++count;
      await onCall?.(request, ordinal);
      const next = responses[ordinal - 1] ?? reply();
      const outcome = Array.isArray(next) ? result(next) : next;
      for (const block of outcome.blocks)
        if (block.type === 'thinking') listener?.thinking?.(String(block.thinking ?? ''));
      const half = Math.ceil(outcome.text.length / 2);
      if (outcome.text) {
        listener?.text?.(outcome.text.slice(0, half));
        listener?.text?.(outcome.text.slice(half));
      }
      for (const call of outcome.toolCalls) listener?.toolInput?.(call.name, call.input);
      return outcome;
    },
  };
}
export const zeroFunding: Funding = {
  reserve: () => Promise.resolve({ reservationId: null, credits: 0, pricingRevision: '' }),
  settle: () => Promise.resolve({ credits: 0, status: 'zero_debit' }),
};
export class AgentFixtures extends VisibilityFixtures {
  readonly agentDb: Database;
  readonly scopes: Scope[] = [];
  constructor(db: Database) {
    super(db);
    this.agentDb = db;
  }
  async scope() {
    const scope = await this.tenant();
    this.scopes.push(scope);
    return scope;
  }
  store(overrides: Partial<AgentStore['dependencies']> = {}) {
    return new AgentStore(this.agentDb, {
      catalog,
      registryVersion: 'test-tools-1',
      timeoutSeconds: 10,
      admission: () =>
        Promise.resolve({
          funding_source: SELF_HOSTED,
          requested_model: 'test-model',
        } satisfies FundingIdentity),
      context: () => Promise.resolve(emptyPackage),
      ...overrides,
    });
  }
  tools(scope: Scope) {
    return new ToolRegistry('test-tools-1', [
      {
        name: 'read_evidence',
        description: 'Read persisted fixture evidence.',
        arguments: z.object({}).strict(),
        read: (received) => {
          if (received.projectId !== scope.projectId)
            return Promise.reject(new Error('Wrong server-pinned project'));
          return Promise.resolve({
            state: 'available',
            data: { observed: 0 },
            artifactRefs: [
              { id: scope.projectId, record_uri: `citeladder://project/${scope.projectId}` },
            ],
            omissions: [],
          });
        },
      },
    ]);
  }
  runtime(scope: Scope, model: AgentModel, overrides: Partial<AgentRuntime['deps']> = {}) {
    return new AgentRuntime(this.agentDb, {
      catalog,
      tools: this.tools(scope),
      models: new ModelCalls(this.agentDb, zeroFunding),
      modelFor: () => model,
      attachTarget: (_db, _chat, _output, payload) =>
        payload.target
          ? Promise.reject(
              new Error('Target adapter is deliberately not configured in this fixture'),
            )
          : Promise.resolve(),
      ...overrides,
    });
  }
  async claimed(
    scope: Scope,
    options: { skillId?: string; message?: string; chatId?: string } = {},
  ) {
    const run = await this.store().enqueue(scope, {
      message: options.message ?? 'Please help.',
      key: randomUUID(),
      ...options,
    });
    const queue = new AgentQueue(this.agentDb, 30);
    const claimed = await queue.claim('test-worker', [scope.workspaceId]);
    if (claimed?.id !== run.id) throw new Error('Unexpected claim');
    const lease = await queue.start(claimed, 'test-worker');
    return { run, lease, queue };
  }
  run(id: string) {
    return this.agentDb
      .selectFrom('agent_runs')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
  }
  async cleanup() {
    if (this.scopes.length)
      await this.agentDb
        .deleteFrom('agent_model_attempts')
        .where(
          'workspace_id',
          'in',
          this.scopes.map((scope) => scope.workspaceId),
        )
        .execute();
    await super.cleanup();
  }
}
export { agentPolicy } from '../src/agent/contracts.ts';
