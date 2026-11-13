import { expect, it } from 'vite-plus/test';

import { ApiError } from '@/lib/api/errors';
import { agentWriteFailure } from './errors';

it('reads a refused Agent write as the shared notice with the Agent copy and support code', () => {
  const limit = new ApiError('turn limit', 409, '{}', 'req-9', { code: 'agent_turn_limit' });
  expect(agentWriteFailure(limit, 'send the message')).toEqual({
    message: 'This chat has reached its turn limit. Start a new chat to continue.',
    retryable: false,
    code: 'agent_turn_limit',
    requestId: 'req-9',
    startNewChat: true,
  });
  expect(agentWriteFailure(new TypeError('Failed to fetch'), 'send the message')).toEqual({
    message:
      'Could not send the message — the request failed or timed out. This is usually temporary; try again.',
    retryable: true,
    code: undefined,
    requestId: undefined,
    startNewChat: false,
  });
});

it('shows the server’s reason for a refused suggestion change, with a fallback when it gives none', () => {
  const refused = (message: string) =>
    new ApiError(message, 409, '{}', 'req-4', { code: 'agent_suggestion_conflict' });
  expect(
    agentWriteFailure(refused('This suggestion was already applied.'), 'change the suggestion')
      .message,
  ).toBe('This suggestion was already applied.');
  expect(agentWriteFailure(refused('  '), 'change the suggestion').message).toBe(
    'This suggestion can’t be changed now. Reload the page and try again.',
  );
});
