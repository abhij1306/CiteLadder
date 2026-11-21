/**
 * API error types + helpers.
 *
 * `ApiError` is thrown by the transport (`client.ts`) for any non-2xx response
 * or a JSON-contract violation. It carries the HTTP status, the raw response
 * body, the correlating `X-Request-ID`, and — when the backend sent the
 * canonical error envelope (A1) — the stable machine `code` and the
 * server-classified `retryable` flag. `httpErrorStatus` / `isAbortError` are
 * shared by the retry policy in `query-client.ts` and the client's bounded
 * network retry. `humanizeApiError` is the ONE owner of error-to-copy
 * conversion for components — components never re-derive
 * messages from `error.body`.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly body: string;
  readonly requestId?: string;
  readonly code?: string;
  readonly retryable?: boolean;
  readonly retryAfterSeconds?: number;

  constructor(
    message: string,
    status: number,
    body: string,
    requestId?: string,
    options?: { code?: string; retryable?: boolean; retryAfterSeconds?: number },
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
    this.requestId = requestId;
    this.code = options?.code;
    this.retryable = options?.retryable;
    this.retryAfterSeconds = options?.retryAfterSeconds;
  }
}

export type HumanizedApiError = {
  message: string;
  status?: number;
  code?: string;
  retryable?: boolean;
  retryAfterSeconds?: number;
  requestId?: string;
};

export function humanizeApiError(
  error: unknown,
  fallbackMessage = 'Something went wrong. Try again.',
): HumanizedApiError {
  if (error instanceof ApiError) {
    return {
      message: error.message.trim() || fallbackMessage,
      status: error.status > 0 ? error.status : undefined,
      code: error.code,
      retryable: error.retryable,
      retryAfterSeconds: error.retryAfterSeconds,
      requestId: error.requestId,
    };
  }
  if (error instanceof Error && error.message.trim() && !isStructuredParseFailure(error)) {
    return { message: error.message };
  }
  return { message: fallbackMessage };
}

function isStructuredParseFailure(error: Error): boolean {
  const message = error.message;
  return (
    message.startsWith('API validation failure in ') ||
    error.name === 'ZodError' ||
    (message.trimStart().startsWith('[') && message.includes('"code"'))
  );
}

export function isNotFound(error: unknown): boolean {
  return httpErrorStatus(error) === 404;
}

export function httpErrorStatus(error: unknown): number | undefined {
  if (error instanceof ApiError) return error.status > 0 ? error.status : undefined;
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const { status } = error;
    return typeof status === 'number' && Number.isFinite(status) && status > 0 ? status : undefined;
  }
  return undefined;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError';
}

export function isTimeoutError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === 'TimeoutError'
    : error instanceof Error && error.name === 'TimeoutError';
}
