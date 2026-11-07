import { describe, expect, it } from 'vite-plus/test';

import { RANGE_TASK_POLL_MS } from '@/lib/config/operational';
import { pollRangeTask } from './status';

describe('range-task polling', () => {
  it('keeps polling a task it has not read yet and one still in the queue', () => {
    expect(pollRangeTask(undefined)).toBe(RANGE_TASK_POLL_MS);
    expect(pollRangeTask('retry_wait')).toBe(RANGE_TASK_POLL_MS);
  });

  it('stops once the task is terminal', () => {
    expect(pollRangeTask('succeeded')).toBe(false);
    expect(pollRangeTask('failed')).toBe(false);
    expect(pollRangeTask('cancelled')).toBe(false);
  });
});
