import { getEventListeners } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { waitForPoll } from '../src/workers/poll.ts';

describe('worker polling', () => {
  it('releases each idle listener and wakes immediately when aborted', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    try {
      for (let cycle = 0; cycle < 3; cycle += 1) {
        const waiting = waitForPoll(1000, controller.signal);
        await vi.advanceTimersByTimeAsync(1000);
        await waiting;
        expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
      }
      const waiting = waitForPoll(1000, controller.signal);
      controller.abort();
      await waiting;
      expect(vi.getTimerCount()).toBe(0);
      await waitForPoll(1000, controller.signal);
    } finally {
      vi.useRealTimers();
    }
  });
});
