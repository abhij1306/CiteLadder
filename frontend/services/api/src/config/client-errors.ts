/**
 * Browser error reports. The per-user rate limit lives with the other abuse
 * budgets (`client_error_client_limit`, `client_error_window_seconds`); the
 * field lengths are the wire contract's (`@citeladder/contracts/client-errors`).
 */
export const clientErrors = {
  /** Larger than any report the contract's field lengths allow, far below the API-wide cap. */
  max_body_bytes: 16384,
  /** The logger whose records carry client failures on the service's log stream. */
  logger: 'api.client_errors',
} as const;
