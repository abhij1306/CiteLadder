/**
 * Typed HTTP transport.
 *
 * Same-origin only: the browser always calls a **relative** base (`/api/v1`);
 * The app Worker proxies `/api/v1` through protected origin transport.
 * The browser never sees a cross-origin backend URL, so there is
 * no CORS preflight and no cross-origin cookie handling.
 *
 * Guarantees:
 *   - `ApiError` on any non-2xx response, carrying status + body + request id
 *     (+ the envelope's machine `code` / `retryable` classification when the
 *     backend sends them — see `readErrorBody`).
 *   - `X-Request-ID` header on mutations (and GETs that opt in) for tracing.
 *   - `AbortSignal` forwarding.
 *   - a bounded default timeout per attempt (`getApiRequestTimeoutMs`, A3) —
 *     an expiry surfaces as a RETRYABLE network-class `ApiError`
 *     (`code: 'request_timeout'`), never an endless spinner; a caller's own
 *     abort stays a plain abort (never retried).
 *   - `credentials: 'include'` (HttpOnly JWT cookie) and `cache: 'no-cache'`: the
 *     browser stores only what the API lets it (a snapshot read's
 *     `private, no-cache`) and revalidates every use with `If-None-Match`.
 *   - bounded network-failure retry (max 2 attempts) for GET / idempotent calls
 *     only — never for ordinary mutations.
 *   - JSON enforcement: a 2xx response that is not JSON is a contract violation.
 */
import { retryAfterSeconds } from '@citeladder/contracts/retry-after';
import {
  API_BASE_URL,
  API_RETRY_BACKOFF_MS,
  getApiRequestTimeoutMs,
} from '@/lib/config/operational';
import { isRecord } from '@/lib/utils';
import { ApiError, isAbortError, isTimeoutError } from './errors';

export type ApiRequestOptions = {
  signal?: AbortSignal;
  headers?: HeadersInit;
  workspaceId?: string | null;
  requestId?: string;
  idempotencyKey?: string;
  retryNetworkFailures?: boolean;
  timeoutMs?: number;
};

type ResponseKind = 'json' | 'blob';
type RequestMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

type InternalRequestOptions = ApiRequestOptions & {
  method: RequestMethod;
  body?: BodyInit;
};

function createRequestId() {
  return globalThis.crypto.randomUUID();
}

function applyWorkspaceHeader(headers: Headers, workspaceId: string | null | undefined) {
  if (workspaceId) {
    headers.set('X-Workspace-Id', workspaceId);
  } else {
    headers.delete('X-Workspace-Id');
  }
}

function buildHeaders(options: InternalRequestOptions, requestId: string) {
  const headers = new Headers(options.headers);
  if (options.method !== 'GET' || options.requestId) {
    headers.set('X-Request-ID', requestId);
  }
  if (options.idempotencyKey) headers.set('Idempotency-Key', options.idempotencyKey);
  applyWorkspaceHeader(headers, options.workspaceId);
  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return headers;
}

function attemptSignal(signal?: AbortSignal, timeoutMs?: number) {
  const timeout = AbortSignal.timeout(timeoutMs ?? getApiRequestTimeoutMs());
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function fetchResponse(path: string, options: InternalRequestOptions, requestId: string) {
  return fetch(`${API_BASE_URL}${path}`, {
    method: options.method,
    body: options.body,
    signal: attemptSignal(options.signal, options.timeoutMs),
    cache: 'no-cache',
    credentials: 'include',
    headers: buildHeaders(options, requestId),
  });
}

function canRetryNetworkFailure(options: InternalRequestOptions) {
  return (
    Boolean(options.retryNetworkFailures) &&
    (options.method === 'GET' || Boolean(options.idempotencyKey))
  );
}

async function apiErrorFrom(response: Response, requestId: string): Promise<ApiError> {
  const parsed = await readErrorBody(response).catch((error: unknown) => {
    if (isTimeoutError(error)) throw timeoutApiError(requestId);
    throw error;
  });
  return new ApiError(
    parsed.message,
    response.status,
    parsed.raw,
    response.headers.get('x-request-id') ?? parsed.requestId ?? requestId,
    {
      code: parsed.code,
      retryable: parsed.retryable,
      retryAfterSeconds: retryAfterWholeSeconds(response.headers.get('retry-after')),
    },
  );
}

function finalRequestError(error: unknown, requestId: string): Error {
  if (isTimeoutError(error)) return timeoutApiError(requestId);
  return error instanceof Error ? error : new Error('Failed to reach API.');
}

function shouldRetryRequest(
  error: unknown,
  attempt: number,
  maxAttempts: number,
  options: InternalRequestOptions,
): boolean {
  return !(
    error instanceof ApiError ||
    isAbortError(error) ||
    attempt >= maxAttempts ||
    !canRetryNetworkFailure(options)
  );
}

async function requestResponse(path: string, options: InternalRequestOptions) {
  const requestId = options.requestId ?? createRequestId();
  const maxAttempts = canRetryNetworkFailure(options) ? 2 : 1;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchResponse(path, options, requestId);
      if (response.ok) return { response, requestId };
      throw await apiErrorFrom(response, requestId);
    } catch (error) {
      lastError = error;
      if (!shouldRetryRequest(error, attempt, maxAttempts, options)) {
        throw finalRequestError(error, requestId);
      }
      await delay(API_RETRY_BACKOFF_MS * attempt, options.signal);
    }
  }

  throw finalRequestError(lastError, requestId);
}

