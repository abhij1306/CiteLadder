import { z } from 'zod';
import type { Selectable } from 'kysely';
import type { AgentChats, AgentRuns, AgentModelAttempts } from '../generated/db-schema.ts';
import { policy } from '../config.ts';
import type { ContentFormat } from '../config/skill-inputs.ts';
import type { WorkflowCatalog } from './workflows.ts';

export const agentPolicy = policy.agent;
export type Chat = Selectable<AgentChats>;
export type Run = Selectable<AgentRuns>;
export type ModelAttempt = Selectable<AgentModelAttempts>;
export type Json = z.infer<ReturnType<typeof z.json>>;
export type Scope = { workspaceId: string; projectId: string; userId: string };
export type Lease = { runId: string; workspaceId: string; owner: string; attempt: number };
export class AgentError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}
/** A run's frozen limits: what admission granted, never re-read from live config. */
export const budgetSchema = z.object({
  version: z.literal(1),
  max_model_calls: z.number().int().positive(),
  max_tool_calls: z.number().int().nonnegative(),
  max_parallel_tool_calls: z.number().int().positive(),
  limit_reminder_calls: z.number().int().nonnegative(),
  reasoning_effort: z.enum(['low', 'medium', 'high']),
  compaction_trigger_tokens: z.number().int().positive(),
  replay_max_chars: z.number().int().positive(),
  execution_timeout_seconds: z.number().positive(),
  tool_result_max_chars: z.number().int().positive(),
  context_package_max_chars: z.number().int().positive(),
  reply_max_chars: z.number().int().positive(),
  output_body_max_chars: z.number().int().positive(),
  output_title_max_chars: z.number().int().positive(),
});
export type Budget = z.infer<typeof budgetSchema>;
export function admittedBudget(executionTimeoutSeconds: number) {
  return budgetSchema.parse({
    ...agentPolicy,
    version: 1,
    execution_timeout_seconds: executionTimeoutSeconds,
  });
}
export const outputPayloadSchema = z
  .object({
    title: z.string().trim().min(1).max(agentPolicy.output_title_max_chars),
    body: z.string().trim().min(1).max(agentPolicy.output_body_max_chars),
    phase: z.enum(['outline', 'draft', 'final']),
    target_kind: z.enum(['page', 'planned_page']).nullish(),
    target: z.string().nullish(),
    format_id: z.string().nullish(),
  })
  .strict();
export type OutputBounds = Pick<
  typeof agentPolicy,
  'output_title_max_chars' | 'output_body_max_chars'
>;
export function outputSchema(bounds: OutputBounds = agentPolicy) {
  return outputPayloadSchema.extend({
    title: z.string().trim().min(1).max(bounds.output_title_max_chars),
    body: z.string().trim().min(1).max(bounds.output_body_max_chars),
  });
}
export type OutputPayload = z.infer<typeof outputPayloadSchema>;
export type Skill = {
  id: string;
  description: string;
  version: number;
  outputKind: string;
  body: string;
  outlineFirst: boolean;
};
export type SkillCatalog = {
  version: string;
  operatingContract: string;
  skills: ReadonlyMap<string, Skill>;
  formatPreamble?: string;
  formats?: ReadonlyMap<string, ContentFormat>;
  workflows?: WorkflowCatalog;
};
