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
 *   - `credentials: 'include'` (HttpOnly JWT cookie) and `cache: 'no-store'`.
 *   - bounded network-failure retry (max 2 attempts) for GET / idempotent calls
 *     only — never for ordinary mutations.
 *   - JSON enforcement: a 2xx response that is not JSON is a contract violation.
 */
import {
  API_BASE_URL,
  API_RETRY_BACKOFF_MS,
  getApiRequestTimeoutMs,
} from '@/lib/config/operational';
import { ApiError, isAbortError, isTimeoutError } from './errors';

/** Relative API base on the app origin. */
export { API_BASE_URL } from '@/lib/config/operational';

export type ApiRequestOptions = {
  signal?: AbortSignal;
  headers?: HeadersInit;
  /**
   * The workspace this request is FOR, carried with the request itself.
   *
   * A request must be answered for the workspace it was issued for, even if
   * the user selects a different one while it is in flight or it is retried
   * afterwards. Reading the mutable module-level selection at send time made
   * that untrue: a retry of a request issued for workspace A picked up B's
   * header and returned B's data under A's cache key.
   *
   * `undefined` and `null` both send no workspace header. There is
   * deliberately no mutable ambient fallback.
   */
  workspaceId?: string | null;
  requestId?: string;
  idempotencyKey?: string;
  retryNetworkFailures?: boolean;
  /** Bounded override for operations whose server contract exceeds the default. */
  timeoutMs?: number;
};

type ResponseKind = 'json' | 'text' | 'blob';
type RequestMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

type InternalRequestOptions = ApiRequestOptions & {
  method: RequestMethod;
  body?: BodyInit;
};

function createRequestId() {
  return globalThis.crypto.randomUUID();
}

/**
 * Scope flat routes to the workspace this request was issued for.
 *
 * An explicit `workspaceId` is AUTHORITATIVE: it replaces any `X-Workspace-Id`
 * the caller's own headers carried, and an explicit `null` removes the header
 * entirely so the backend resolves access from the path or the caller's
 * default workspace. Deferring to a copied header instead would let one reused
 * header object silently decide the tenancy of a request that named its own
 * workspace — the exact failure this option exists to remove.
 *
 * With no explicit value the header is removed. Tenancy stays attached to the
 * request options captured by its query or mutation owner.
 */
function applyWorkspaceHeader(headers: Headers, workspaceId: string | null | undefined) {
  if (workspaceId) {
    headers.set('X-Workspace-Id', workspaceId);
  } else {
    headers.delete('X-Workspace-Id');
  }
}

