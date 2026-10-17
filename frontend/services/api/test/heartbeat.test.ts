import { describe, expect, it, vi } from 'vitest';
import { maintainLease } from '../src/queue/heartbeat.ts';

describe('lease renewal tolerance', () => {
  it('resets consecutive failures after recovery and stops on definite loss', async () => {
    vi.useFakeTimers();
    const renew = vi
      .fn<() => Promise<boolean>>()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce(false);
    const lease = maintainLease(renew, 10);
    try {
      await vi.advanceTimersByTimeAsync(30);
      expect(lease.signal.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(10);
      expect(lease.signal.aborted).toBe(true);
      await vi.advanceTimersByTimeAsync(20);
      expect(renew).toHaveBeenCalledTimes(4);
    } finally {
      await lease.stop();
      vi.useRealTimers();
    }
  });
  it('never overlaps renewals and drains the current one on stop', async () => {
    vi.useFakeTimers();
    let release!: (live: boolean) => void;
    const renew = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          release = resolve;
        }),
    );
    const lease = maintainLease(renew, 10);
    try {
      await vi.advanceTimersByTimeAsync(50);
      expect(renew).toHaveBeenCalledTimes(1);
      const stopped = lease.stop();
      release(true);
      await stopped;
      await vi.advanceTimersByTimeAsync(20);
      expect(renew).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
