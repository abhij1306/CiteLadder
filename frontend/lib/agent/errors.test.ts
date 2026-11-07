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