function buildHeaders(options: InternalRequestOptions, requestId: string) {
  const headers = new Headers(options.headers);
  // Keep ordinary GETs "simple" (no custom header) to avoid a CORS preflight;
  // stamp a request id on mutations and any GET that explicitly opts in.
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

/**
 * Per-attempt signal: the caller's abort composed with the bounded default
 * timeout (A3). An expiry aborts with a `TimeoutError` DOMException, which the
 * request loop converts into a retryable network-class `ApiError`; the
 * caller's own abort reason passes through untouched.
 */
function attemptSignal(signal?: AbortSignal, timeoutMs?: number) {
  const timeout = AbortSignal.timeout(timeoutMs ?? getApiRequestTimeoutMs());
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function fetchResponse(path: string, options: InternalRequestOptions, requestId: string) {
  return fetch(`${API_BASE_URL}${path}`, {
    method: options.method,
    body: options.body,
    signal: attemptSignal(options.signal, options.timeoutMs),
    cache: 'no-store',
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
      retryAfterSeconds: retryAfterSeconds(response.headers.get('retry-after')),
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

/** The A3 surface: a timeout is a transient network-class failure (retryable). */
function timeoutApiError(requestId: string) {
  return new ApiError(
    'The request timed out before the API responded. Please try again.',
    0,
    '',
    requestId,
    { code: 'request_timeout', retryable: true },
  );
}

/** Parse the delta-seconds form emitted by CiteLadder's durable usage guards. */
function retryAfterSeconds(value: string | null): number | undefined {
  if (!value?.trim()) return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds) : undefined;
}

async function parseResponse<T>(response: Response, kind: ResponseKind): Promise<T> {
  if (response.status === 204 || response.headers.get('content-length') === '0') {
    return undefined as T;
  }
  if (kind === 'text') return response.text() as Promise<T>;
  if (kind === 'blob') return response.blob() as Promise<T>;
  const contentType = response.headers.get('content-type') ?? '';
  if (!isJsonContentType(contentType)) {
    const text = await response.text();
    if (!text.trim()) return undefined as T;
    throw new ApiError('Expected JSON response from API.', response.status, text);
  }
  return response.json() as Promise<T>;
}

/** FormData is already an encoded body; anything else becomes JSON. */
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
  // Same exposure as the error-body read: a 2xx whose BODY stalls past the
  // per-attempt timeout must surface as the retryable A3 ApiError, not as a
  // raw TimeoutError DOMException the caller cannot classify.
  return parseResponse<T>(response, kind).catch((error: unknown) => {
    if (isTimeoutError(error)) throw timeoutApiError(requestId);
    throw error;
  });
}

export const apiClient = {
  get: <T>(path: string, options?: ApiRequestOptions) =>
    request<T>('GET', path, 'json', undefined, options),
  getText: (path: string, options?: ApiRequestOptions) =>
    request<string>('GET', path, 'text', undefined, options),
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

/**
 * Longest plain-text body still treated as a human message. Above this it is
 * an error PAGE, not a sentence — see `readErrorBody`.
 */
const MAX_PLAIN_TEXT_MESSAGE_CHARS = 200;

/**
 * True for JSON media types, including the RFC 9457 `application/problem+json`
 * dialect. `problem+json` carries a structured body, so routing it down the
 * plain-text branch would have surfaced a raw JSON blob as the message — the
 * exact thing `readErrorBody` promises never to do.
 */
function isJsonContentType(contentType: string): boolean {
  const type = contentType.split(';')[0]!.trim().toLowerCase();
  return type === 'application/json' || type.endsWith('+json');
}

/** The extracted, display-safe projection of an error response body (A2). */
type ErrorPayload = {
  /** Human message — never a raw JSON blob. */
  message: string;
  /** Stable machine code from the error envelope. */
  code?: string;
  /** Server retryability classification (canonical envelope only). */
  retryable?: boolean;
  /** Envelope-carried correlation id (backstop for the response header). */
  requestId?: string;
  /** The exact raw body text, kept on `ApiError.body` for debugging. */
  raw: string;
};

/**
 * Extract a human message (+ machine code) from an error response:
 *   1. canonical envelope `error.message` / `error.code` / `error.retryable`
 *      / `error.request_id`;
 *   2. the response status text.
 * A raw JSON blob is NEVER surfaced as the message.
 */
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
    // Short plain-text bodies (e.g. a proxy's one-line error) are shown as-is.
    // A LONG body is almost never a message — it is an HTML error page or a
    // stack dump — so it falls back to the status text and stays available on
    // `ApiError.body` for debugging, rather than being pasted into the UI.
    const text = raw.trim();
    const usable = text && text.length <= MAX_PLAIN_TEXT_MESSAGE_CHARS && !text.includes('<');
    return { message: usable ? text : fallback, raw };
  }
  try {
    return { ...extractFromPayload(JSON.parse(raw), fallback), raw };
  } catch {
    // An unparseable "JSON" body must not leak a blob into the message either.
    return { message: fallback, raw };
  }
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function envelopePayload(value: unknown): Omit<ErrorPayload, 'raw'> | null {
  const block = objectRecord(value);
  const message = block && stringField(block.message);
  return message
    ? {
        message,
        code: stringField(block.code),
        retryable: typeof block.retryable === 'boolean' ? block.retryable : undefined,
        requestId: stringField(block.request_id),
      }
    : null;
}

function extractFromPayload(payload: unknown, fallback: string): Omit<ErrorPayload, 'raw'> {
  const record = objectRecord(payload);
  if (!record) return { message: fallback };
  return envelopePayload(record.error) ?? { message: fallback };
}

/** A non-empty trimmed string field, or undefined. */
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
