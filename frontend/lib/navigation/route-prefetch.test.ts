import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import { prefetchRoute } from './route-prefetch';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT = {
  projectId: PROJECT_ID,
  workspaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
};

vi.mock('@/lib/api/demand', () => ({
  demandApi: { getLatest: vi.fn(async () => ({ id: 'snapshot' })) },
}));

import { demandApi } from '@/lib/api/demand';

describe('prefetchRoute', () => {
  let client: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } });
  });

  it('does nothing without an active project', () => {
    prefetchRoute(client, '/demand', null);
    expect(demandApi.getLatest).not.toHaveBeenCalled();
  });

  it('warms the Search Demand snapshot on intent', async () => {
    prefetchRoute(client, '/demand', PROJECT);
    await vi.waitFor(() => expect(demandApi.getLatest).toHaveBeenCalledTimes(1));
  });

  /**
   * Search Demand renders a settled "no snapshot exists yet" alert from a 404.
   * Re-driving that key would reset `error` → `pending`, so the alert would be
   * replaced by the full-page skeleton for the length of the repeat request.
   */
  it('leaves an already-failed query untouched so a settled error cannot flicker', async () => {
    vi.mocked(demandApi.getLatest).mockRejectedValueOnce(new Error('404'));
    await client
      .fetchQuery({
        queryKey: ['demand', PROJECT_ID, 'latest'],
        queryFn: () => demandApi.getLatest(PROJECT_ID),
      })
      .catch(() => undefined);

    const query = client.getQueryCache().find({ queryKey: ['demand', PROJECT_ID, 'latest'] });
    expect(query?.state.status).toBe('error');
    const callsAfterFailure = vi.mocked(demandApi.getLatest).mock.calls.length;

    prefetchRoute(client, '/demand', PROJECT);
    await Promise.resolve();

    expect(vi.mocked(demandApi.getLatest).mock.calls).toHaveLength(callsAfterFailure);
    expect(query?.state.status).toBe('error');
  });
});
