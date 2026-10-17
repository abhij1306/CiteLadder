import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function errorJson(body: unknown, status: number, statusText = 'Error') {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * The `RequestInit` of a recorded fetch call, or a failure naming the missing
 * call. Written this way because `calls[i]?.[1] as RequestInit` promised a
 * safety the cast then threw away: a missing call short-circuited to
 * `undefined` and the next property read raised an opaque TypeError instead of
 * an assertion (oxlint `no-unsafe-optional-chaining`).
 */
function requestInitAt(mock: { mock: { calls: unknown[][] } }, index: number): RequestInit {
  const call = mock.mock.calls[index];
  if (!call) throw new Error(`expected a fetch call at index ${index}`);
  return call[1] as RequestInit;
}

describe('apiClient', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls a relative same-origin /api/v1 base URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);

    const { apiClient } = await import('./client');
    await apiClient.get('/ping');

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/api/v1/ping');
  });

  it('scopes a request to the workspace it names', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);

    const { apiClient } = await import('./client');
    await apiClient.get('/projects', { workspaceId: 'requested-workspace' });

    const headers = new Headers(requestInitAt(fetchMock, 0).headers);
    expect(headers.get('X-Workspace-Id')).toBe('requested-workspace');
  });

  it('replaces a workspace header the caller copied in', async () => {
    // A reused header object must not decide the tenancy of a request that
    // named its own workspace — that is the failure this option exists to
    // remove, so the explicit value wins rather than deferring.
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);

    const { apiClient } = await import('./client');
    await apiClient.get('/projects', {
      workspaceId: 'requested-workspace',
      headers: { 'X-Workspace-Id': 'stale-workspace' },
    });

    const headers = new Headers(requestInitAt(fetchMock, 0).headers);
    expect(headers.get('X-Workspace-Id')).toBe('requested-workspace');
  });

  it('keeps delayed cross-workspace requests bound to their original scope', async () => {
    let releaseFirst: ((response: Response) => void) | undefined;
    const firstResponse = new Promise<Response>((resolve) => {
      releaseFirst = resolve;
    });
    const seenWorkspaces: Array<string | null> = [];
    const fetchMock = vi.fn().mockImplementation((_path: string, init: RequestInit) => {
      seenWorkspaces.push(new Headers(init.headers).get('X-Workspace-Id'));
      return seenWorkspaces.length === 1
        ? firstResponse
        : Promise.resolve(jsonResponse({ id: 'b' }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const { apiClient } = await import('./client');
    const workspaceA = apiClient.get('/projects', { workspaceId: 'workspace-a' });
    const workspaceB = apiClient.get('/projects', { workspaceId: 'workspace-b' });

    await expect(workspaceB).resolves.toEqual({ id: 'b' });
    releaseFirst?.(jsonResponse({ id: 'a' }));
    await expect(workspaceA).resolves.toEqual({ id: 'a' });
    expect(seenWorkspaces).toEqual(['workspace-a', 'workspace-b']);
  });

  it('removes the workspace header entirely for an explicit null', async () => {
    // How a path-authorized read (`GET /projects/{id}`) asks the backend to
    // resolve access from the path instead of a header that may be wrong.
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);

    const { apiClient } = await import('./client');
    await apiClient.get('/projects/abc', {
      workspaceId: null,
      headers: { 'X-Workspace-Id': 'stale-workspace' },
    });

    const headers = new Headers(requestInitAt(fetchMock, 0).headers);
    expect(headers.has('X-Workspace-Id')).toBe(false);
  });

  it('throws ApiError with status and request id on 4xx', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('Bad Request', {
        status: 400,
        headers: { 'x-request-id': 'req-abc' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { apiClient, ApiError } = await import('./client');
    await expect(apiClient.get('/thing')).rejects.toMatchObject({
      name: 'ApiError',
      status: 400,
      requestId: 'req-abc',
    });
    // 4xx is not retried.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(ApiError).toBeDefined();
  });

  it('captures a numeric Retry-After hint on a rate-limited response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 'rate_limited',
            message: 'Workspace usage limit exceeded',
            request_id: 'req-rate-limit',
            retryable: true,
          },
        }),
        {
          status: 429,
          headers: {
            'content-type': 'application/json',
            'retry-after': '321.2',
            'x-request-id': 'req-rate-limit',
          },
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { apiClient } = await import('./client');
    await expect(apiClient.post('/brand-discoveries', {})).rejects.toMatchObject({
      status: 429,
      retryAfterSeconds: 322,
      requestId: 'req-rate-limit',
    });
  });

  it('throws ApiError on 5xx', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('Boom', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);

    const { apiClient } = await import('./client');
    await expect(apiClient.get('/thing')).rejects.toMatchObject({ status: 503 });
  });

  it('retries idempotent GET network failures then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    const { apiClient } = await import('./client');
    await expect(apiClient.get('/ping', { retryNetworkFailures: true })).resolves.toEqual({
      ok: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry ordinary GET network failures', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetchMock);

    const { apiClient } = await import('./client');
    await expect(apiClient.get('/ping')).rejects.toThrow('offline');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry mutation network failures', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetchMock);

    const { apiClient } = await import('./client');
    await expect(apiClient.post('/audits', { project_id: 'x' })).rejects.toThrow('offline');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('forwards AbortSignal and explicit request id', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);

    const { apiClient } = await import('./client');
    await apiClient.get('/ping', { signal: controller.signal, requestId: 'req-test' });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    // The caller's signal is composed with the bounded default timeout (A3) —
    // aborting the controller must still abort the request signal.
    expect(init.signal).toBeInstanceOf(AbortSignal);
    controller.abort();
    expect(init.signal?.aborted).toBe(true);
    expect(init.credentials).toBe('include');
    expect(init.cache).toBe('no-store');
    expect(new Headers(init.headers).get('X-Request-ID')).toBe('req-test');
  });

  it('uses a bounded per-request timeout override when supplied', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);

    const { apiClient } = await import('./client');
    await apiClient.post('/generate', {}, { timeoutMs: 195_000 });

    expect(timeoutSpy).toHaveBeenCalledWith(195_000);
  });

  it('rejects when an aborted signal fires during a retry backoff', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn().mockImplementation(() => {
      controller.abort();
      return Promise.reject(new Error('offline'));
    });
    vi.stubGlobal('fetch', fetchMock);

    const { apiClient } = await import('./client');
    await expect(
      apiClient.get('/ping', { retryNetworkFailures: true, signal: controller.signal }),
    ).rejects.toBeTruthy();
  });

  it('keeps ordinary GET requests header-free to avoid a CORS preflight', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);

    const { apiClient } = await import('./client');
    await apiClient.get('/ping');

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get('X-Request-ID')).toBeNull();
  });

  it('stamps a generated request id on mutations', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);

    const { apiClient } = await import('./client');
    await apiClient.post('/audits', { project_id: 'x' });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get('X-Request-ID')).toBeTruthy();
  });

  it('throws ApiError when a 2xx response is not JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('<html>ok</html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { apiClient } = await import('./client');
    await expect(apiClient.get('/thing')).rejects.toThrow('Expected JSON response from API.');
  });

  it('httpErrorStatus reads status from ApiError and duck-typed errors', async () => {
    const { ApiError, httpErrorStatus } = await import('./client');
    expect(httpErrorStatus(new ApiError('x', 403, '{}'))).toBe(403);
    expect(httpErrorStatus({ status: 401 })).toBe(401);
    expect(httpErrorStatus(new Error('no'))).toBeUndefined();
  });

  it('does not carry workspace scope from one request into the next', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({})));
    vi.stubGlobal('fetch', fetchMock);

    const { apiClient } = await import('./client');
    await apiClient.get('/projects', { workspaceId: 'ws-123' });
    await apiClient.get('/projects');
    expect(new Headers(requestInitAt(fetchMock, 0).headers).get('X-Workspace-Id')).toBe('ws-123');
    expect(new Headers(requestInitAt(fetchMock, 1).headers).get('X-Workspace-Id')).toBeNull();
  });
});

