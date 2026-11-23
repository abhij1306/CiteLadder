import { agentReasoningEffortSchema, type AgentReasoningEffort } from '@citeladder/contracts/agent';
import { ConfigError } from '../config/config-error.ts';
import type { Database } from '../db/database.ts';
import { AgentError, agentPolicy, type Chat, type Scope } from './contracts.ts';

export type ModelChoice = { model: string; effort: AgentReasoningEffort };
export type RequestedChoice = { model?: string | null; effort?: AgentReasoningEffort | null };

const offered = new Set(agentPolicy.models.map((option) => option.id));

function validated(): ModelChoice {
  if (!offered.has(agentPolicy.default_model))
    throw new ConfigError(`The Agent default model ${agentPolicy.default_model} is not offered`);
  return {
    model: agentPolicy.default_model,
    effort: agentReasoningEffortSchema.parse(agentPolicy.reasoning_effort),
  };
}
export const DEFAULT_CHOICE = validated();

export function requireOffered(model: string) {
  if (!offered.has(model)) throw new AgentError('model_unavailable');
  return model;
}

export function newChatChoice(requested: RequestedChoice): ModelChoice {
  return {
    model: requireOffered(requested.model ?? DEFAULT_CHOICE.model),
    effort: requested.effort ?? DEFAULT_CHOICE.effort,
  };
}

export async function modelLocked(
  db: Database,
  scope: Pick<Scope, 'workspaceId' | 'projectId'>,
  chatId: string,
) {
  const replied = await db
    .selectFrom('agent_run_transcripts')
    .select('id')
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('chat_id', '=', chatId)
    .limit(1)
    .executeTakeFirst();
  return replied !== undefined;
}

export async function turnChoice(
  db: Database,
  scope: Scope,
  chat: Chat,
  requested: RequestedChoice,
): Promise<ModelChoice> {
  const model = requested.model ?? chat.model;
  if (model !== chat.model && (await modelLocked(db, scope, chat.id)))
    throw new AgentError('model_locked');
  return {
    model: requireOffered(model),
    effort: requested.effort ?? agentReasoningEffortSchema.parse(chat.reasoning_effort),
  };
}
