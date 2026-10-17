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
  /** Stable snake_case machine code from the error envelope, when sent. */
  readonly code?: string;
  /** Server-side retryability classification, when sent (A1 envelope). */
  readonly retryable?: boolean;
  /** Server-advised delay from the standard Retry-After response header. */
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

/** The human-facing projection of any caught error (component boundary). */
export type HumanizedApiError = {
  /** Human-readable message — never a raw JSON blob. */
  message: string;
  /** HTTP status when the error carried one (0/absent for network failures). */
  status?: number;
  /** Stable machine code for support correlation, when sent. */
  code?: string;
  /** Server retryability classification, when sent. */
  retryable?: boolean;
  /** Server-advised delay before retrying, when sent. */
  retryAfterSeconds?: number;
  /** `X-Request-ID` correlation token, when captured. */
  requestId?: string;
};

/**
 * Project any caught error into display-safe copy. `ApiError` messages are
 * already humanized by the transport (`readErrorBody`); anything else falls
 * back to its `Error.message`, then to `fallbackMessage`. Never returns a raw
 * JSON blob or an empty string.
 */
export function humanizeApiError(
  error: unknown,
  fallbackMessage = 'Something went wrong. Please try again.',
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

/**
 * True for a contract-validation failure whose message is machine detail, not
 * user copy.
 *
 * `strictValidate` (@citeladder/contracts) throws a plain `Error` whose message
 * embeds `ZodError.message` — a serialized JSON array of issue objects. It was
 * therefore returned verbatim as the user-facing message, putting a raw JSON
 * blob on screen: exactly what the transport's `readErrorBody` guarantees
 * never to do. A drift bug is for the developer to fix, so the user gets the
 * generic fallback while the original error keeps its full detail for logs.
 */
function isStructuredParseFailure(error: Error): boolean {
  const message = error.message;
  return (
    message.startsWith('API validation failure in ') ||
    error.name === 'ZodError' ||
    // A bare serialized ZodError message is a JSON array of issue objects.
    (message.trimStart().startsWith('[') && message.includes('"code"'))
  );
}

/** Extract an HTTP status from an ApiError or a duck-typed `{ status }` error. */
export function httpErrorStatus(error: unknown): number | undefined {
  if (error instanceof ApiError) return error.status > 0 ? error.status : undefined;
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = (error as { status: unknown }).status;
    return typeof status === 'number' && Number.isFinite(status) && status > 0 ? status : undefined;
  }
  return undefined;
}

/** True when the error originates from an aborted `AbortSignal`. */
export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError';
}

/**
 * True when the error is an `AbortSignal.timeout()` expiry (a `TimeoutError`
 * DOMException). Kept distinct from `isAbortError`: a user/query abort must
 * never retry, while a timeout is a transient network-class failure.
 */
export function isTimeoutError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === 'TimeoutError'
    : error instanceof Error && error.name === 'TimeoutError';
}
