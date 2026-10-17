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

  it('retries 408 / 429 / 5xx', () => {
    expect(shouldRetryQuery(0, new ApiError('timeout', 408, ''))).toBe(true);
    expect(shouldRetryQuery(0, new ApiError('rate', 429, ''))).toBe(true);
    expect(shouldRetryQuery(0, new ApiError('down', 500, ''))).toBe(true);
    expect(shouldRetryQuery(0, new ApiError('down', 503, ''))).toBe(true);
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

  it('caps retries at 2 regardless of error kind', () => {
    expect(shouldRetryQuery(2, new ApiError('down', 503, ''))).toBe(false);
  });

  it('retries the A3 timeout surface (retryable network-class ApiError)', () => {
    const timeout = new ApiError('timed out', 0, '', 'req-t', {
      code: 'request_timeout',
      retryable: true,
    });
    expect(shouldRetryQuery(0, timeout)).toBe(true);
    expect(shouldRetryQuery(1, timeout)).toBe(true);
    expect(shouldRetryQuery(2, timeout)).toBe(false);
  });

  it('honors an explicit retryable classification over the status heuristic', () => {
    // Server-classified non-retryable 5xx → no futile retry.
    expect(
      shouldRetryQuery(0, new ApiError('down', 503, '', undefined, { retryable: false })),
    ).toBe(false);
    // Server-classified retryable → retry even without a transient status.
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
    expect(queries?.staleTime).toBe(60_000);
    expect(queries?.gcTime).toBe(30 * 60_000);
    expect(queries?.refetchOnWindowFocus).toBe(false);
    expect(client.getDefaultOptions().mutations?.retry).toBe(false);
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
});

describe('warmQuery', () => {
  const KEY = ['visibility', 'trends', 'project-a'] as const;

  it('warms a key nothing has fetched yet', async () => {
    const queryFn = vi.fn(async () => ({ ok: true }));
    const app = createAppQueryClient();

    warmQuery(app, { queryKey: KEY, queryFn });

    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1));
  });

  /**
   * Tab and link intent fires on the ACTIVE target too. Re-driving a key that
   * already failed resets `error` → `pending`, so the settled alert a panel is
   * rendering would be replaced by its skeleton until the identical failure
   * returns — hovering a tab visibly reloading its own content.
   */
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
