import { describe, expect, it } from 'vite-plus/test';

import { SYNC_RUN_POLL_MS } from '@/lib/config/operational';
import { isSyncInFlight, pollSyncRun } from './status';

describe('sync-run polling', () => {
  it('keeps polling a run it has not read yet', () => {
    expect(pollSyncRun(undefined)).toBe(SYNC_RUN_POLL_MS);
  });

  it('keeps polling while the import runs or its reports are still rebuilding', () => {
    expect(pollSyncRun({ status: 'retry_wait', processing: false })).toBe(SYNC_RUN_POLL_MS);
    expect(pollSyncRun({ status: 'succeeded', processing: true })).toBe(SYNC_RUN_POLL_MS);
    expect(isSyncInFlight({ status: 'succeeded', processing: true })).toBe(true);
  });

  it('stops once the import is terminal and the reports are rebuilt', () => {
    expect(pollSyncRun({ status: 'succeeded', processing: false })).toBe(false);
    expect(pollSyncRun({ status: 'failed', processing: false })).toBe(false);
    expect(isSyncInFlight({ status: 'cancelled', processing: false })).toBe(false);
    expect(isSyncInFlight({ status: 'leased', processing: false })).toBe(true);
  });
});
