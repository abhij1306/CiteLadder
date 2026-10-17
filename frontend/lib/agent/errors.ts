import { ApiError, humanizeApiError } from '@/lib/api/errors';

/** What a refused Agent write means to the reader, and whether a new chat helps. */
export type AgentWriteFailure = { message: string; startNewChat: boolean };

const CODED: {
  agent_funding_unavailable: AgentWriteFailure;
  [code: string]: AgentWriteFailure;
} = {
  agent_funding_unavailable: {
    message:
      "No Agent model is configured. Set DEFAULT_AGENT_API_KEY, DEFAULT_AGENT_BASE_URL and DEFAULT_AGENT_MODEL in the server's .env, then restart.",
    startNewChat: false,
  },
  agent_model_unavailable: {
    message: 'The connected AI model is unavailable. Check Providers in Settings, then try again.',
    startNewChat: false,
  },
  agent_run_active: {
    message: 'Wait for the agent to finish its current turn, then try again.',
    startNewChat: false,
  },
  agent_skill_kind_conflict: {
    message: 'That skill produces a different kind of output. Start a new chat for it.',
    startNewChat: true,
  },
  agent_turn_limit: {
    message: 'This chat has reached its turn limit. Start a new chat to continue.',
    startNewChat: true,
  },
  agent_output_conflict: {
    message: 'The output changed since you opened it. Review the latest revision and try again.',
    startNewChat: false,
  },
  agent_outline_not_approvable: {
    message: 'Only the latest outline can be approved.',
    startNewChat: false,
  },
};

export function agentWriteFailure(error: unknown): AgentWriteFailure {
  if (error instanceof ApiError) {
    const coded = error.code ? CODED[error.code] : undefined;
    if (coded) return coded;
    if (error.status === 429)
      return {
        message: 'The workspace has reached its agent usage limit. Try again later.',
        startNewChat: false,
      };
  }
  return { message: humanizeApiError(error).message, startNewChat: false };
}
