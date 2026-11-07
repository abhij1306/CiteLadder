import { describe, expect, it } from 'vite-plus/test';

import { pollWhileActive } from './poll';

const STATES = {
  running: { active: true },
  done: { active: false },
  failed: { active: false },
} as const;

describe('pollWhileActive', () => {
  it('polls at the interval while any listed job is active', () => {
    expect(pollWhileActive(STATES, 2_500, ['done', 'running', 'failed'])).toBe(2_500);
    expect(pollWhileActive(STATES, 2_500, 'running')).toBe(2_500);
  });

  it('stops once every listed job is terminal', () => {
    expect(pollWhileActive(STATES, 2_500, ['done', 'failed'])).toBe(false);
    expect(pollWhileActive(STATES, 2_500, 'done')).toBe(false);
  });

  it('does not poll before the first read lands', () => {
    expect(pollWhileActive(STATES, 2_500, undefined)).toBe(false);
  });
});
