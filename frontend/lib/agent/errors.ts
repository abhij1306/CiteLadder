import { ApiError } from '@/lib/api/errors';
import { mutationNoticeForError, type MutationNotice } from '@/lib/api/mutation-notice';

/** A refused Agent write as the shared failure notice, and whether a new chat helps. */
export type AgentWriteFailure = MutationNotice & { startNewChat: boolean };

type AgentCopy = { message: string; startNewChat: boolean };

const CODED: {
  agent_funding_unavailable: AgentCopy;
  [code: string]: AgentCopy;
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
  agent_turn_limit: {
    message: 'This chat has reached its turn limit. Start a new chat to continue.',
    startNewChat: true,
  },
  agent_output_conflict: {
    message: 'The output changed since you opened it. Review the latest revision and try again.',
    startNewChat: false,
  },
};

function agentCopy(error: unknown): AgentCopy | undefined {
  if (!(error instanceof ApiError)) return undefined;
  const coded = error.code ? CODED[error.code] : undefined;
  if (coded) return coded;
  if (error.status === 402) return CODED.agent_funding_unavailable;
  if (error.status === 429)
    return {
      message: 'The workspace has reached its agent usage limit. Try again later.',
      startNewChat: false,
    };
  return undefined;
}

/**
 * The notice for a refused Agent write: the A4 notice for `action`, with the
 * Agent's own copy for the refusals it knows.
 */
export function agentWriteFailure(error: unknown, action: string): AgentWriteFailure {
  const notice = mutationNoticeForError(error, { action });
  const copy = agentCopy(error);
  if (!copy) return { ...notice, startNewChat: false };
  return { ...notice, message: copy.message, startNewChat: copy.startNewChat };
}