describe('readErrorBody extraction (A2)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('prefers the canonical envelope error.message / code / retryable / request_id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      errorJson(
        {
          error: {
            code: 'precondition_failed',
            message: 'no completed sync window is available',
            request_id: 'srv-req-1',
            retryable: false,
          },
        },
        422,
        'Unprocessable Entity',
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { apiClient } = await import('./client');
    await expect(apiClient.post('/x', {})).rejects.toMatchObject({
      message: 'no completed sync window is available',
      status: 422,
      code: 'precondition_failed',
      retryable: false,
      // No x-request-id header → the envelope's request_id backstops it.
      requestId: 'srv-req-1',
    });
  });

  it('never surfaces a raw JSON blob for an unrecognized payload shape', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(errorJson({ unexpected: 'shape' }, 400, 'Bad Request'));
    vi.stubGlobal('fetch', fetchMock);

    const { apiClient } = await import('./client');
    await expect(apiClient.get('/odd')).rejects.toMatchObject({ message: 'Bad Request' });
  });

  it('never surfaces a raw JSON blob when the JSON body is unparseable', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{"error": truncated', {
        status: 500,
        statusText: 'Internal Server Error',
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { apiClient } = await import('./client');
    await expect(apiClient.get('/broken')).rejects.toMatchObject({
      message: 'Internal Server Error',
    });
  });

  it('passes a plain-text error body through (Starlette plain-text 500)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('Internal Server Error', {
        status: 500,
        headers: { 'content-type': 'text/plain' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { apiClient } = await import('./client');
    await expect(apiClient.get('/boom')).rejects.toMatchObject({
      message: 'Internal Server Error',
      status: 500,
    });
  });
});

describe('request timeout (A3)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('surfaces a hung request as a retryable network-class ApiError', async () => {
    // A fetch that never settles; the client's AbortSignal.timeout ends it.
    vi.stubEnv('NEXT_PUBLIC_API_REQUEST_TIMEOUT_MS', '20');
    const fetchMock = vi.fn().mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          // Bind the signal once: inside the listener TS cannot re-narrow
          // `init.signal`, so reading `.reason` off it there fails the build.
          const signal = init.signal;
          signal?.addEventListener('abort', () => reject(signal.reason));
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { apiClient } = await import('./client');
    await expect(apiClient.get('/hang')).rejects.toMatchObject({
      name: 'ApiError',
      status: 0,
      code: 'request_timeout',
      retryable: true,
    });
    // No in-transport retry without the opt-in.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a timeout in-transport for an idempotent GET, then surfaces it', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_REQUEST_TIMEOUT_MS', '20');
    const fetchMock = vi.fn().mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          // Bind the signal once: inside the listener TS cannot re-narrow
          // `init.signal`, so reading `.reason` off it there fails the build.
          const signal = init.signal;
          signal?.addEventListener('abort', () => reject(signal.reason));
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { apiClient } = await import('./client');
    await expect(apiClient.get('/hang', { retryNetworkFailures: true })).rejects.toMatchObject({
      code: 'request_timeout',
      retryable: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never converts a caller abort into a timeout error', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn().mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          const signal = init.signal;
          signal?.addEventListener('abort', () => reject(signal.reason));
          controller.abort();
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { apiClient } = await import('./client');
    await expect(apiClient.get('/x', { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});