function timeoutApiError(requestId: string) {
  return new ApiError(
    'The request timed out before the API responded. Please try again.',
    0,
    '',
    requestId,
    { code: 'request_timeout', retryable: true },
  );
}

function retryAfterWholeSeconds(header: string | null): number | undefined {
  const seconds = retryAfterSeconds(header);
  return seconds === undefined ? undefined : Math.ceil(seconds);
}

async function parseResponse<T>(response: Response, kind: ResponseKind): Promise<T> {
  if (response.status === 204 || response.headers.get('content-length') === '0') {
    return undefined as T;
  }
  if (kind === 'blob') return response.blob() as Promise<T>;
  const contentType = response.headers.get('content-type') ?? '';
  if (!isJsonContentType(contentType)) {
    const text = await response.text();
    if (!text.trim()) return undefined as T;
    throw new ApiError('Expected JSON response from API.', response.status, text);
  }
  return response.json() as Promise<T>;
}

function encodeBody(body: unknown): BodyInit | undefined {
  if (body === undefined) return undefined;
  return body instanceof FormData ? body : JSON.stringify(body);
}

async function request<T>(
  method: RequestMethod,
  path: string,
  kind: ResponseKind,
  body: unknown,
  options: ApiRequestOptions = {},
) {
  const encodedBody = encodeBody(body);
  const { response, requestId } = await requestResponse(path, {
    ...options,
    method,
    body: encodedBody,
  });
  return parseResponse<T>(response, kind).catch((error: unknown) => {
    if (isTimeoutError(error)) throw timeoutApiError(requestId);
    throw error;
  });
}

export const apiClient = {
  get: <T>(path: string, options?: ApiRequestOptions) =>
    request<T>('GET', path, 'json', undefined, options),
  getBlob: (path: string, options?: ApiRequestOptions) =>
    request<Blob>('GET', path, 'blob', undefined, options),
  post: <T>(path: string, body: unknown, options?: ApiRequestOptions) =>
    request<T>('POST', path, 'json', body, options),
  put: <T>(path: string, body: unknown, options?: ApiRequestOptions) =>
    request<T>('PUT', path, 'json', body, options),
  patch: <T>(path: string, body: unknown, options?: ApiRequestOptions) =>
    request<T>('PATCH', path, 'json', body, options),
  delete: <T>(path: string, options?: ApiRequestOptions) =>
    request<T>('DELETE', path, 'json', undefined, options),
};

const MAX_PLAIN_TEXT_MESSAGE_CHARS = 200;

function isJsonContentType(contentType: string): boolean {
  const [mediaType = ''] = contentType.split(';');
  const type = mediaType.trim().toLowerCase();
  return type === 'application/json' || type.endsWith('+json');
}

type ErrorPayload = {
  message: string;
  code?: string;
  retryable?: boolean;
  requestId?: string;
  raw: string;
};

async function readErrorBody(response: Response): Promise<ErrorPayload> {
  const fallback = response.statusText || 'Request failed';
  const contentType = response.headers.get('content-type') ?? '';
  let raw = '';
  try {
    raw = await response.text();
  } catch {
    return { message: fallback, raw };
  }
  if (!isJsonContentType(contentType)) {
    const text = raw.trim();
    const usable = text && text.length <= MAX_PLAIN_TEXT_MESSAGE_CHARS && !text.includes('<');
    return { message: usable ? text : fallback, raw };
  }
  try {
    return { ...extractFromPayload(JSON.parse(raw), fallback), raw };
  } catch {
    return { message: fallback, raw };
  }
}

function envelopePayload(value: unknown): Omit<ErrorPayload, 'raw'> | null {
  if (!isRecord(value)) return null;
  const message = stringField(value.message);
  return message
    ? {
        message,
        code: stringField(value.code),
        retryable: typeof value.retryable === 'boolean' ? value.retryable : undefined,
        requestId: stringField(value.request_id),
      }
    : null;
}

function extractFromPayload(payload: unknown, fallback: string): Omit<ErrorPayload, 'raw'> {
  if (!isRecord(payload)) return { message: fallback };
  return envelopePayload(payload.error) ?? { message: fallback };
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function delay(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

export { ApiError, httpErrorStatus } from './errors';
