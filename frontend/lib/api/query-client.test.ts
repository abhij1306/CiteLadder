import { describe, expect, it, vi } from 'vite-plus/test';

import { ApiError } from './errors';
import {
  createAppQueryClient,
  retainPreviousDataForScope,
  shouldRetryQuery,
  warmQuery,
} from './query-client';

describe('shouldRetryQuery', () => {
  it('retries network / unknown errors up to the cap', () => {
    expect(shouldRetryQuery(0, new Error('offline'))).toBe(true);
    expect(shouldRetryQuery(1, new Error('offline'))).toBe(true);
    expect(shouldRetryQuery(2, new Error('offline'))).toBe(false);
  });

  it('retries 408 / 429 / 5xx once, so a server error surfaces quickly', () => {
    for (const status of [408, 429, 500, 503]) {
      expect(shouldRetryQuery(0, new ApiError('down', status, ''))).toBe(true);
      expect(shouldRetryQuery(1, new ApiError('down', status, ''))).toBe(false);
    }
  });

  it('does not retry ordinary 4xx', () => {
    expect(shouldRetryQuery(0, new ApiError('bad', 400, ''))).toBe(false);
    expect(shouldRetryQuery(0, new ApiError('unauth', 401, ''))).toBe(false);
    expect(shouldRetryQuery(0, new ApiError('forbidden', 403, ''))).toBe(false);
    expect(shouldRetryQuery(0, new ApiError('missing', 404, ''))).toBe(false);
  });

  it('never retries aborts', () => {
    expect(shouldRetryQuery(0, new DOMException('Aborted', 'AbortError'))).toBe(false);
  });

  it('retries the A3 timeout surface once, since each attempt already waited the full timeout', () => {
    const timeout = new ApiError('timed out', 0, '', 'req-t', {
      code: 'request_timeout',
      retryable: true,
    });
    expect(shouldRetryQuery(0, timeout)).toBe(true);
    expect(shouldRetryQuery(1, timeout)).toBe(false);
  });

  it('honors an explicit retryable classification over the status heuristic', () => {
    expect(
      shouldRetryQuery(0, new ApiError('down', 503, '', undefined, { retryable: false })),
    ).toBe(false);
    expect(shouldRetryQuery(0, new ApiError('busy', 400, '', undefined, { retryable: true }))).toBe(
      true,
    );
  });
});

describe('createAppQueryClient', () => {
  it('installs the retry policy and stale defaults', () => {
    const client = createAppQueryClient();
    const queries = client.getDefaultOptions().queries;
    expect(queries?.retry).toBe(shouldRetryQuery);
    expect(queries?.retryDelay).toBe(500);
    expect(queries?.staleTime).toBe(60_000);
    expect(queries?.gcTime).toBe(30 * 60_000);
    expect(queries?.refetchOnWindowFocus).toBe(false);
    expect(client.getDefaultOptions().mutations?.retry).toBe(false);
  });
});

describe('a failing read on the app client', () => {
  it('settles on the error after one quick retry instead of retrying silently', async () => {
    const queryFn = vi.fn(async () => {
      throw new ApiError('down', 500, '');
    });
    const app = createAppQueryClient();

    await expect(app.fetchQuery({ queryKey: ['read'], queryFn })).rejects.toThrow('down');

    expect(queryFn).toHaveBeenCalledTimes(2);
  });
});

describe('retainPreviousDataForScope', () => {
  const previousData = { project_id: 'project-a', total: 7 };

  it('retains data for filter changes within the same owner scope', () => {
    expect(
      retainPreviousDataForScope('project-a', previousData, {
        queryKey: ['traffic', 'dashboard', 'project-a', { granularity: 'day' }],
      }),
    ).toBe(previousData);
  });

  it('drops data when the active owner scope changes', () => {
    expect(
      retainPreviousDataForScope('project-b', previousData, {
        queryKey: ['traffic', 'dashboard', 'project-a', { granularity: 'day' }],
      }),
    ).toBeUndefined();
  });

  it('finds the scope in keys that put the workspace before the project', () => {
    const key = ['ai-traffic', 'workspace-1', 'project-a', 'crawlers', { cursor: 'c2' }];
    expect(retainPreviousDataForScope('project-a', previousData, { queryKey: key })).toBe(
      previousData,
    );
    expect(
      retainPreviousDataForScope('project-b', previousData, { queryKey: key }),
    ).toBeUndefined();
  });
});

describe('warmQuery', () => {
  const KEY = ['visibility', 'trends', 'project-a'] as const;

  it('warms a key nothing has fetched yet', async () => {
    const queryFn = vi.fn(async () => ({ ok: true }));
    const app = createAppQueryClient();

    warmQuery(app, { queryKey: KEY, queryFn });

    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1));
  });

  it('leaves an already-failed key untouched so a settled error cannot flicker', async () => {
    const queryFn = vi.fn(async () => {
      throw new ApiError('gone', 404, '');
    });
    const app = createAppQueryClient();
    await app.fetchQuery({ queryKey: KEY, queryFn }).catch(() => undefined);
    const query = app.getQueryCache().find({ queryKey: KEY });
    expect(query?.state.status).toBe('error');
    const callsAfterFailure = queryFn.mock.calls.length;

    warmQuery(app, { queryKey: KEY, queryFn });
    await Promise.resolve();

    expect(queryFn.mock.calls).toHaveLength(callsAfterFailure);
    expect(query?.state.status).toBe('error');
  });
});
