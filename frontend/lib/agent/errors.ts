import { ApiError } from '@/lib/api/errors';
import { mutationNoticeForError, type MutationNotice } from '@/lib/api/mutation-notice';
import { SUGGESTION_CONFLICT_COPY } from '@/lib/agent/vocabulary';

type AgentRecovery = 'new-chat' | 'connect-model' | null;

export type AgentWriteFailure = MutationNotice & { recovery: AgentRecovery };

type AgentCopy = { message: string; recovery: AgentRecovery };

const CODED: {
  agent_model_unavailable: AgentCopy;
  [code: string]: AgentCopy;
} = {
  agent_model_unavailable: {
    message:
      "No Agent model is configured. Set DEFAULT_AGENT_API_KEY, DEFAULT_AGENT_BASE_URL and DEFAULT_AGENT_MODEL in the server's .env, then restart.",
    recovery: null,
  },
  model_changed: {
    message: 'The Agent model changed on the server. Send your message again.',
    recovery: null,
  },
  agent_run_active: {
    message: 'Wait for the agent to finish its current turn, then try again.',
    recovery: null,
  },
  agent_turn_limit: {
    message: 'This chat has reached its turn limit. Start a new chat to continue.',
    recovery: 'new-chat',
  },
  agent_output_conflict: {
    message: 'The output changed since you opened it. Review the latest revision and try again.',
    recovery: null,
  },
};

function agentCopy(error: unknown): AgentCopy | undefined {
  if (!(error instanceof ApiError)) return undefined;
  if (error.code === 'agent_suggestion_conflict')
    return { message: error.message.trim() || SUGGESTION_CONFLICT_COPY, recovery: null };
  const coded = error.code ? CODED[error.code] : undefined;
  if (coded) return coded;
  if (error.status === 429)
    return {
      message: 'The workspace has reached its agent usage limit. Try again later.',
      recovery: null,
    };
  return undefined;
}

export function isOutputConflict(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'agent_output_conflict';
}

export function agentWriteFailure(error: unknown, action: string): AgentWriteFailure {
  const notice = mutationNoticeForError(error, { action });
  const copy = agentCopy(error);
  if (!copy) return { ...notice, recovery: null };
  return { ...notice, message: copy.message, recovery: copy.recovery };
}
