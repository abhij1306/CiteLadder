import { describe, expect, it } from 'vite-plus/test';

import { isActiveSyncRun, isSucceededSyncRun, SYNC_RUN_POLL_MS } from './sync-runs';

describe('sync-run polling idiom', () => {
  it('polls at the shared 3s cadence', () => {
    expect(SYNC_RUN_POLL_MS).toBe(3_000);
  });

  it('treats queued/leased/running/retry_wait as non-terminal', () => {
    expect(isActiveSyncRun('queued')).toBe(true);
    expect(isActiveSyncRun('leased')).toBe(true);
    expect(isActiveSyncRun('running')).toBe(true);
    expect(isActiveSyncRun('retry_wait')).toBe(true);
  });

  it('treats succeeded/failed/cancelled as terminal', () => {
    expect(isActiveSyncRun('succeeded')).toBe(false);
    expect(isActiveSyncRun('failed')).toBe(false);
    expect(isActiveSyncRun('cancelled')).toBe(false);
  });

  it('only succeeded counts as a successful outcome', () => {
    expect(isSucceededSyncRun('succeeded')).toBe(true);
    expect(isSucceededSyncRun('failed')).toBe(false);
    expect(isSucceededSyncRun('cancelled')).toBe(false);
  });
});
